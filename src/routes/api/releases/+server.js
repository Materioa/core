import { GET as getLatest } from './latest/+server.js';

export async function GET(event) {
	return getLatest(event);
}
