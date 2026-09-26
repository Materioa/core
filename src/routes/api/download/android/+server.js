import { redirect } from '@sveltejs/kit';

const FALLBACK_URL = 'https://github.com/Materioa/core/releases/download/v2.0.4/Materio-Android.apk';

export async function GET({ fetch, platform }) {
	const env = platform?.env || process?.env || {};
	const GITHUB_REPO = env.GITHUB_REPOSITORY || 'Materioa/core';
	let targetUrl = env.DOWNLOAD_ANDROID_URL || null;

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
				const apk = data.assets?.find(a => a.name === 'Materio-Android.apk')
					|| data.assets?.find(a => a.name.endsWith('.apk'));
				if (apk?.browser_download_url) {
					targetUrl = apk.browser_download_url;
				}
			}
		} catch (err) {
			console.warn('Error resolving Android download URL from GitHub:', err);
		}
	}

	if (!targetUrl) {
		targetUrl = FALLBACK_URL;
	}

	throw redirect(302, targetUrl);
}
