// Polyfill Bun's missing v8.startupSnapshot.isBuildingSnapshot implementation (required by bson/mongodb)
const v8 = process.getBuiltinModule?.('v8');
if (v8?.startupSnapshot) {
	try {
		v8.startupSnapshot.isBuildingSnapshot();
	} catch {
		v8.startupSnapshot.isBuildingSnapshot = () => false;
	}
}

import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
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
