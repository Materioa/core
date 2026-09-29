import { json } from '@sveltejs/kit';
import { verifyToken, supabaseAdmin, supabase } from '$lib/server/supabase.js';

function tokenFromRequest(request) {
	const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
	if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
	try {
		const cookie = request.headers.get('cookie') || '';
		const parts = Object.fromEntries(
			cookie.split(';').map((c) => {
				const idx = c.indexOf('=');
				if (idx < 0) return [c.trim(), ''];
				return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1))];
			})
		);
		return parts.token || parts.materio_auth_token || parts.materio_token || null;
	} catch {
		return null;
	}
}

// Powers the Oread download-button / Thinklet Plus checks (showbtnrq.js,
// thinklet.js) and any other client that needs the signed-in user's plan.
// Tokens are minted by the AUTH service, so verification is: local JWT
// fast-path first (same-secret deployments), then a server-to-server proxy
// to the auth service's own /api/v2/profile (no browser CORS involved).
const AUTH_URL =
	(typeof process !== 'undefined' && process.env
		? process.env.PUBLIC_MATERIO_AUTH_URL || process.env.VITE_MATERIO_AUTH_URL
		: null) || 'https://auth.getmaterio.app';

async function verifyViaAuthService(token) {
	try {
		const res = await fetch(`${AUTH_URL}/api/v2/profile`, {
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
		});
		if (!res.ok) return null;
		const data = await res.json();
		const u = data?.user || {};
		return {
			id: u.id ?? null,
			tier: u.tier ?? null,
			role: u.role ?? u.user_role ?? null,
			isPlusUser: isPlusLike(u),
			isLiteUser: !!(u.isLiteUser ?? u.is_lite_user),
			hasAdminPrivileges: isAdminLike(u)
		};
	} catch (err) {
		console.warn('Auth-service profile proxy failed:', err?.message);
		return null;
	}
}

// Broad plan/role matching: the auth service, Supabase rows and JWTs spell
// "paid" and "admin" many ways (is_plus_user, tier:'super', role:'owner',
// …). Missing a spelling silently hides Plus-gated UI, so accept the superset.
const PLUS_TIERS = new Set(['plus', 'pro', 'super', 'admin', 'premium', 'lifetime', 'ultimate', 'vip', 'paid']);
const ADMIN_ROLES = new Set(['admin', 'superadmin', 'super-admin', 'super', 'superuser', 'owner', 'root', 'staff']);

function str(v) {
	return String(v ?? '').trim().toLowerCase();
}

function isPlusLike(u) {
	if (!u || typeof u !== 'object') return false;
	if (u.isPlusUser === true || u.is_plus_user === true || u.is_plus === true ||
		u.isPlus === true || u.plus === true || u.is_pro === true || u.isPro === true ||
		u.isLiteUser === true || u.is_lite_user === true) return true;
	if (PLUS_TIERS.has(str(u.tier))) return true;
	if (PLUS_TIERS.has(str(u.role)) || ADMIN_ROLES.has(str(u.role))) return true;
	return false;
}

function isAdminLike(u) {
	if (!u || typeof u !== 'object') return false;
	if (u.hasAdminPrivileges === true || u.has_admin_privileges === true ||
		u.isAdmin === true || u.is_admin === true ||
		u.isSuperUser === true || u.is_superuser === true ||
		u.isSuperAdmin === true || u.is_super_admin === true ||
		u.superuser === true || u.is_staff === true) return true;
	// Product tier names: 'super' is the admin tier, 'admin' likewise.
	if (ADMIN_ROLES.has(str(u.role)) || ADMIN_ROLES.has(str(u.user_role))) return true;
	const tier = str(u.tier);
	if (tier === 'super' || tier === 'admin') return true;
	return false;
}
export async function GET({ request }) {
	try {
		const token = tokenFromRequest(request);
		if (!token) return json({ user: null }, { status: 401 });
		const decoded = verifyToken(token);
		const uid = decoded?.id || decoded?.sub;
		if (uid) {
			// Canonical entitlement columns (see auth migrations: Plus(UI)
			// -> is_lite_user, Pro(UI) -> is_plus_user, Super(UI) ->
			// has_admin_privileges). There are no tier/is_pro columns — the
			// old select silently errored and every real user read as free.
			let isPlusUser = false;
			let isLiteUser = false;
			let admin = false;
			try {
				const client = supabaseAdmin || supabase;
				const { data, error } = await client
					.from('users')
					.select('has_admin_privileges, is_plus_user, is_lite_user')
					.eq('id', uid)
					.limit(1);
				const row = !error && Array.isArray(data) ? data[0] : null;
				if (row) {
					isPlusUser = !!row.is_plus_user;
					isLiteUser = !!row.is_lite_user;
					admin = !!row.has_admin_privileges;
				}
			} catch (err) {
				console.warn('Profile lookup failed:', err?.message);
			}
			try {
				const adminList = (process.env.MATERIO_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '')
					.split(',')
					.map((s) => s.trim().toLowerCase())
					.filter(Boolean);
				const email = String(decoded?.email || '').toLowerCase();
				if (email && adminList.includes(email)) admin = true;
			} catch {}
			const role = decoded?.role ?? decoded?.user_role ?? decoded?.app_metadata?.role ?? null;
			const decodedSignals = { ...(decoded || {}), role };
			if (isAdminLike(decodedSignals)) admin = true;
			if (isPlusLike(decodedSignals)) isPlusUser = true;
			return json({ user: { id: uid, role, isPlusUser, isLiteUser, hasAdminPrivileges: admin } });
		}

		// Local secret didn't sign this token — ask the auth service that minted it.
		const proxied = await verifyViaAuthService(token);
		if (proxied) return json({ user: proxied });
		return json({ user: null }, { status: 401 });
	} catch (error) {
		console.error('Profile endpoint failed:', error);
		return json({ user: { isPlusUser: false, hasAdminPrivileges: false }, error: 'Unable to load profile' }, { status: 500 });
	}
}
