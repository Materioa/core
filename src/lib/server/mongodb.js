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

export async function getMongoDb() {
	if (cachedDb) return cachedDb;
	if (connecting) return connecting;

	const uri = env.MONGODB_URI || process.env.MONGODB_URI;
	if (!uri) throw new Error('MONGODB_URI is not configured');

	const started = Date.now();
	connecting = (async () => {
		// Pool sizing for Workers: one page load fans out into several
		// concurrent API calls that can land on the SAME isolate. A small
		// pool forces checkouts into the driver's wait queue — and on
		// workerd a queued waiter that wakes in another request's context
		// is cancelled and hangs forever. So: roomy pool, idle conns
		// released fast, and any waiter still stuck fails fast (the 8s
		// race below turns it into a 500 JSON, never a hung worker).
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
		cachedClient = client;
		cachedDb = client.db('materio');
		return cachedDb;
	})();

	try {
		// Bound the wait: a stalled handshake must fail fast (handlers
		// answer 500 JSON) instead of hanging the worker. A slow connect
		// keeps running behind to warm the cache for the next request.
		const db = await Promise.race([
			connecting,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Mongo connect timed out')), 20000)
			)
		]);
		const took = Date.now() - started;
		if (took > 1000) {
			try { console.warn(`[mongo] slow connect: ${took}ms`); } catch {}
		}
		return db;
	} catch (error) {
		const took = Date.now() - started;
		try { console.warn(`[mongo] connect failed after ${took}ms: ${error?.message || error}`); } catch {}
		connecting.catch(() => {});
		connecting = null;
		// Heal pools poisoned by leaked checkouts: drop everything so the
		// next request reconnects fresh instead of queuing behind ghosts.
		try { if (cachedClient) await cachedClient.close().catch(() => {}); } catch {}
		cachedClient = null;
		cachedDb = null;
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
