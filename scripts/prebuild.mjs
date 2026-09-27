// Pre-build cleanup: the Cloudflare adapter deletes .svelte-kit/cloudflare
// before writing, which fails with EPERM on Windows when a previous build's
// files are locked (running preview/wrangler, AV scan, etc.). Clearing it
// here with retries keeps `npm run build` / `npm run deploy` working.
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const svelteRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(svelteRoot, '.svelte-kit', 'cloudflare');

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

// Generate unique build ID & update build history like parent Materio project
try {
	const buildId = crypto.randomUUID();
	const timestamp = new Date().toISOString();
	const projectRoot = path.join(svelteRoot, '..');

	const dataDirs = [
		path.join(svelteRoot, '_data'),
		path.join(svelteRoot, 'static', 'assets', 'data'),
		path.join(projectRoot, '_data')
	];

	for (const dataDir of dataDirs) {
		if (!existsSync(dataDir)) {
			mkdirSync(dataDir, { recursive: true });
		}

		// Write build_id.json
		const jsonPath = path.join(dataDir, 'build_id.json');
		writeFileSync(jsonPath, JSON.stringify({ build_id: buildId, build_timestamp: timestamp }, null, 2), 'utf8');

		// Write build_id.yml if in a _data directory
		if (dataDir.endsWith('_data')) {
			const yamlContent = `# Build ID generated during build\nbuild_id: "${buildId}"\nbuild_timestamp: "${timestamp}"\n`;
			writeFileSync(path.join(dataDir, 'build_id.yml'), yamlContent, 'utf8');
		}

		// Maintain build history in build_history.json
		const historyPath = path.join(dataDir, 'build_history.json');
		let buildHistory = [];
		if (existsSync(historyPath)) {
			try {
				buildHistory = JSON.parse(readFileSync(historyPath, 'utf8'));
				if (!Array.isArray(buildHistory)) buildHistory = [];
			} catch {
				buildHistory = [];
			}
		}

		const buildEntry = {
			build_id: buildId,
			timestamp: timestamp,
			date: new Date(timestamp).toLocaleDateString(),
			time: new Date(timestamp).toLocaleTimeString(),
			build_number: buildHistory.length + 1
		};

		buildHistory.unshift(buildEntry);
		if (buildHistory.length > 100) buildHistory = buildHistory.slice(0, 100);
		writeFileSync(historyPath, JSON.stringify(buildHistory, null, 2), 'utf8');
	}
	console.log(`[prebuild] Generated Build ID: ${buildId} (${timestamp})`);
} catch (err) {
	console.warn('[prebuild] Build ID generation error:', err.message);
}
