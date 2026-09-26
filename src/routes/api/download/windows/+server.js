import { redirect } from '@sveltejs/kit';

const FALLBACK_URL = 'https://github.com/Materioa/core/releases/download/v2.0.4/Materio_2.0.4_x64-setup.exe';

export async function GET({ fetch, platform, url }) {
	const env = platform?.env || process?.env || {};
	const GITHUB_REPO = env.GITHUB_REPOSITORY || 'Materioa/core';
	const format = url.searchParams.get('format') || '';
	let targetUrl = env.DOWNLOAD_WINDOWS_URL || null;

	if (!targetUrl) {
		try {
			const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
				headers: {
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'Materio-Download-Router'
				}
			});

			if (res.ok) {
				const data = await res.json();
				if (format === 'msi') {
					const msi = data.assets?.find(a => a.name.endsWith('.msi'));
					if (msi?.browser_download_url) targetUrl = msi.browser_download_url;
				} else {
					const winSetup = data.assets?.find(a => a.name.includes('-setup.exe'));
					const winMsi = data.assets?.find(a => a.name.endsWith('.msi'));
					const winExe = data.assets?.find(a => a.name.endsWith('.exe'));
					const chosen = winSetup || winMsi || winExe;
					if (chosen?.browser_download_url) {
						targetUrl = chosen.browser_download_url;
					}
				}
			}
		} catch (err) {
			console.warn('Error resolving Windows download URL from GitHub:', err);
		}
	}

	if (!targetUrl) {
		targetUrl = format === 'msi'
			? 'https://github.com/Materioa/core/releases/download/v2.0.4/Materio_2.0.4_x64_en-US.msi'
			: FALLBACK_URL;
	}

	throw redirect(302, targetUrl);
}
