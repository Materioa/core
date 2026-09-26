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

export default defineConfig({
	define: {
		__MATERIO_APP_VERSION__: JSON.stringify(appVersion)
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
