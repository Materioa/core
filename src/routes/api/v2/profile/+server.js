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
			tier: null,
			isPlusUser: !!(u.isPlusUser ?? u.is_plus_user),
			isLiteUser: !!(u.isLiteUser ?? u.is_lite_user),
			hasAdminPrivileges: !!(u.hasAdminPrivileges ?? u.has_admin_privileges)
		};
	} catch (err) {
		console.warn('Auth-service profile proxy failed:', err?.message);
		return null;
	}
}
export async function GET({ request }) {
	try {
		const token = tokenFromRequest(request);
		if (!token) return json({ user: null }, { status: 401 });
		const decoded = verifyToken(token);
		const uid = decoded?.id || decoded?.sub;
		if (uid) {
			let tier = null;
			let isPro = false;
			let admin = false;
			try {
				const client = supabaseAdmin || supabase;
				const { data, error } = await client
					.from('users')
					.select('tier, is_pro')
					.eq('id', uid)
					.limit(1);
				const row = !error && Array.isArray(data) ? data[0] : null;
				if (row) {
					tier = row.tier ?? null;
					isPro = !!row.is_pro;
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
			const isPlusUser = isPro || ['plus', 'pro'].includes(String(tier || '').toLowerCase());
			return json({ user: { id: uid, tier, isPlusUser, isLiteUser: false, hasAdminPrivileges: admin } });
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
