// Edge caching for hot public GET endpoints on Cloudflare Workers.
// Uses the platform Cache API (caches.default) so repeat hits never touch
// Mongo or run handler code — the main defence against the free-tier CPU
// limit. Falls back to running the handler directly anywhere else
// (local dev, Android/Windows shells, prerender).

// Query params that never change the payload — stripped from the cache key
// so client cache-busters (?t=...) don't fragment the cache.
const BUSTER_PARAMS = new Set(['t', '_', 'timestamp', '_t', 'cb', 'cachebuster', 'nocache']);

function hasEdgeCache() {
	try {
		return typeof caches !== 'undefined' && !!caches.default;
	} catch {
		return false;
	}
}

export function edgeCacheKey(url) {
	const u = new URL(String(url));
	for (const k of [...u.searchParams.keys()]) {
		if (BUSTER_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
	}
	return new Request(u.toString(), { method: 'GET' });
}

/** Personalized or authed requests must never be served from shared cache. */
export function isCacheableRequest(request, url) {
	try {
		if (!request || request.method !== 'GET') return false;
		if (request.headers?.has?.('authorization')) return false;
		const u = new URL(String(url || request.url));
		// Per-visitor payloads (done-lists, tokens) vary by caller.
		// Compare lowercased: param names arrive as userId, sessionId, etc.
		for (const k of u.searchParams.keys()) {
			const kl = k.toLowerCase();
			if (
				kl === 'userid' || kl === 'user_id' || kl === 'token' ||
				kl === 'sessionid' || kl === 'session_id' || kl === 'email'
			)
				return false;
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Serves `producer()` through the edge cache with a `ttlSeconds` lifetime.
 * Only 200 responses are stored. Returns live responses untouched when the
 * Cache API is unavailable. Never throws.
 */
export async function cachedResponse(request, ttlSeconds, producer) {
	const miss = async () => {
		const res = await producer();
		try {
			if (res) res.headers.set('X-Edge-Cache', 'MISS');
		} catch {}
		return res;
	};
	try {
		if (!hasEdgeCache()) return await miss();
		const key = edgeCacheKey(request.url);
		const hit = await caches.default.match(key);
		if (hit) {
			// Re-wrap: cached responses are immutable, but hooks.server.js
			// sets per-request CORS headers afterwards.
			const res = new Response(hit.body, hit);
			res.headers.set('X-Edge-Cache', 'HIT');
			return res;
		}
		const res = await producer();
		try {
			if (res && res.ok && res.status === 200) {
				const store = res.clone();
				store.headers.set(
					'Cache-Control',
					`public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`
				);
				await caches.default.put(key, store);
			}
		} catch {}
		try {
			if (res) res.headers.set('X-Edge-Cache', 'MISS');
		} catch {}
		return res;
	} catch {
		return await producer();
	}
}
