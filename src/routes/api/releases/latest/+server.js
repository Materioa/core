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

			let win = pickWindows(data);
			let primaryWin = win.primary;
			let winRelease = data;
			let apkAsset = pickApk(data);
			let apkRelease = data;

			// `releases/latest` is the newest release of ANY kind, and releases here
			// are routinely single-platform. Resolve each platform to the newest
			// release that actually shipped ITS asset.
			//
			// Doing this for Android only was a real bug: the desktop updater gates
			// on `windows.available` (AppUpdateModal returns "current" when it is
			// false, without comparing versions), so an Android-only latest release
			// made the Windows app report up-to-date and never see the newer
			// Windows build sitting one tag back.
			//
			// Both platforms get the same treatment now, so `version` per platform is
			// the newest release a user of that platform can actually install.
			const needsScan = !primaryWin || !apkAsset;
			let scanned = null;
			if (needsScan) {
				try {
					const listRes = await fetch(
						`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`,
						{ headers: reqHeaders }
					);
					if (listRes.ok) scanned = await listRes.json();
				} catch (err) {
					// Costs freshness for whichever platform is missing; never fatal.
					console.warn('Failed to scan releases for per-platform versions:', err);
				}
			}

			if (Array.isArray(scanned)) {
				for (const candidate of scanned) {
					if (candidate?.draft) continue;
					// Windows first so BOTH resolve in one pass, oldest-gap aware:
					// a Windows-only and an Android-only release can interleave.
					if (!primaryWin) {
						const found = pickWindows(candidate);
						if (found.primary) {
							primaryWin = found.primary;
							win = found;
							winRelease = candidate;
						}
					}
					if (!apkAsset) {
						const apk = pickApk(candidate);
						if (apk) {
							apkAsset = apk;
							apkRelease = candidate;
						}
					}
					if (primaryWin && apkAsset) break;
				}
			}

			const winSetup = win.primary;
			const winMsi = win.msi;
			const winStandalone = win.standalone;

			const winAvailable = Boolean(primaryWin?.browser_download_url);
		// The Windows release's OWN tag, not the newest tag of any kind. The
		// desktop updater compares this against the installed version, so it must
		// describe a release that actually ships a Windows installer.
		const winVersion = winRelease?.tag_name || version;
		const winDate = winRelease?.published_at || pubDate;
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
					// Its own release's tag, not the newest tag of any kind.
					version: winAvailable ? winVersion : null,
					pub_date: winDate,
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
