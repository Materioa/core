// Pre-build cleanup: the Cloudflare adapter deletes .svelte-kit/cloudflare
// before writing, which fails with EPERM on Windows when a previous build's
// files are locked (running preview/wrangler, AV scan, etc.). Clearing it
// here with retries keeps `npm run build` / `npm run deploy` working.
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.svelte-kit', 'cloudflare');

for (let attempt = 1; attempt <= 6; attempt++) {
	try {
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
		break;
	} catch (err) {
		if (attempt === 6) {
			console.warn('[prebuild] could not remove .svelte-kit/cloudflare. A running `vite dev` file watcher locks it — stop the svelte dev server (and preview/wrangler) and rebuild.');
		} else {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
}
