// Pure payload helpers for the analytics tracker.
//
// Deliberately free of Svelte/browser/DOM imports: the flush path and the
// pending-retry path must agree byte-for-byte on what the server accepts, and
// keeping the rules here lets them be unit-tested in plain Node.
//
// The server contract these mirror is src/lib/server/features-handler.js:
//   sanitizeAnalyticsPayload()  -> clamps, rejects nothing but bad identity/date
//   validateAnalyticsDateKey()  -> p_date must be within -2..+1 days of UTC today
//   sanitizeAnalyticsPdfCounts() -> <= 30 entries, <= 8 opens/item, <= 30 opens

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Server-side caps (ANALYTICS_* in features-handler.js).
const MAX_PDF_ENTRIES = 30;
const MAX_OPENS_PER_ITEM = 8;
const MAX_TOTAL_OPENS = 30;

export function todayLocalISO(now = new Date()) {
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
		now.getDate()
	).padStart(2, '0')}`;
}

/** True when the server would accept this p_date (its -2..+1 day window). */
export function isServerAcceptableDate(dateKey) {
	if (!DATE_RE.test(String(dateKey || ''))) return false;
	const parsed = new Date(`${dateKey}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return false;
	const now = new Date();
	const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const delta = Math.round((parsed.getTime() - todayUtc) / 86400000);
	return delta >= -2 && delta <= 1;
}

/**
 * The date to send: the live one if the server will take it, else the parked
 * one (so a retry keeps its original day), else today.
 *
 * Re-dating is the whole point — a pending slot written on day X goes stale
 * after the window closes, and without this every retry would 400 forever,
 * which is how a parked payload used to become permanently unsendable.
 */
export function chooseDate(baseDate, pendingDate) {
	if (isServerAcceptableDate(baseDate)) return baseDate;
	if (isServerAcceptableDate(pendingDate)) return pendingDate;
	return todayLocalISO();
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * pdf_counts merge that stays inside the server's rejection limits.
 * Counts are clamped per item the way the server clamps them, and entries are
 * filled into a fixed open budget — a merge that pushed us past 30 opens would
 * be rejected with 400 and re-parked, i.e. stuck for good.
 */
function mergePdfCounts(a, b) {
	const out = {};
	let budget = MAX_TOTAL_OPENS;
	const take = (src) => {
		for (const [name, raw] of Object.entries(src && typeof src === 'object' ? src : {})) {
			if (Object.keys(out).length >= MAX_PDF_ENTRIES && !out[name]) return;
			let count = 0;
			let timeSec = 0;
			if (typeof raw === 'number') {
				count = num(raw);
			} else if (raw && typeof raw === 'object') {
				count = num(raw.count);
				timeSec = num(raw.time_sec);
			}
			count = Math.min(Math.max(Math.trunc(count), 0), MAX_OPENS_PER_ITEM);
			timeSec = Math.max(Math.trunc(timeSec), 0);
			if (count <= 0 && timeSec <= 0) continue;
			const cur = out[name] || (out[name] = { count: 0, time_sec: 0 });
			const room = Math.max(0, Math.min(count, budget));
			cur.count += room;
			budget -= room;
			cur.time_sec += timeSec;
			if (budget <= 0) budget = 0;
		}
	};
	// Current session first (it is the data about to be discarded from memory),
	// then whatever was parked — nothing may be dropped in favour of the other.
	take(a);
	take(b);
	return out;
}

function mergeEngagement(a, b) {
	const base = a && typeof a === 'object' ? a : {};
	const other = b && typeof b === 'object' ? b : {};
	const out = {
		clicks: {},
		scroll: num(base.scroll) + num(other.scroll),
		zoom: num(base.zoom) + num(other.zoom),
		shortcuts: { ...base.shortcuts, ...other.shortcuts }
	};
	for (const src of [base.clicks, other.clicks]) {
		if (!src || typeof src !== 'object') continue;
		for (const [k, v] of Object.entries(src)) {
			out.clicks[k] = num(out.clicks[k]) + num(v);
		}
	}
	return out;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Fold a parked payload into the one about to be sent.
 *
 * One storage slot holds "the last thing the server refused". Without merging,
 * the next failure overwrote it and those seconds were gone; merging keeps a
 * single request that carries everything forward, so data survives any number
 * of failures until one of them succeeds.
 */
export function mergeAnalyticsPayload(base, pending) {
	if (!isObj(pending)) return base;
	const b = isObj(base) ? base : {};
	const bm = isObj(b.p_metrics_diff) ? b.p_metrics_diff : {};
	const pm = isObj(pending.p_metrics_diff) ? pending.p_metrics_diff : {};
	const bu = isObj(b.p_usermeta_diff) ? b.p_usermeta_diff : {};
	const pu = isObj(pending.p_usermeta_diff) ? pending.p_usermeta_diff : {};

	return {
		...b,
		p_anon_id: b.p_anon_id || pending.p_anon_id || null,
		p_date: chooseDate(b.p_date, pending.p_date),
		p_user_id: b.p_user_id ?? pending.p_user_id ?? null,
		p_metrics_diff: {
			total_reading_sec: num(bm.total_reading_sec) + num(pm.total_reading_sec),
			pdf_counts: mergePdfCounts(bm.pdf_counts, pm.pdf_counts)
		},
		p_usermeta_diff: {
			total_engagement_sec: num(bu.total_engagement_sec) + num(pu.total_engagement_sec),
			session: isObj(bu.session) ? bu.session : isObj(pu.session) ? pu.session : null,
			engagement: mergeEngagement(bu.engagement, pu.engagement),
			// Pending state first so the fresher live state wins on conflicts —
			// including a device mirror the older payload may have carried.
			state: { ...(isObj(pu.state) ? pu.state : {}), ...(isObj(bu.state) ? bu.state : {}) },
			device: isObj(bu.device) ? bu.device : isObj(pu.device) ? pu.device : null
		}
	};
}

/**
 * Would this payload survive the server's "nothing worth storing" guard?
 * Checked after merging, so a parked payload is what pulls the request out.
 */
export function hasSendableData(data) {
	const m = isObj(data?.p_metrics_diff) ? data.p_metrics_diff : {};
	const u = isObj(data?.p_usermeta_diff) ? data.p_usermeta_diff : {};
	return (
		num(m.total_reading_sec) > 0 ||
		Object.keys(isObj(m.pdf_counts) ? m.pdf_counts : {}).length > 0 ||
		num(u.total_engagement_sec) > 0 ||
		Object.keys(isObj(u.engagement?.clicks) ? u.engagement.clicks : {}).length > 0 ||
		isObj(u.session)
	);
}

/**
 * Device context is sent on every flush, but `merge_daily_stats` (dashboard-
 * authored SQL, not in this repo's migrations) only persists state / session /
 * engagement / total_engagement_sec and silently DROPS `usermeta.device` — so
 * 30 days of rows, every one of them, stored no platform or app version and
 * anything grouped by "app" read as empty.
 *
 * `state` survives verbatim (verified against the live table), so mirror the
 * device there too. The top-level `device` is still sent: the day the RPC is
 * fixed, both channels are already populated and no backfill is needed.
 */
export function attachDeviceState(usermeta, device, fallbackState) {
	if (!isObj(device)) return usermeta;
	const u = isObj(usermeta) ? usermeta : {};
	const state = isObj(u.state)
		? u.state
		: isObj(fallbackState)
			? fallbackState
			: { updated: new Date().toISOString() };
	return { ...u, device, state: { ...state, device } };
}
