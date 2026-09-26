import { json } from '@sveltejs/kit';

const FALLBACK_VERSION = 'v2.0.4';

function formatBytes(bytes) {
	if (!bytes || bytes <= 0) return null;
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(1)} MB`;
}

export async function GET({ fetch, url, platform }) {
	const env = platform?.env || process?.env || {};
	const GITHUB_REPO = env.GITHUB_REPOSITORY;
	const origin = url.origin || '';
	const defaultData = {
		version: FALLBACK_VERSION,
		name: `Materio ${FALLBACK_VERSION}`,
		published_at: '2026-04-15',
		notes: 'Official native apps for Windows and Android with full offline study vault and local MCP server.',
		windows: {
			name: 'Materio-Windows-Setup.msi',
			version: FALLBACK_VERSION,
			downloadUrl: `${origin}/api/download/windows`,
			directDownload: `${origin}/api/download/windows`,
			size: null,
			format: 'MSI Installer'
		},
		android: {
			name: 'Materio-Android.apk',
			version: FALLBACK_VERSION,
			downloadUrl: `${origin}/api/download/android`,
			directDownload: `${origin}/api/download/android`,
			size: null,
			format: 'APK'
		}
	};

	if (GITHUB_REPO) {
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
				let windowsAsset = data.assets?.find(a => a.name.endsWith('.msi') || a.name.endsWith('.exe'));
				let androidAsset = data.assets?.find(a => a.name.endsWith('.apk'));

				return json({
					version,
					name: data.name || `Materio ${version}`,
					published_at: data.published_at || defaultData.published_at,
					notes: data.body || defaultData.notes,
					windows: {
						name: windowsAsset?.name || defaultData.windows.name,
						version,
						downloadUrl: windowsAsset?.browser_download_url || `${origin}/api/download/windows`,
						directDownload: `${origin}/api/download/windows`,
						size: windowsAsset ? formatBytes(windowsAsset.size) : null,
						format: windowsAsset?.name?.endsWith('.exe') ? 'EXE Installer' : 'MSI Installer'
					},
					android: {
						name: androidAsset?.name || defaultData.android.name,
						version,
						downloadUrl: androidAsset?.browser_download_url || `${origin}/api/download/android`,
						directDownload: `${origin}/api/download/android`,
						size: androidAsset ? formatBytes(androidAsset.size) : null,
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
	}

	return json(defaultData, {
		headers: {
			'Cache-Control': 'public, max-age=60'
		}
	});
}
