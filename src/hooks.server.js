// Polyfill Bun's missing v8.startupSnapshot.isBuildingSnapshot implementation (required by bson/mongodb)
const v8 = process.getBuiltinModule?.('v8');
if (v8?.startupSnapshot) {
	try {
		v8.startupSnapshot.isBuildingSnapshot();
	} catch {
		v8.startupSnapshot.isBuildingSnapshot = () => false;
	}
}

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	// Cloudflare Workers expose vars/secrets via `platform.env`, but this
	// codebase reads `process.env` in server code. Mirror worker bindings
	// onto process.env so existing code works unchanged on Cloudflare.
	// Values are identical for every request, so this is race-safe.
	try {
		const platformEnv = event.platform?.env;
		if (platformEnv && typeof process !== 'undefined' && process.env) {
			for (const [k, v] of Object.entries(platformEnv)) {
				if (typeof v === 'string' && process.env[k] === undefined) {
					process.env[k] = v;
				}
			}
		}
	} catch {}

	const pathname = event.url.pathname;

	// Only handle rewrites for API and well-known paths, avoid accessing searchParams for prerendered pages
	const needsRewrite = pathname.startsWith('/api/') || pathname.startsWith('/.well-known/') || pathname.startsWith('/share/') || pathname === '/llm' || pathname === '/sharelink-info';

	let shouldRewrite = false;
	let newUrl = null;

	if (needsRewrite) {
		const url = event.url;
		const searchParams = url.searchParams;

		function rewrite(newPath, newParams = {}) {
			const rewritten = new URL(newPath, url.origin);
			for (const [k, v] of searchParams.entries()) {
				rewritten.searchParams.set(k, v);
			}
			for (const [k, v] of Object.entries(newParams)) {
				if (v !== undefined && v !== null) rewritten.searchParams.set(k, v);
			}
			event.url = rewritten;
			shouldRewrite = true;
			newUrl = rewritten;
		}

		if (pathname === '/.well-known/openid-configuration') {
			rewrite('/api/v2/auth', { action: 'oidc_metadata' });
		} else if (pathname === '/.well-known/oauth-authorization-server') {
			rewrite('/api/v2/auth', { action: 'oauth_metadata' });
		} else if (pathname === '/.well-known/jwks.json') {
			rewrite('/api/v2/auth', { action: 'jwks' });
		} else if (pathname === '/api/v2/promotions') {
			rewrite('/api/v2/features', { action: 'promotions' });
		} else if (pathname === '/api/v2/notifications') {
			rewrite('/api/v2/features', { action: 'notifications' });
		} else if (pathname === '/api/v2/releases') {
			rewrite('/api/v2/features', { action: 'releases' });
		} else if (pathname === '/api/v2/examdata') {
			rewrite('/api/v2/features', { action: 'examdata' });
		} else if (pathname.startsWith('/api/v2/features/')) {
			const sub = pathname.replace('/api/v2/features/', '');
			rewrite('/api/v2/features', { path: sub });
		} else if (pathname === '/api/v2/health/report') {
			rewrite('/api/v2/health', { action: 'report' });
		} else if (pathname === '/api/v2/health/alert') {
			rewrite('/api/v2/health', { action: 'alert' });
		} else if (pathname === '/api/v2/health/test-incident-email') {
			rewrite('/api/v2/health', { action: 'test-incident-email' });
		} else if (pathname === '/api/v2/invites/sharelink-info') {
			rewrite('/api/v2/invites');
		} else if (pathname.startsWith('/api/v2/invites/')) {
			const sub = pathname.replace('/api/v2/invites/', '');
			rewrite('/api/v2/invites', { path: sub });
		} else if (pathname.startsWith('/api/v2/chat/')) {
			const sub = pathname.replace('/api/v2/chat/', '');
			rewrite('/api/v2/chat', { path: sub });
		} else if (pathname === '/sharelink-info') {
			rewrite('/api/v2/invites');
		} else if (pathname.startsWith('/share/llm/')) {
			const mask = pathname.replace('/share/llm/', '');
			rewrite('/api/v2/features', { action: 'pdf-share', subAction: 'resolve-llm', llmMaskId: mask });
		} else if (pathname === '/llm') {
			rewrite('/api/v2/features', { action: 'pdf-share', subAction: 'resolve-llm' });
		} else if (pathname.startsWith('/api/v1/')) {
			const rest = pathname.replace('/api/v1/', '');
			rewrite(`/api/v2/${rest}`);
		}
	}

	// Handle CORS preflight for API routes
	if (pathname.startsWith('/api/') && event.request.method === 'OPTIONS') {
		const origin = event.request.headers.get('origin');
		let corsOrigin = '*';
		try {
			const { isAllowedOrigin } = await import('$lib/server/cors-origins.js');
			if (origin && isAllowedOrigin(origin) && origin !== 'null') corsOrigin = origin;
		} catch {}
		const preflightHeaders = {
			'Access-Control-Allow-Origin': corsOrigin,
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
			'Access-Control-Max-Age': '86400',
			'Vary': 'Origin'
		};
		if (corsOrigin !== '*') {
			preflightHeaders['Access-Control-Allow-Credentials'] = 'true';
		}
		return new Response(null, {
			status: 204,
			headers: preflightHeaders
		});
	}

	const response = event.platform?.env
		? await (await import('$lib/server/mongodb.js')).withMongoRequest(() => resolve(event))
		: await resolve(event);

	// Add CORS headers to API responses (Cloudflare compatible)
	if (pathname.startsWith('/api/')) {
		const origin = event.request.headers.get('origin');
		try {
			const { isAllowedOrigin } = await import('$lib/server/cors-origins.js').catch(() => ({ isAllowedOrigin: () => false }));
			let corsOrigin = '*';
			if (origin && isAllowedOrigin(origin) && origin !== 'null') corsOrigin = origin;
			response.headers.set('Access-Control-Allow-Origin', corsOrigin);
			response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
			response.headers.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
			if (corsOrigin !== '*') {
				response.headers.set('Access-Control-Allow-Credentials', 'true');
			}
			response.headers.set('Vary', 'Origin');
		} catch {}
		if (pathname.startsWith('/api/')) {
			response.headers.set('Cache-Control', 'no-store');
		}
	}

	return response;
}
