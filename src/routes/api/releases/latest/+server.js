import { json } from '@sveltejs/kit';

const FALLBACK_VERSION = 'v2.1.14';
const DEFAULT_REPO = 'Materioa/core';

// In-memory cache for Cloudflare Workers / Node runtime to prevent GitHub API rate limits
let cachedRelease = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Upper bound for serving a stale cached release when GitHub is
// unreachable/rate-limited. Without this, an unauthenticated worker (60
// req/hr per egress IP) can get stuck on an old tag forever and native
// apps never see new releases. Past this age we fall through to the
// static fallback instead of lying with an outdated version.
const STALE_MAX_MS = 30 * 60 * 1000; // 30 minutes

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
				url: null,
				available: false,
				signature: ''
			},
			'android-arm64': {
				url: null,
				available: false
			}
		},
		windows: {
			name: null,
			version: null,
			available: false,
			downloadUrl: null,
			msiUrl: null,
			standaloneUrl: null,
			size: null,
			format: 'EXE Installer'
		},
		android: {
			name: null,
			version: null,
			available: false,
			downloadUrl: null,
			size: null,
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

			const assetName = (a) => (a && a.name) || '';
			const pickWindows = (release) => {
				const assets = release?.assets || [];
				const setup = assets.find(a => /materio_.*_x64-setup\.exe/i.test(assetName(a)))
					|| assets.find(a => assetName(a) === 'Materio-Windows-Setup.exe' || assetName(a).includes('-setup.exe'));
				const msi = assets.find(a => assetName(a).endsWith('.msi'));
				const standalone = assets.find(a => assetName(a).includes('Standalone')
					|| (assetName(a).endsWith('.exe') && !assetName(a).includes('-setup')));
				return { primary: setup || msi || standalone, msi, standalone };
			};
			const pickApk = (release) => {
				const assets = release?.assets || [];
				return assets.find(a => /materio_.*_arm64\.apk/i.test(assetName(a)))
					|| assets.find(a => assetName(a) === 'Materio-Android.apk')
					|| assets.find(a => assetName(a).endsWith('.apk') && !assetName(a).includes('debug'));
			};

			const win = pickWindows(data);
			const winSetup = win.primary;
			const winMsi = win.msi;
			const winStandalone = win.standalone;
			const primaryWin = winSetup;

			let apkAsset = pickApk(data);
			let apkRelease = data;

			// `releases/latest` is the newest release of ANY kind, and releases here
			// are routinely single-platform: the Windows-only builds ship an .exe +
			// .msi and no .apk. Reporting that as "Android unavailable" left the
			// downloads page pointing at whatever hardcoded APK it fell back to
			// (v2.1.49), while the newest real Android build was v2.1.92 and the
			// page never learned it existed.
			//
			// So when the newest release has no APK, walk back through recent
			// releases and use the newest one that actually shipped an APK. The two
			// cards then each show their own real, current version — which is the
			// point of having per-platform sections at all.
			if (!apkAsset) {
				try {
					const listRes = await fetch(
						`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`,
						{ headers: reqHeaders }
					);
					if (listRes.ok) {
						for (const candidate of await listRes.json()) {
							if (candidate?.draft) continue;
							const found = pickApk(candidate);
							if (found) {
								apkAsset = found;
								apkRelease = candidate;
								break;
							}
						}
					}
				} catch (err) {
					// A lookup failure here only costs Android freshness; the
					// Windows answer is already resolved and must not be lost.
					console.warn('Failed to scan for the latest APK release:', err);
				}
			}

			const winAvailable = Boolean(primaryWin?.browser_download_url);
			const apkAvailable = Boolean(apkAsset?.browser_download_url);
			const apkVersion = apkRelease?.tag_name || version;
			const apkDate = apkRelease?.published_at || pubDate;

			const releasePayload = {
				version,
				pub_date: pubDate,
				published_at: pubDate,
				name: data.name || `Materio ${version}`,
				notes: data.body || defaultData.notes,
				platforms: {
					'windows-x86_64': {
						url: primaryWin?.browser_download_url || null,
						available: winAvailable,
						signature: ''
					},
					'android-arm64': {
						url: apkAsset?.browser_download_url || null,
						available: apkAvailable,
						version: apkVersion
					}
				},
				windows: {
					name: primaryWin?.name || null,
					version: winAvailable ? version : null,
					available: winAvailable,
					downloadUrl: primaryWin?.browser_download_url || null,
					msiUrl: winMsi?.browser_download_url || null,
					standaloneUrl: winStandalone?.browser_download_url || null,
					size: primaryWin ? formatBytes(primaryWin.size) : null,
					format: primaryWin?.name?.endsWith('.msi') ? 'MSI Installer' : 'EXE Installer'
				},
				android: {
					name: apkAsset?.name || null,
					// Its own release's version, not the top-level one: on a
					// Windows-only release these legitimately differ.
					version: apkAvailable ? apkVersion : null,
					available: apkAvailable,
					downloadUrl: apkAsset?.browser_download_url || null,
					size: apkAsset ? formatBytes(apkAsset.size) : null,
					pub_date: apkDate,
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

	// If fetch failed but we have a fresh-ish cache, serve it briefly instead
	// of the fallback — but never older than STALE_MAX_MS, or clients get
	// pinned to an outdated version (e.g. missing a new release).
	if (cachedRelease && (now - lastFetchTime < STALE_MAX_MS)) {
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
