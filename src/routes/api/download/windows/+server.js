import { redirect } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';

export async function GET({ fetch, platform }) {
	const env = platform?.env || process?.env || {};
	const GITHUB_REPO = env.GITHUB_REPOSITORY;
	let targetUrl = env.DOWNLOAD_WINDOWS_URL || null;

	if (!targetUrl && GITHUB_REPO) {
		try {
			const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
				headers: {
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'Materio-Download-Router'
				}
			});

			if (res.ok) {
				const data = await res.json();
				const winAsset = data.assets?.find(a => a.name.endsWith('.msi') || a.name.endsWith('.exe'));
				if (winAsset?.browser_download_url) {
					targetUrl = winAsset.browser_download_url;
				}
			}
		} catch (err) {
			console.warn('Error resolving Windows download URL from GitHub:', err);
		}
	}

	if (targetUrl) {
		throw redirect(302, targetUrl);
	}

	try {
		const filePath = path.resolve('static/downloads/Materio-Windows-Setup.msi');
		if (fs.existsSync(filePath)) {
			const fileBuffer = fs.readFileSync(filePath);
			return new Response(fileBuffer, {
				headers: {
					'Content-Type': 'application/x-msi',
					'Content-Disposition': 'attachment; filename="Materio-Windows-Setup.msi"',
					'Content-Length': fileBuffer.length.toString()
				}
			});
		}
	} catch {}

	throw redirect(302, '/downloads/Materio-Windows-Setup.msi');
}
