import { json } from '@sveltejs/kit';

const FALLBACK_VERSION = 'v2.1.14';
const DEFAULT_REPO = 'Materioa/core';

// In-memory cache for Cloudflare Workers / Node runtime to prevent GitHub API rate limits
let cachedRelease = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function formatBytes(bytes) {
	if (!bytes || bytes <= 0) return null;
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(1)} MB`;
}

export async function GET({ fetch, platform }) {
	const env = platform?.env || (typeof process !== 'undefined' ? process?.env : {}) || {};
	const GITHUB_REPO = env.GITHUB_REPOSITORY || DEFAULT_REPO;

	// Check if in-memory cache is still fresh
	const now = Date.now();
	if (cachedRelease && (now - lastFetchTime < CACHE_TTL_MS)) {
		return json(cachedRelease, {
			headers: {
				'Cache-Control': 'public, max-age=300, s-maxage=600',
				'X-Release-Source': 'memory-cache'
			}
		});
	}

	const defaultData = {
		version: FALLBACK_VERSION,
		pub_date: new Date().toISOString(),
		published_at: new Date().toISOString(),
		name: `Materio Apps ${FALLBACK_VERSION}`,
		notes: 'Official native apps for Windows and Android with full offline study vault and local MCP server.',
		platforms: {
			'windows-x86_64': {
				url: `https://github.com/${GITHUB_REPO}/releases/download/${FALLBACK_VERSION}/Materio-Windows-Setup.exe`,
				signature: ''
			},
			'android-arm64': {
				url: `https://github.com/${GITHUB_REPO}/releases/download/${FALLBACK_VERSION}/Materio-Android.apk`
			}
		},
		windows: {
			name: 'Materio-Windows-Setup.exe',
			version: FALLBACK_VERSION,
			downloadUrl: `https://github.com/${GITHUB_REPO}/releases/download/${FALLBACK_VERSION}/Materio-Windows-Setup.exe`,
			msiUrl: `https://github.com/${GITHUB_REPO}/releases/download/${FALLBACK_VERSION}/Materio_${FALLBACK_VERSION.replace('v', '')}_x64_en-US.msi`,
			standaloneUrl: `https://github.com/${GITHUB_REPO}/releases/download/${FALLBACK_VERSION}/Materio-Windows-Standalone.exe`,
			size: '78.5 MB',
			format: 'EXE Installer'
		},
		android: {
			name: 'Materio-Android.apk',
			version: FALLBACK_VERSION,
			downloadUrl: `https://github.com/${GITHUB_REPO}/releases/download/${FALLBACK_VERSION}/Materio-Android.apk`,
			size: '53.9 MB',
			format: 'APK'
		}
	};

	try {
		const reqHeaders = {
			'Accept': 'application/vnd.github.v3+json',
			'User-Agent': 'Materio-App-Updater/2.1'
		};
		if (env.GITHUB_TOKEN) {
			reqHeaders['Authorization'] = `token ${env.GITHUB_TOKEN}`;
		}

		const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
			headers: reqHeaders
		});

		if (res.ok) {
			const data = await res.json();
			const version = data.tag_name || FALLBACK_VERSION;
			const pubDate = data.published_at || new Date().toISOString();

			const winSetup = data.assets?.find(a => a.name === 'Materio-Windows-Setup.exe' || a.name.includes('-setup.exe'));
			const winMsi = data.assets?.find(a => a.name.endsWith('.msi'));
			const winStandalone = data.assets?.find(a => a.name.includes('Standalone') || (a.name.endsWith('.exe') && !a.name.includes('-setup')));
			const apkAsset = data.assets?.find(a => a.name === 'Materio-Android.apk')
				|| data.assets?.find(a => a.name.endsWith('.apk') && !a.name.includes('debug'));

			const primaryWin = winSetup || winMsi || winStandalone;

			const releasePayload = {
				version,
				pub_date: pubDate,
				published_at: pubDate,
				name: data.name || `Materio ${version}`,
				notes: data.body || defaultData.notes,
				platforms: {
					'windows-x86_64': {
						url: primaryWin?.browser_download_url || defaultData.windows.downloadUrl,
						signature: ''
					},
					'android-arm64': {
						url: apkAsset?.browser_download_url || defaultData.android.downloadUrl
					}
				},
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
			};

			// Cache response
			cachedRelease = releasePayload;
			lastFetchTime = now;

			return json(releasePayload, {
				headers: {
					'Cache-Control': 'public, max-age=300, s-maxage=600',
					'X-Release-Source': 'github-live'
				}
			});
		}
	} catch (err) {
		console.warn('Failed to query GitHub repository releases:', err);
	}

	// If fetch failed but we have a stale cache, serve stale cache instead of fallback
	if (cachedRelease) {
		return json(cachedRelease, {
			headers: {
				'Cache-Control': 'public, max-age=60',
				'X-Release-Source': 'stale-cache'
			}
		});
	}

	return json(defaultData, {
		headers: {
			'Cache-Control': 'public, max-age=60',
			'X-Release-Source': 'default-fallback'
		}
	});
}
