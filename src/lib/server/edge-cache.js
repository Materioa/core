// Edge caching for hot public GET endpoints on Cloudflare Workers.
// Two layers: a per-isolate in-memory TTL map, plus Cloudflare's CDN via
// Cache-Control/s-maxage. Repeat hits never touch Mongo or run handler code —
// the main defence against the free-tier CPU limit.
//
// NOTE: this used to layer caches.default on top. Production logs showed that
// call wedging (cached GETs dying at wallTimeMs ~3100 / cpuTimeMs 3, matching
// the old 3000ms match timeout), while the CDN was already caching correctly
// via s-maxage. The Cache API layer was redundant and actively harmful, so it
// is gone.

// Query params that never change the payload — stripped from the cache key
// so client cache-busters (?t=...) don't fragment the cache.
const BUSTER_PARAMS = new Set(['t', '_', 'timestamp', '_t', 'cb', 'cachebuster', 'nocache']);

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

// In-flight producer calls, keyed by cache key. Without this, N concurrent
// requests that miss the same key all run the producer at once — a cache
// stampede. That is not just wasted work: /api/v2/health alone makes three
// outbound fetches plus a Mongo round-trip per call, so a burst of parallel
// requests multiplied past Cloudflare's hard ceiling of 6 simultaneous
// outbound connections. The starved fetches never settled and the runtime
// reported "Promise will never complete." (observed on health, releases and
// forms/popups during a real page-load fan-out). Collapsing concurrent misses
// onto one producer keeps outbound pressure proportional to distinct keys.
const inFlight = new Map();

// Layer-1 cache: per-isolate, in memory. No platform I/O, so it cannot wedge.
const memCache = new Map();
const MAX_MEM_ENTRIES = 200;

// A producer that never settles must not poison the key forever. Entries are
// removed when the producer settles, AND treated as dead once they exceed this
// age: the first version only had `.finally()`, so a wedged producer left a
// permanent corpse in the map and every later request for that key awaited it
// (observed as /api/v2 notifications hanging until the client gave up).
// Joining also races a timer, so a stuck producer degrades to a fresh run
// instead of parking the request.
const INFLIGHT_MAX_AGE_MS = 10000;

// Returns a joinable in-flight entry, or null if there is none that is still
// trustworthy (absent, or too old to still be making progress).
function joinableInFlight(keyId) {
	const entry = inFlight.get(keyId);
	if (!entry) return null;
	if (Date.now() - entry.at > INFLIGHT_MAX_AGE_MS) {
		inFlight.delete(keyId);
		return null;
	}
	return entry;
}

async function joinInFlight(entry) {
	const shared = await Promise.race([
		entry.promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error('in-flight producer stalled')), INFLIGHT_MAX_AGE_MS)
		)
	]);
	return shared.clone();
}

/**
 * Serves `producer()` through a two-layer cache with a `ttlSeconds` lifetime:
 *
 *  1. A per-isolate in-memory TTL map — makes repeat requests on the same
 *     isolate instant, with no I/O at all.
 *  2. Cloudflare's CDN, via Cache-Control/s-maxage on the response. This is
 *     where cross-PoP caching actually happens.
 *
 * It deliberately does NOT use `caches.default` any more. Production logs
 * showed cached GETs dying at wallTimeMs ~3100 with cpuTimeMs 3 — that is this
 * module's old 3000ms `caches.default.match()` timeout elapsing, i.e. the
 * Cache API call itself was wedging. We had already confirmed the CDN caches
 * these responses (CF-Cache-Status: HIT, s-maxage honoured), so the Cache API
 * layer was redundant *and* was the thing hanging. Removing it also removes a
 * dangling platform promise from every cached request.
 *
 * Only 200 responses are stored. Never throws on the cache path: a failure to
 * read or write the cache degrades to a live producer run. Concurrent misses
 * for the same key share a single producer run.
 */
export async function cachedResponse(request, ttlSeconds, producer) {
	const key = edgeCacheKey(request.url);
	const keyId = key.url;

	// Layer 1: fresh in-memory entry.
	const mem = memCache.get(keyId);
	if (mem && mem.expiresAt > Date.now()) {
		try {
			const res = new Response(mem.body, {
				status: mem.status,
				statusText: mem.statusText,
				headers: mem.headers
			});
			res.headers.set('X-Edge-Cache', 'HIT');
			return res;
		} catch {
			memCache.delete(keyId);
		}
	}
	if (mem) memCache.delete(keyId);

	// Coalesce concurrent misses so a burst runs the producer once.
	const entry = joinableInFlight(keyId);
	if (entry) {
		try {
			return await joinInFlight(entry);
		} catch {
			// Stalled or failed shared run: fall through and produce fresh
			// rather than hanging this request behind a corpse.
		}
	}

	const pending = (async () => {
		const res = await producer();
		if (res && res.ok && res.status === 200) {
			// Degraded (fallback) answers must not occupy the cache for the full
			// TTL — that would serve stale data and mask Mongo recovery.
			let ttl = ttlSeconds;
			try {
				if (res.headers.get(DEGRADED_HEADER)) ttl = DEGRADED_TTL_SECONDS;
			} catch {}
			try {
				res.headers.set('X-Edge-Cache', 'MISS');
				// Browser + CDN caching. The CDN is the durable layer.
				res.headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
				const body = await res.clone().arrayBuffer();
				memCache.set(keyId, {
					body,
					status: res.status,
					statusText: res.statusText,
					headers: new Headers(res.headers),
					expiresAt: Date.now() + ttl * 1000
				});
				// Keep the in-memory map from growing without bound.
				if (memCache.size > MAX_MEM_ENTRIES) {
					const cutoff = Date.now();
					for (const [k, v] of memCache) {
						if (v.expiresAt <= cutoff) memCache.delete(k);
					}
					if (memCache.size > MAX_MEM_ENTRIES) {
						// Still too big: drop the oldest insertion.
						const firstKey = memCache.keys().next().value;
						if (firstKey !== undefined) memCache.delete(firstKey);
					}
				}
			} catch {}
		}
		return res;
	})();

	const record = { promise: pending, at: Date.now() };
	inFlight.set(keyId, record);
	try {
		const res = await pending;
		return res.clone();
	} finally {
		if (inFlight.get(keyId) === record) inFlight.delete(keyId);
	}
}
