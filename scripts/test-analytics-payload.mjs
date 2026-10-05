// Unit tests for src/lib/utils/analytics-payload.js — the pure rules shared by
// the analytics flush path and its pending-retry path.
//
// Run: node scripts/test-analytics-payload.js   (also part of `npm test`)
import assert from 'node:assert/strict';
import {
	todayLocalISO,
	isServerAcceptableDate,
	chooseDate,
	mergeAnalyticsPayload,
	hasSendableData,
	attachDeviceState
} from '../src/lib/utils/analytics-payload.js';

let ran = 0;
const test = (name, fn) => {
	fn();
	ran++;
	console.log('  ok - ' + name);
};

// ---------------------------------------------------------------- date window
test('todayLocalISO emits YYYY-MM-DD', () => {
	assert.match(todayLocalISO(), /^\d{4}-\d{2}-\d{2}$/);
	assert.equal(todayLocalISO(), todayLocalISO(new Date()));
});

test('isServerAcceptableDate mirrors the server -2..+1 day window', () => {
	const day = (offset) => {
		const d = new Date();
		d.setUTCDate(d.getUTCDate() + offset);
		return d.toISOString().slice(0, 10);
	};
	assert.equal(isServerAcceptableDate(todayLocalISO()), true);
	assert.equal(isServerAcceptableDate(day(1)), true);
	assert.equal(isServerAcceptableDate(day(-2)), true);
	assert.equal(isServerAcceptableDate(day(-3)), false, 'older than window must be rejected');
	assert.equal(isServerAcceptableDate(day(2)), false);
	assert.equal(isServerAcceptableDate('2026-13-45'), false);
	assert.equal(isServerAcceptableDate('nope'), false);
	assert.equal(isServerAcceptableDate(null), false);
});

test('chooseDate re-dates a stale slot instead of sending a guaranteed 400', () => {
	const stale = '2020-01-01';
	assert.equal(chooseDate(todayLocalISO(), stale), todayLocalISO());
	// A still-valid parked date keeps its original day (attribution preserved).
	assert.equal(chooseDate('2020-01-01', dayValid(-1)), dayValid(-1));
	function dayValid(offset) {
		const d = new Date();
		d.setUTCDate(d.getUTCDate() + offset);
		return d.toISOString().slice(0, 10);
	}
});

// -------------------------------------------------------------------- merging
const base = () => ({
	p_anon_id: 'anon-base-123',
	p_date: todayLocalISO(),
	p_metrics_diff: { total_reading_sec: 100, pdf_counts: { alpha: { count: 2, time_sec: 40 } } },
	p_usermeta_diff: {
		total_engagement_sec: 80,
		session: { ua: 'live', path: '/' },
		engagement: { clicks: { share: 2 }, scroll: 5, zoom: 1, shortcuts: {} },
		state: { updated: 'live', settings: { theme: 'dark' } },
		device: null
	},
	p_user_id: 'user-1'
});

const parked = () => ({
	p_anon_id: 'anon-base-123',
	p_date: '2020-01-01',
	p_metrics_diff: { total_reading_sec: 91, pdf_counts: { 'week 1': { count: 1, time_sec: 31 } } },
	p_usermeta_diff: {
		total_engagement_sec: 91,
		session: null,
		engagement: { clicks: { share: 1, download: 3 }, scroll: 9, zoom: 0, shortcuts: {} },
		state: { updated: 'old', device: { platform: 'windows', appVersion: '1.2.3' } },
		device: { platform: 'windows', appVersion: '1.2.3' }
	},
	p_user_id: null
});

test('merge sums metrics and engagement instead of overwriting', () => {
	const m = mergeAnalyticsPayload(base(), parked());
	assert.equal(m.p_metrics_diff.total_reading_sec, 191);
	assert.equal(m.p_usermeta_diff.total_engagement_sec, 171);
	assert.equal(m.p_metrics_diff.pdf_counts.alpha.count, 2);
	assert.equal(m.p_metrics_diff.pdf_counts['week 1'].count, 1, 'parked PDF opens are kept');
	assert.equal(m.p_usermeta_diff.engagement.clicks.share, 3);
	assert.equal(m.p_usermeta_diff.engagement.clicks.download, 3);
	assert.equal(m.p_usermeta_diff.engagement.scroll, 14);
});

test('merge re-dates a stale parked payload', () => {
	assert.equal(mergeAnalyticsPayload(base(), parked()).p_date, todayLocalISO());
});

test('merge prefers live session/state, but never loses parked device', () => {
	const m = mergeAnalyticsPayload(base(), parked());
	assert.equal(m.p_usermeta_diff.session.ua, 'live');
	assert.equal(m.p_usermeta_diff.state.updated, 'live');
	assert.equal(m.p_usermeta_diff.state.settings.theme, 'dark');
	assert.deepEqual(m.p_usermeta_diff.state.device, { platform: 'windows', appVersion: '1.2.3' });
	assert.deepEqual(m.p_usermeta_diff.device, { platform: 'windows', appVersion: '1.2.3' });
});

test('merge keeps the live user id and identity', () => {
	const m = mergeAnalyticsPayload(base(), parked());
	assert.equal(m.p_user_id, 'user-1');
	assert.equal(m.p_anon_id, 'anon-base-123');
});

test('merge stays inside the server rejection limits (30 opens / 8 per item)', () => {
	const heavy = {
		p_date: todayLocalISO(),
		p_metrics_diff: {
			total_reading_sec: 10,
			pdf_counts: Object.fromEntries(
				Array.from({ length: 30 }, (_, i) => [`pdf ${i}`, { count: 8, time_sec: 5 }])
			)
		},
		p_usermeta_diff: { total_engagement_sec: 0, engagement: {} }
	};
	const m = mergeAnalyticsPayload(heavy, JSON.parse(JSON.stringify(heavy)));
	const counts = Object.values(m.p_metrics_diff.pdf_counts);
	const totalOpens = counts.reduce((sum, c) => sum + c.count, 0);
	assert.ok(totalOpens <= 30, `total opens ${totalOpens} must stay <= 30`);
	assert.ok(counts.every((c) => c.count <= 8), 'per-item count must stay <= 8');
	assert.ok(Object.keys(m.p_metrics_diff.pdf_counts).length <= 30, 'entry cap');
});

test('merge with a payload-less pending is a no-op', () => {
	assert.deepEqual(mergeAnalyticsPayload(base(), null), base());
	assert.deepEqual(mergeAnalyticsPayload(base(), 'garbage'), base());
});

// ------------------------------------------------------------ sendable guard
test('hasSendableData accepts every kind of real payload', () => {
	assert.equal(hasSendableData(base()), true);
	assert.equal(
		hasSendableData({
			p_metrics_diff: { total_reading_sec: 0, pdf_counts: {} },
			p_usermeta_diff: { total_engagement_sec: 0, session: { ua: 'x' }, engagement: { clicks: {} } }
		}),
		true,
		'a session alone is enough (once-daily session record)'
	);
	assert.equal(
		hasSendableData({
			p_metrics_diff: { total_reading_sec: 0, pdf_counts: {} },
			p_usermeta_diff: { total_engagement_sec: 0, session: null, engagement: { clicks: { a: 1 } } }
		}),
		true
	);
	assert.equal(
		hasSendableData({
			p_metrics_diff: { total_reading_sec: 0, pdf_counts: {} },
			p_usermeta_diff: { total_engagement_sec: 0, session: null, engagement: { clicks: {} } }
		}),
		false,
		'never send an empty payload'
	);
	assert.equal(hasSendableData({}), false);
});

// -------------------------------------------------------------- device mirror
test('attachDeviceState mirrors device into state (the field the RPC keeps)', () => {
	const u = attachDeviceState(
		{ total_engagement_sec: 5, state: { updated: 'x', settings: { theme: 'dark' } } },
		{ platform: 'windows', appVersion: '1.2.3' },
		{ updated: 'fallback', settings: {} }
	);
	assert.deepEqual(u.device, { platform: 'windows', appVersion: '1.2.3' });
	assert.deepEqual(u.state.device, { platform: 'windows', appVersion: '1.2.3' });
	assert.equal(u.state.updated, 'x', 'existing state is preserved');
	assert.equal(u.state.settings.theme, 'dark');
});

test('attachDeviceState creates state when absent, and is inert without device', () => {
	const withState = attachDeviceState({ total_engagement_sec: 1 }, { platform: 'windows' }, {
		updated: 'fb',
		settings: { theme: 'light' }
	});
	assert.equal(withState.state.updated, 'fb', 'caller fallback state is used');
	assert.equal(withState.state.device.platform, 'windows');

	const unchanged = { state: null, total_engagement_sec: 1 };
	assert.equal(attachDeviceState(unchanged, null, {}), unchanged, 'web (no device) is untouched');
	assert.equal(attachDeviceState(unchanged, undefined, {}), unchanged);
});

console.log(`\n${ran} analytics-payload tests passed`);
