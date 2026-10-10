// Polyfill Bun's missing v8.startupSnapshot.isBuildingSnapshot implementation (required by bson/mongodb)
const v8 = process.getBuiltinModule?.('v8');
if (v8?.startupSnapshot) {
	try {
		v8.startupSnapshot.isBuildingSnapshot();
	} catch {
		v8.startupSnapshot.isBuildingSnapshot = () => false;
	}
}

import cloudflareAdapter from '@sveltejs/adapter-cloudflare';
import staticAdapter from '@sveltejs/adapter-static';

const isStaticBuild = process.env.BUILD_TARGET === 'static' || process.env.TAURI_ENV_PLATFORM;
const adapter = isStaticBuild ? staticAdapter({ fallback: 'index.html', pages: 'build', assets: 'build' }) : cloudflareAdapter();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Accessibility hints are non-blocking style warnings emitted for
	// pre-existing patterns across the app - keep them out of the dev log.
	onwarn: (warning, handler) => {
		if (warning.code && warning.code.startsWith('a11y')) return;
		handler(warning);
	},
	kit: {
		adapter,
		prerender: {
			entries: ['*', '/docs', '/docs/'],
			handleHttpError: ({ status, path, referrer, message }) => {
				// Ignore 404s for pages we haven't built yet
				if (status === 404) {
					console.warn(`404 during prerender: ${path} (linked from ${referrer})`);
					return;
				}
				throw new Error(message);
			},
			handleMissingId: 'warn',
			handleUnseenRoutes: 'warn',
			handleEntryGeneratorMismatch: 'warn'
		}
	}
};

export default config;
