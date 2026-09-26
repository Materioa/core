// Bulk-uploads every variable from the svelte root `.env` file to the
// Cloudflare Worker as secrets (`wrangler secret bulk`), so nothing has to
// be pasted into the dashboard by hand.
//
// - PUBLIC_* / VITE_* vars are ALSO embedded by Vite at build time; uploading
//   them as secrets is harmless duplication that keeps one source of truth.
// - Secrets are passed via a temp JSON file (never CLI args) and deleted after.
// - Requires `wrangler login` (or CLOUDFLARE_API_TOKEN env) beforehand.
//
// Usage: `npm run env:push` (or automatically via `npm run deploy`).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const envPath = join(root, '.env');

function parseDotenv(src) {
	const out = {};
	for (const rawLine of src.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		let val = line.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (!key || !val) continue;
		out[key] = val;
	}
	return out;
}

const env = parseDotenv(readFileSync(envPath, 'utf8'));
const keys = Object.keys(env);
if (keys.length === 0) {
	console.error(`No variables found in ${envPath}`);
	process.exit(1);
}

const tmpFile = join(tmpdir(), `materio-secrets-${Date.now()}.json`);
// Prefer the project-local wrangler binary (works even when npx/PATH is limited).
let wranglerBin = 'wrangler';
try {
	const localBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
	if (existsSync(localBin)) wranglerBin = localBin;
} catch {}
try {
	writeFileSync(tmpFile, JSON.stringify(env), 'utf8');
	console.log(`Pushing ${keys.length} secrets from .env to Cloudflare...`);
	execFileSync(wranglerBin, ['secret', 'bulk', tmpFile], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
	console.log(`Done. Uploaded: ${keys.join(', ')}`);
} finally {
	try { unlinkSync(tmpFile); } catch {}
}
