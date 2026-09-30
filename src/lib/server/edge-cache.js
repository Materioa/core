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

/**
 * Marker set by handlers when they answer from a degraded source (bundled
 * static snapshot because Mongo was slow/unreachable) instead of live data.
 * A degraded answer is still a valid 200, but caching it for the full TTL
 * pins stale content for minutes AND hides recovery: one transient blip
 * would keep replaying the fallback long after Mongo came back. Degraded
 * responses therefore get a short TTL so they self-heal quickly.
 */
export const DEGRADED_HEADER = 'X-Materio-Degraded';
const DEGRADED_TTL_SECONDS = 15;

/** Tags a response as degraded so the cache stores it only briefly. */
export function markDegraded(res) {
	try {
		res.headers.set(DEGRADED_HEADER, '1');
	} catch {}
	return res;
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
 * Cache API is unavailable. Every cache operation is time-boxed: a wedged
 * Cache API degrades to a live response, never a hung worker. Never throws.
 */
export async function cachedResponse(request, ttlSeconds, producer) {
	// The producer (handler code) runs EXACTLY once per call. The old catch
	// block re-invoked it, doubling the Mongo stampede on the failure path.
	let produced = null;
	const produceOnce = async () => {
		if (!produced) {
			const res = await producer();
			try {
				if (res) res.headers.set('X-Edge-Cache', 'MISS');
			} catch {}
			produced = res;
		}
		return produced;
	};
	// Time-boxed cache read: on timeout treat as a miss.
	const safeMatch = async (key) => {
		try {
			return await Promise.race([
				caches.default.match(key),
				new Promise((resolve) => setTimeout(() => resolve(undefined), 3000))
			]);
		} catch {
			return undefined;
		}
	};
	// Time-boxed cache write: on timeout keep serving the live response.
	const safePut = async (key, res, ttl) => {
		try {
			const store = res.clone();
			store.headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
			await Promise.race([
				caches.default.put(key, store),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('edge put timeout')), 5000)
				)
			]);
		} catch {}
	};
	try {
		if (!hasEdgeCache()) return await produceOnce();
		const key = edgeCacheKey(request.url);
		const hit = await safeMatch(key);
		if (hit) {
			// Re-wrap: cached responses are immutable, but hooks.server.js
			// sets per-request CORS headers afterwards.
			const res = new Response(hit.body, hit);
			res.headers.set('X-Edge-Cache', 'HIT');
			return res;
		}
		const res = await produceOnce();
		if (res && res.ok && res.status === 200) {
			// Degraded (fallback) answers must not occupy the cache for the
			// full TTL — that would serve stale data and mask Mongo recovery.
			let ttl = ttlSeconds;
			try {
				if (res.headers.get(DEGRADED_HEADER)) ttl = DEGRADED_TTL_SECONDS;
			} catch {}
			await safePut(key, res, ttl);
		}
		return res;
	} catch {
		// Only Cache-API failures land here now (a producer throw propagates
		// from produceOnce on first call). If the producer already ran, serve
		// its result; never invoke handler code twice.
		if (produced) return produced;
		throw new Error('edge cache unavailable and no response produced');
	}
}
