import { execSync } from 'node:child_process';

console.log('[build-static] Building static frontend for Tauri / Capacitor...');
execSync('vite build', {
	stdio: 'inherit',
	env: {
		...process.env,
		BUILD_TARGET: 'static'
	}
});
console.log('[build-static] Static build complete.');
