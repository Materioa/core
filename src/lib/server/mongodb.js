import { MongoClient } from 'mongodb';
import { env } from '$env/dynamic/private';

// One client per isolate, reused across requests. On Cloudflare Workers
// (10ms CPU budget on free tier) opening a fresh TLS connection per
// request blows the limit and every API answers 503 — so connections are
// NEVER closed per request. resetMongoDb() stays for error recovery.

let cachedClient = null;
let cachedDb = null;
let connecting = null;

export async function withMongoRequest(callback) {
	// Kept for call-site compatibility (hooks.server.js). Previously this
	// closed every client after each request; now it just runs the callback
	// so the shared connection below survives.
	return callback();
}

// A connect that hasn't finished in this long is far more likely wedged
// than slow (healthy cold connects measure ~1-3s from the edge). The waiter
// fails fast to fallback JSON; the background attempt keeps warming the pool.
const MONGO_WAIT_MS = 10000;

export async function getMongoDb() {
	if (cachedDb) return cachedDb;
	if (!connecting) {
		const uri = env.MONGODB_URI || process.env.MONGODB_URI;
		if (!uri) throw new Error('MONGODB_URI is not configured');

		const attempt = (async () => {
			// Pool sizing for Workers: one page load fans out into several
			// concurrent API calls that can land on the SAME isolate. A small
			// pool forces checkouts into the driver's wait queue — and on
			// workerd a queued waiter that wakes in another request's context
			// is cancelled and hangs forever. So: roomy pool, idle conns
			// released fast, and any waiter still stuck fails fast (the race
			// below turns it into fallback JSON, never a hung worker).
			// Cloudflare enforces a HARD limit of 6 simultaneous outbound
			// connections per Worker. The driver's own default pool (100, and
			// 20 here) is far above that ceiling: the pool will happily try to
			// open sockets the platform cannot grant, and `maxIdleTimeMS`
			// then PINS them. Once ~6 sockets are held — even idle — a new
			// request's connect has nowhere to go, parks in the driver's wait
			// queue, and wedges with nothing pending (no driver timeout fires,
			// nothing throws). That wedged checkout is what leaked when the
			// runtime killed those events, poisoning the pool for every later
			// request on the isolate — the 3s/8s crash signature.
			//
			// Fix: stay comfortably UNDER the ceiling, release idle sockets
			// quickly so they never permanently occupy slots, and make
			// contention fail fast so withMongoTimeout() can fall back to
			// static JSON instead of hanging. Mongo reads here are small
			// indexed finds, so 4 sockets is ample.
			const client = new MongoClient(uri, {
				// Cold handshakes from the edge (SRV DNS + TCP + throttled TLS)
				// take seconds of wall time but little CPU — allow them room.
				// Once one request per isolate connects, the pool + edge cache
				// serve everything else in milliseconds.
				serverSelectionTimeoutMS: 10000,
				connectTimeoutMS: 10000,
				// Dead pooled sockets must error out instead of hanging a
				// request forever (Atlas/LB idle kills). Reads transparently
				// retry once on a fresh connection (driver default).
				socketTimeoutMS: 8000,
				// MUST stay below Cloudflare's 6-connection ceiling.
				//
				// Raised 4 -> 5 because one page load fans out into ~6
				// concurrent Mongo reads (releases, notifications, popups,
				// notebooks, notifications-feed, interviewer responses), so a
				// 4-socket pool queued two of them every time and the losers
				// hit waitQueueTimeoutMS -> our 5000ms bound -> a visible 500.
				// 5 still leaves a slot free for an outbound LLM fetch, which
				// competes for the same ceiling.
				//
				// This was previously too dangerous to raise: an over-subscribed
				// pool wedged, the wedge latched the whole isolate and killed
				// every later request on it. Every driver op in the repo is now
				// raced against withMongoTimeout (see test-mongo-guard.mjs), so
				// contention surfaces as a caught error and the pool is dropped
				// and rebuilt instead of hanging forever.
				maxPoolSize: 5,
				minPoolSize: 0,
				// Keep warm sockets ALIVE between requests. A 5s idle reap was
				// a mistake: with request gaps > 5s it forced a fresh cold
				// handshake (~2.4s logged) on essentially every read, and each
				// abandoned attempt burned one of the platform's 6 connection
				// slots until the isolate could no longer connect at all
				// (symptom: alternating ~200ms / ~5000ms responses — a healthy
				// isolate beside a permanently wedged one). Since maxPoolSize
				// is 5, holding sockets for 30s can never breach the ceiling.
				maxIdleTimeMS: 30000,
				// Contention should surface as an error quickly, never as a
				// 15s stall that outlives the request. Kept BELOW the 5000ms
				// withMongoTimeout bound so the driver's own wait-queue error
				// is what usually surfaces: it carries the real reason.
				waitQueueTimeoutMS: 4000
			});
			await client.connect();
			const db = client.db('materio');
			// Publish, replacing any older client (an orphaned earlier attempt
			// may have published while we connected — close it, don't leak).
			const prev = cachedClient;
			cachedClient = client;
			cachedDb = db;
			try { if (prev && prev !== client) await prev.close().catch(() => {}); } catch {}
			return db;
		})();

		connecting = attempt;
		// Settle the single-flight exactly once. The rejection branch
		// deliberately does NOT touch cachedDb: a rejected attempt never
		// published anything itself, so whatever is cached came from
		// elsewhere and must be left alone (closing it here poisoned the
		// cache with a closed client). This .then also guarantees the
		// background rejection is always observed — never unhandled.
		attempt.then(
			() => { if (connecting === attempt) connecting = null; },
			() => { if (connecting === attempt) connecting = null; }
		);
	}

	const attempt = connecting;
	const started = Date.now();
	try {
		// Bound EVERY waiter's wait — not just the connect creator's.
		// Previously concurrent callers awaited the raw shared promise with
		// no timeout: one wedged handshake hung them all until the runtime
		// killed each event ("hung and would never generate a response").
		const db = await Promise.race([
			attempt,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Mongo connect timed out')), MONGO_WAIT_MS)
			)
		]);
		const took = Date.now() - started;
		if (took > 1000) {
			try { console.warn(`[mongo] slow connect: ${took}ms`); } catch {}
		}
		return db;
	} catch (error) {
		// Retire a never-settling attempt. Without this, the dead promise
		// stays in `connecting` forever and every later request awaits a
		// corpse: zero pending work from the first tick, so the runtime kills
		// each follow-up event in ~milliseconds — the self-sustaining 500
		// avalanche. The orphaned attempt may still succeed later and publish
		// via the normal path; a newer attempt simply replaces it.
		if (connecting === attempt) connecting = null;
		const took = Date.now() - started;
		try { console.warn(`[mongo] connect wait failed after ${took}ms: ${error?.message || error}`); } catch {}
		throw error;
	}
}

/**
 * Drop the cached client WITHOUT closing it.
 *
 * Used by withMongoTimeout. Closing is the wrong move there: it kills sockets
 * that a wedged operation still holds, which leaves an unsettled promise in the
 * isolate and gets the whole request killed with "Promise will never complete."
 * Forgotten is sufficient — the next getMongoDb() builds a fresh pool.
 */
export function forgetMongoDb() {
	cachedClient = null;
	cachedDb = null;
	connecting = null;
}

export function resetMongoDb() {
	// Error recovery only: drops the shared client so the next request
	// reconnects fresh. Never call this on the happy path.
	const client = cachedClient;
	cachedClient = null;
	cachedDb = null;
	connecting = null;
	if (!client) return Promise.resolve();
	return client.close().catch(() => {});
}

/**
 * Bounds a driver operation with OUR OWN timer. This is load-bearing on
 * workerd: when the pool is poisoned (checkouts leaked by killed events),
 * queued operations wedge with nothing pending — no driver timeout fires,
 * try/catch can't help (nothing throws), and the runtime kills the event
 * for hanging (~75ms after the op starts: the 3001/8001ms crash signature).
 * Our setTimeout demonstrably fires on this runtime, so a raced timer turns
 * the wedge into a fast fallback instead of a killed event. On timeout the
 * poisoned pool is also dropped so the next request reconnects fresh.
 * Late op outcomes are always observed: an op that settles after the timeout
 * must never become an unhandled rejection (another worker-crasher).
 */
export function withMongoTimeout(promiseLike, ms = 5000, label = 'mongo op') {
	// Promise.resolve() first: accept any thenable, not just a real Promise.
	// Some driver/query-builder objects implement .then() but not .finally(),
	// and calling .finally() on those throws synchronously — which turns a
	// healthy read into a failed request.
	const promise = Promise.resolve(promiseLike);
	let timer;
	const guarded = promise.finally(() => clearTimeout(timer));
	guarded.then(
		() => {},
		() => {}
	);
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => {
			// Retire the pool by forgetting it, but DO NOT close it here.
			//
			// close() tears down every socket the client still has checked out,
			// including the connection the timed-out operation is still using. That
			// op never settles, so the isolate is left holding a promise which can
			// never complete and workerd kills the request with "Promise will never
			// complete." — a 500 at exactly this timeout, seen in production.
			//
			// Forgetting is enough: the next getMongoDb() builds a fresh pool and
			// this one is collected once the wedged op is dropped. resetMongoDb()
			// stays for explicit error recovery.
			forgetMongoDb();
			reject(new Error(`${label} timed out after ${ms}ms`));
		}, ms);
	});
	return Promise.race([guarded, timeout]);
}

export async function getFormsCollection() {
	const database = await getMongoDb();
	return database.collection('form_submissions');
}

export async function getFormConfigsCollection() {
	const database = await getMongoDb();
	return database.collection('form_configs');
}

export async function getInterviewerSessionsCollection() {
	const database = await getMongoDb();
	return database.collection('interviewer_sessions');
}

export async function getFormResponsesCollection() {
	const database = await getMongoDb();
	return database.collection('form_responses');
}

export async function closeMongoConnection() {
	await resetMongoDb();
}
