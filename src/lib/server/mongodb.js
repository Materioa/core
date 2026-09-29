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

	connecting = (async () => {
		const client = new MongoClient(uri, {
			serverSelectionTimeoutMS: 5000,
			connectTimeoutMS: 5000,
			maxPoolSize: 3,
			minPoolSize: 1
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
		return await Promise.race([
			connecting,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Mongo connect timed out')), 8000)
			)
		]);
	} catch (error) {
		connecting.catch(() => {});
		connecting = null;
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
