import { json } from '@sveltejs/kit';

const FALLBACK_VERSION = 'v2.1.0';
const DEFAULT_REPO = 'Materioa/core';

function formatBytes(bytes) {
	if (!bytes || bytes <= 0) return null;
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(1)} MB`;
}

export async function GET({ fetch, platform }) {
	const env = platform?.env || process?.env || {};
	const GITHUB_REPO = env.GITHUB_REPOSITORY || DEFAULT_REPO;

	const defaultData = {
		version: FALLBACK_VERSION,
		name: `Materio Apps ${FALLBACK_VERSION}`,
		published_at: new Date().toISOString(),
		notes: 'Official native apps for Windows and Android with full offline study vault and local MCP server.',
		windows: {
			name: 'Materio_2.1.0_x64-setup.exe',
			version: FALLBACK_VERSION,
			downloadUrl: `https://github.com/${GITHUB_REPO}/releases/download/v2.1.0/Materio_2.1.0_x64-setup.exe`,
			msiUrl: `https://github.com/${GITHUB_REPO}/releases/download/v2.1.0/Materio_2.1.0_x64_en-US.msi`,
			standaloneUrl: `https://github.com/${GITHUB_REPO}/releases/download/v2.1.0/Materio-Windows-Standalone.exe`,
			size: '48.5 MB',
			format: 'EXE Installer'
		},
		android: {
			name: 'Materio-Android.apk',
			version: FALLBACK_VERSION,
			downloadUrl: `https://github.com/${GITHUB_REPO}/releases/download/v2.1.0/Materio-Android.apk`,
			size: '55.0 MB',
			format: 'APK'
		}
	};

	try {
		const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
			headers: {
				'Accept': 'application/vnd.github.v3+json',
				'User-Agent': 'Materio-App-Checker'
			}
		});

		if (res.ok) {
			const data = await res.json();
			const version = data.tag_name || FALLBACK_VERSION;
			const winSetup = data.assets?.find(a => a.name.includes('-setup.exe'));
			const winMsi = data.assets?.find(a => a.name.endsWith('.msi'));
			const winStandalone = data.assets?.find(a => a.name.includes('Standalone') || (a.name.endsWith('.exe') && !a.name.includes('-setup')));
			const apkAsset = data.assets?.find(a => a.name === 'Materio-Android.apk')
				|| data.assets?.find(a => a.name.endsWith('.apk'));

			const primaryWin = winSetup || winMsi || winStandalone;

			return json({
				version,
				name: data.name || `Materio ${version}`,
				published_at: data.published_at || defaultData.published_at,
				notes: data.body || defaultData.notes,
				windows: {
					name: primaryWin?.name || defaultData.windows.name,
					version,
					downloadUrl: primaryWin?.browser_download_url || defaultData.windows.downloadUrl,
					msiUrl: winMsi?.browser_download_url || defaultData.windows.msiUrl,
					standaloneUrl: winStandalone?.browser_download_url || defaultData.windows.standaloneUrl,
					size: primaryWin ? formatBytes(primaryWin.size) : defaultData.windows.size,
					format: primaryWin?.name?.endsWith('.msi') ? 'MSI Installer' : 'EXE Installer'
				},
				android: {
					name: apkAsset?.name || defaultData.android.name,
					version,
					downloadUrl: apkAsset?.browser_download_url || defaultData.android.downloadUrl,
					size: apkAsset ? formatBytes(apkAsset.size) : defaultData.android.size,
					format: 'APK'
				}
			}, {
				headers: {
					'Cache-Control': 'public, max-age=300, s-maxage=600'
				}
			});
		}
	} catch (err) {
		console.warn('Failed to query GitHub repository releases:', err);
	}

	return json(defaultData, {
		headers: {
			'Cache-Control': 'public, max-age=60'
		}
	});
}
