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
			const client = new MongoClient(uri, {
				// Cold handshakes from the edge (SRV DNS + TCP + throttled TLS)
				// take seconds of wall time but little CPU — allow them room.
				// Once one request per isolate connects, the pool + edge cache
				// serve everything else in milliseconds.
				serverSelectionTimeoutMS: 12000,
				connectTimeoutMS: 12000,
				// Dead pooled sockets must error out instead of hanging a
				// request forever (Atlas/LB idle kills). Reads transparently
				// retry once on a fresh connection (driver default).
				socketTimeoutMS: 8000,
				maxPoolSize: 20,
				minPoolSize: 0,
				maxIdleTimeMS: 30000,
				waitQueueTimeoutMS: 15000
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
