import { MongoClient } from 'mongodb';
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '$env/dynamic/private';

const requestConnections = new AsyncLocalStorage();
const sharedConnection = createConnectionState();

function createConnectionState() {
	return { client: null, db: null, connecting: null, clients: new Set() };
}

export async function withMongoRequest(callback) {
	const state = createConnectionState();
	return requestConnections.run(state, async () => {
		try {
			return await callback();
		} finally {
			await Promise.allSettled([...state.clients].map(client => client.close()));
		}
	});
}

export async function getMongoDb() {
	const state = requestConnections.getStore() || sharedConnection;
	if (state.db) return state.db;
	if (state.connecting) return state.connecting;

	const uri = env.MONGODB_URI || process.env.MONGODB_URI;
	if (!uri) throw new Error('MONGODB_URI is not configured');

	const client = new MongoClient(uri, {
		serverSelectionTimeoutMS: 5000,
		connectTimeoutMS: 5000,
		maxPoolSize: 5
	});
	state.client = client;
	state.clients.add(client);
	state.connecting = (async () => {
		try {
			await client.connect();
			state.db = client.db('materio');
			return state.db;
		} catch (error) {
			await client.close().catch(() => {});
			state.clients.delete(client);
			state.client = null;
			throw error;
		} finally {
			state.connecting = null;
		}
	})();
	return state.connecting;
}

export function resetMongoDb() {
	const state = requestConnections.getStore() || sharedConnection;
	const client = state.client;
	state.client = null;
	state.db = null;
	state.connecting = null;
	if (!client) return Promise.resolve();
	return client.close().catch(() => {}).finally(() => state.clients.delete(client));
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
