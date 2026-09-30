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
 * Serves `producer()` through the edge cache with a `ttlSeconds` lifetime.
 * Only 200 responses are stored. Returns live responses untouched when the
 * Cache API is unavailable. Every cache operation is time-boxed: a wedged
 * Cache API degrades to a live response, never a hung worker. Never throws.
 * Concurrent misses for the same key share one producer run.
 */
export async function cachedResponse(request, ttlSeconds, producer) {
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

	// The producer runs exactly once per distinct key at a time.
	const produceOnce = async () => {
		const res = await producer();
		try {
			if (res) res.headers.set('X-Edge-Cache', 'MISS');
		} catch {}
		return res;
	};

	const build = async (key) => {
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
	};

	if (!hasEdgeCache()) {
		// No shared cache here (local dev, prerender): still collapse
		// concurrent callers so we don't fan out per request.
		const url = String(request?.url || 'no-url');
		const entry = joinableInFlight(url);
		if (entry) {
			try {
				return await joinInFlight(entry);
			} catch {
				// fall through and produce fresh rather than parking
			}
		}
		const pending = build(NO_CACHE_KEY(request));
		const record = { promise: pending, at: Date.now() };
		inFlight.set(url, record);
		try {
			const res = await pending;
			return res.clone();
		} finally {
			if (inFlight.get(url) === record) inFlight.delete(url);
		}
	}

	const key = edgeCacheKey(request.url);
	const keyId = key.url;
	const entry = joinableInFlight(keyId);
	if (entry) {
		// Coalesced onto an in-flight producer. Clone so each caller gets its
		// own readable body — the shared Response is never consumed directly.
		try {
			return await joinInFlight(entry);
		} catch {
			// Stalled or failed shared run: fall through and produce fresh
			// rather than hanging this request behind a corpse.
		}
	}

	const pending = build(key);
	const record = { promise: pending, at: Date.now() };
	inFlight.set(keyId, record);
	try {
		const res = await pending;
		return res.clone();
	} catch {
		// Only Cache-API/producer failures land here.
		throw new Error('edge cache unavailable and no response produced');
	} finally {
		if (inFlight.get(keyId) === record) inFlight.delete(keyId);
	}
}

// Placeholder key for the no-Cache-API path (Cache API ops are skipped there).
const NO_CACHE_KEY = (request) => ({ url: String(request?.url || 'no-url') });
