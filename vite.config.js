// Polyfill Bun's missing v8.startupSnapshot.isBuildingSnapshot implementation (required by bson/mongodb)
const v8 = process.getBuiltinModule?.('v8');
if (v8?.startupSnapshot) {
	try {
		v8.startupSnapshot.isBuildingSnapshot();
	} catch {
		v8.startupSnapshot.isBuildingSnapshot = () => false;
	}
}

import fs from 'node:fs';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const appVersion = process.env.APP_VERSION || pkg.version || '2.1.0';

let buildId = 'b4e216ad-fa9d-40c8-ac8c-f835f93cffd0';
try {
	const buildIdPaths = [
		new URL('./_data/build_id.json', import.meta.url),
		new URL('../_data/build_id.json', import.meta.url),
		new URL('./static/assets/data/build_id.json', import.meta.url)
	];
	for (const p of buildIdPaths) {
		if (fs.existsSync(p)) {
			const b = JSON.parse(fs.readFileSync(p, 'utf8'));
			if (b.build_id) {
				buildId = b.build_id;
				break;
			}
		}
	}
} catch {}

export default defineConfig({
	define: {
		__MATERIO_APP_VERSION__: JSON.stringify(appVersion),
		__MATERIO_BUILD_ID__: JSON.stringify(buildId)
	},
	plugins: [sveltekit()],
	assetsInclude: ['**/*.md'],
	ssr: {
		external: [
			'googleapis',
			'@google-analytics/data',
			'mongodb',
			'razorpay',
			'web-push',
			'nodemailer'
		],
		noExternal: ['@hugeicons/svelte', '@hugeicons/core-free-icons', '@lisse/svelte', 'clsx', 'tailwind-merge']
	}
});
