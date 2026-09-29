<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { toApiUrl, isCapacitor } from '$lib/config/api.js';
	import { getSignupUrl } from '$lib/utils/app-urls.js';

	// Ports of the bottom-right nudge cards:
	//   1. Offline nudge  — "You seem to be offline…" + View Downloads.
	//   2. Update nudge (Capacitor/mobile) — mirrors the desktop update
	//      nudge: "Version X is ready" + Update button that triggers the
	//      in-app self-update (temp download -> system installer).
	//   3. Leaderboard top-50 nudge — anonymous top-50 readers get a
	//      once-a-day "Create an account to see where you rank" card.
	// One card at a time; offline > update > top-50.

	let card = $state(null); // 'offline' | 'upd' | 'top50' | null
	let top50Rank = $state(0);
	let mobileVersion = $state('');
	let mobileApkUrl = $state('');
	let dismissedOffline = $state(false);

	const TOP50_KEY = 'materio_top50_nudge_shown_on';

	function todayKey() {
		try {
			return new Date().toISOString().split('T')[0];
		} catch {
			return '';
		}
	}

	function isLoggedIn() {
		try {
			return Boolean(localStorage.getItem('materio_user') || localStorage.getItem('materio_auth_token'));
		} catch {
			return false;
		}
	}

	// --- Offline card (mirrors room showOfflineNudge) ---
	function syncOfflineCard() {
		if (!browser) return;
		let online = true;
		try {
			online = navigator.onLine;
		} catch {}
		if (!online) {
			if (!dismissedOffline) card = 'offline';
		} else if (card === 'offline') {
			card = null;
			dismissedOffline = false;
		}
	}

	function handleViewDownloads() {
		card = null;
		try {
			if (typeof window.__materioSetTab === 'function') {
				window.__materioSetTab('downloads');
				return;
			}
		} catch {}
		window.location.href = '/downloads';
	}

	function dismissOffline() {
		dismissedOffline = true;
		card = null;
	}

	// --- Update nudge (Capacitor/mobile; desktop uses AppUpdateModal) ---
	function localAppVersion() {
		try {
			if (typeof __MATERIO_APP_VERSION__ !== 'undefined' && __MATERIO_APP_VERSION__) {
				return String(__MATERIO_APP_VERSION__).replace(/^v/, '');
			}
		} catch {}
		try {
			if (window.__MATERIO_APP_VERSION__) return String(window.__MATERIO_APP_VERSION__).replace(/^v/, '');
		} catch {}
		return '2.1.14';
	}

	function isNewerVersion(remote, current) {
		const clean = (v) => String(v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
		const r = clean(remote);
		const c = clean(current);
		const len = Math.max(r.length, c.length);
		for (let i = 0; i < len; i++) {
			if ((r[i] || 0) !== (c[i] || 0)) return (r[i] || 0) > (c[i] || 0);
		}
		return false;
	}

	async function maybeShowUpdate() {
		if (!browser || !isCapacitor) return false;
		try {
			if (card) return false;
			try {
				if (!navigator.onLine) return false;
			} catch {}
			const res = await fetch(toApiUrl('/api/releases/latest'));
			if (!res.ok) return false;
			const data = await res.json();
			const androidInfo = data.android || {};
			// Only prompt when this release actually ships an APK.
			if (androidInfo.available === false || !androidInfo.downloadUrl) return false;
			const remoteVer = String(androidInfo.version || data.version || '').replace(/^v/, '');
			if (!remoteVer || !isNewerVersion(remoteVer, localAppVersion())) return false;
			const rawUrl = androidInfo.downloadUrl;
			if (typeof rawUrl !== 'string' || !rawUrl.startsWith('https://') || !rawUrl.split('?')[0].toLowerCase().endsWith('.apk')) {
				return false;
			}
			if (card) return false;
			mobileVersion = remoteVer;
			mobileApkUrl = rawUrl;
			card = 'upd';
			try {
				window.__materioUpdateNudgeShown = true;
			} catch {}
			return true;
		} catch {
			return false;
		}
	}

	function handleMobileUpdate() {
		const url = mobileApkUrl;
		const ver = mobileVersion;
		card = null;
		try {
			if (url && window.AndroidBridge?.downloadAndInstallUpdate) {
				window.AndroidBridge.downloadAndInstallUpdate(url, ver || '');
				return;
			}
		} catch {}
		handleViewDownloads();
	}

	function dismissUpdate() {
		card = null;
	}

	// --- Leaderboard top-50 card (mirrors room maybeShowTop50Nudge) ---
	async function maybeShowTop50() {
		if (!browser) return;
		try {
			if (card) return; // offline (or another card) wins
			if (isLoggedIn()) return;
			try {
				if (!navigator.onLine) return;
			} catch {}
			if (localStorage.getItem(TOP50_KEY) === todayKey()) return;
			const res = await fetch(toApiUrl('/api/v2/features?action=leaderboard'));
			if (!res.ok) return;
			const data = await res.json();
			const rank = Number(data?.requester?.rank || 0);
			const isAnonymous = data?.requester?.isAnonymous === true;
			if (!rank || rank > 50 || !isAnonymous) return;
			if (card) return;
			top50Rank = rank;
			card = 'top50';
			try {
				localStorage.setItem(TOP50_KEY, todayKey());
			} catch {}
		} catch {
			// Never break the page on nudge failures.
		}
	}

	function handleCreateAccount() {
		card = null;
		try {
			const origin = window.location.origin.includes('localhost') ? 'https://getmaterio.app' : window.location.origin;
			window.location.href = getSignupUrl(`${origin}/auth/callback`);
		} catch {
			window.location.href = getSignupUrl();
		}
	}

	function dismissTop50() {
		card = null;
	}

	onMount(() => {
		if (!browser) return;
		syncOfflineCard();
		window.addEventListener('offline', syncOfflineCard);
		window.addEventListener('online', syncOfflineCard);
		// Update nudge first (mobile), then top-50 only if nothing claimed the slot.
		maybeShowUpdate().then((shown) => {
			if (!shown) {
				setTimeout(maybeShowTop50, 4000);
			}
		});
		return () => {
			window.removeEventListener('offline', syncOfflineCard);
			window.removeEventListener('online', syncOfflineCard);
		};
	});
</script>

{#if card === 'offline'}
	<aside id="offlineNudgeCard" class="leaderboard-nudge-card" role="status" aria-live="polite">
		<img src="/assets/img/internet.webp" alt="" class="leaderboard-nudge-image" />
		<div class="leaderboard-nudge-content">
			<h4 class="leaderboard-nudge-title">You're Offline</h4>
			<p class="leaderboard-nudge-text">You seem to be offline.<br />Want to access your downloaded materials?</p>
			<div class="leaderboard-nudge-actions">
				<button type="button" class="leaderboard-nudge-btn leaderboard-nudge-btn-primary" onclick={handleViewDownloads}>
					View Downloads
				</button>
				<button type="button" class="leaderboard-nudge-btn" onclick={dismissOffline}>
					Dismiss
				</button>
			</div>
			<p class="nudge-hint">
				<span>Save PDFs for offline reading by clicking bookmark in viewer</span>
			</p>
		</div>
	</aside>
{:else if card === 'upd'}
	<aside id="appUpdateNudgeCard" class="leaderboard-nudge-card" role="status" aria-live="polite">
		<img src="/assets/img/greet.webp" alt="Update" class="leaderboard-nudge-image" />
		<div class="leaderboard-nudge-content">
			<h4 class="leaderboard-nudge-title">Update Available</h4>
			<p class="leaderboard-nudge-text">
				{#if mobileVersion}
					Version {mobileVersion} is ready to install.
				{:else}
					A new version is ready to install.
				{/if}
			</p>
			<div class="leaderboard-nudge-actions">
				<button type="button" class="leaderboard-nudge-btn leaderboard-nudge-btn-primary" onclick={handleMobileUpdate}>
					Update
				</button>
				<button type="button" class="leaderboard-nudge-btn" onclick={dismissUpdate}>
					Later
				</button>
			</div>
			<p class="nudge-hint">
				<span>Downloads in the background, one tap to install</span>
			</p>
		</div>
	</aside>
{:else if card === 'top50'}
	<aside id="leaderboardTop50Nudge" class="leaderboard-nudge-card" role="status" aria-live="polite">
		<img src="/assets/img/greet.webp" alt="" class="leaderboard-nudge-image" />
		<div class="leaderboard-nudge-content">
			<h4 class="leaderboard-nudge-title">Top {top50Rank || 50} Reader</h4>
			<p class="leaderboard-nudge-text">Hey, you might be on the leaderboard.<br />Create an account to see where you rank!</p>
			<div class="leaderboard-nudge-actions">
				<button type="button" class="leaderboard-nudge-btn leaderboard-nudge-btn-primary" onclick={handleCreateAccount}>
					Create Account
				</button>
				<button type="button" class="leaderboard-nudge-btn" onclick={dismissTop50}>
					Nah I'm good
				</button>
			</div>
		</div>
	</aside>
{/if}

<style>
	.leaderboard-nudge-card {
		position: fixed;
		right: 18px;
		bottom: 18px;
		z-index: 1200;
		width: min(360px, calc(100vw - 24px));
		display: grid;
		grid-template-columns: 60px 1fr;
		gap: 12px;
		align-items: center;
		padding: 12px 14px;
		border-radius: 18px;
		border: 1px solid var(--color-border-light, rgba(0, 0, 0, 0.12));
		background: var(--color-bg-card, #fdfcf9);
		box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.1), 0 2px 6px rgba(0, 0, 0, 0.04);
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, sans-serif !important;
		animation: nudgeSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	:global(body.coffee-mode) .leaderboard-nudge-card {
		background: #f7f1e7;
		border-color: rgba(111, 78, 55, 0.18);
		box-shadow: 0 8px 24px -4px rgba(78, 52, 46, 0.15);
	}

	:global(body.dark-mode) .leaderboard-nudge-card,
	:global(body.coffee-dark-mode) .leaderboard-nudge-card,
	:global(html.dark) .leaderboard-nudge-card {
		background: #202020;
		border-color: rgba(255, 255, 255, 0.12);
		box-shadow: 0 8px 28px -4px rgba(0, 0, 0, 0.45);
	}

	:global(body.coffee-dark-mode) .leaderboard-nudge-card {
		background: #241914 !important;
		border-color: rgba(255, 255, 255, 0.14) !important;
	}

	:global(body.amoled-mode) .leaderboard-nudge-card {
		background: #000000 !important;
		border-color: rgba(255, 255, 255, 0.16) !important;
	}

	.leaderboard-nudge-image {
		width: 52px;
		height: 52px;
		object-fit: contain;
		justify-self: center;
	}

	:global(body.dark-mode) .leaderboard-nudge-image,
	:global(body.coffee-dark-mode) .leaderboard-nudge-image,
	:global(body.amoled-mode) .leaderboard-nudge-image {
		filter: invert(1);
	}

	.leaderboard-nudge-content {
		display: grid;
		gap: 4px;
	}

	.leaderboard-nudge-title {
		margin: 0;
		font-family: 'Quadrant', 'Quadrant Notepad', Georgia, serif !important;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.25;
		color: var(--color-text-primary, #1a1a1a);
		letter-spacing: -0.01em;
	}

	:global(body.dark-mode) .leaderboard-nudge-title,
	:global(body.coffee-dark-mode) .leaderboard-nudge-title {
		color: #f5f5f5;
	}

	.leaderboard-nudge-text {
		margin: 0;
		color: var(--color-text-secondary, #555555);
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, sans-serif !important;
		font-size: 13px;
		line-height: 1.35;
		font-weight: 400;
	}

	:global(body.dark-mode) .leaderboard-nudge-text,
	:global(body.coffee-dark-mode) .leaderboard-nudge-text {
		color: #b0b0b0;
	}

	.leaderboard-nudge-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
		margin-top: 4px;
	}

	.leaderboard-nudge-btn {
		border: 1px solid var(--color-border-light, rgba(0, 0, 0, 0.2));
		background: transparent;
		color: var(--color-text-primary, #333);
		border-radius: 10px;
		padding: 5px 12px;
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, sans-serif !important;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.18s ease;
	}

	:global(body.dark-mode) .leaderboard-nudge-btn,
	:global(body.coffee-dark-mode) .leaderboard-nudge-btn {
		border-color: rgba(255, 255, 255, 0.22);
		color: #eee;
	}

	.leaderboard-nudge-btn:hover {
		background: rgba(0, 0, 0, 0.05);
	}

	:global(body.dark-mode) .leaderboard-nudge-btn:hover,
	:global(body.coffee-dark-mode) .leaderboard-nudge-btn:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.leaderboard-nudge-btn-primary {
		background: var(--accent, var(--color-primary, #ff6600)) !important;
		border-color: var(--accent, var(--color-primary, #ff6600)) !important;
		color: #fff !important;
	}

	.leaderboard-nudge-btn-primary:hover {
		filter: brightness(0.92);
		transform: translateY(-1px);
	}

	.nudge-hint {
		margin: 3px 0 0;
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, sans-serif !important;
		font-size: 11px;
		color: var(--color-text-muted, #777777);
		line-height: 1.25;
	}

	:global(body.dark-mode) .nudge-hint,
	:global(body.coffee-dark-mode) .nudge-hint {
		color: #999999;
	}

	@keyframes nudgeSlideIn {
		from {
			opacity: 0;
			transform: translateY(16px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@media (max-width: 768px) {
		.leaderboard-nudge-card {
			right: 12px;
			left: 12px;
			bottom: calc(18px + env(safe-area-inset-bottom, 0px));
			width: auto;
			grid-template-columns: 52px 1fr;
			padding: 10px 12px;
			border-radius: 16px;
		}

		.leaderboard-nudge-image {
			width: 44px;
			height: 44px;
		}

		.leaderboard-nudge-text {
			font-size: 12px;
		}
	}
</style>
