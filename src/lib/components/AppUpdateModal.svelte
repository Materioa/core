<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { isTauri, toApiUrl } from '$lib/config/api.js';

	// Types of nudges: 'update' | 'offline'
	let activeNudge = $state<'update' | 'offline' | null>(null);
	let newVersion = $state<string>('');
	let isInstalling = $state(false);
	let dismissed = $state(false);

	// Compare semver: returns true if v1 > v2
	function isNewerVersion(remote: string, current: string): boolean {
		const clean = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
		const [r1, r2, r3] = clean(remote);
		const [c1, c2, c3] = clean(current);
		if (r1 !== c1) return r1 > c1;
		if (r2 !== c2) return r2 > c2;
		return (r3 || 0) > (c3 || 0);
	}

	async function checkForUpdates() {
		// Only show desktop app update nudges; never show restart/update nudge on the website
		if (!browser || !isTauri) return;
		try {
			// In Tauri v2, if @tauri-apps/plugin-updater is configured:
			if (isTauri && (window as any).__TAURI__?.updater) {
				try {
					const { check } = (window as any).__TAURI__.updater;
					const update = await check();
					if (update?.available) {
						newVersion = update.version;
						activeNudge = 'update';
						return;
					}
				} catch (e) {
					console.warn('Tauri updater check failed, falling back to API:', e);
				}
			}

			// Fallback: check /api/releases/latest
			// @ts-ignore
			const builtVersion = typeof __MATERIO_APP_VERSION__ !== 'undefined' ? __MATERIO_APP_VERSION__ : null;
			const currentAppVersion = (window as any).__MATERIO_APP_VERSION__ || builtVersion || '2.1.0';
			const res = await fetch(toApiUrl('/api/releases/latest'));
			if (res.ok) {
				const data = await res.json();
				if (data.version && isNewerVersion(data.version, currentAppVersion)) {
					newVersion = data.version;
					activeNudge = 'update';
				}
			}
		} catch (err) {
			console.warn('Update check failed:', err);
		}
	}

	async function handleInstallAndRestart() {
		isInstalling = true;
		try {
			// Tauri desktop app native updater & restarter
			if (isTauri) {
				const invoke = (window as any).__TAURI__?.core?.invoke || (window as any).__TAURI__?.invoke;
				if (typeof invoke === 'function') {
					let downloadUrl = null;
					try {
						const res = await fetch(toApiUrl('/api/releases/latest'));
						if (res.ok) {
							const data = await res.json();
							downloadUrl = data.windows?.standaloneUrl || data.windows?.downloadUrl || null;
						}
					} catch {}

					await invoke('install_update_and_restart', { downloadUrl });
					return;
				}
			}

			// Fallback: navigate to downloads
			window.location.href = '/downloads';
		} catch (err) {
			console.error('Failed to install update:', err);
			window.location.href = '/downloads';
		} finally {
			isInstalling = false;
			activeNudge = null;
		}
	}

	function handleViewDownloads() {
		if (typeof (window as any).__materioSetTab === 'function') {
			(window as any).__materioSetTab('downloads');
		} else {
			window.location.href = '/downloads';
		}
		activeNudge = null;
	}

	function handleDismiss() {
		dismissed = true;
		activeNudge = null;
	}

	onMount(() => {
		if (!browser || !isTauri) return;

		// 1. Offline & Online detection for desktop app
		const handleOffline = () => {
			if (!dismissed) activeNudge = 'offline';
		};
		const handleOnline = () => {
			if (activeNudge === 'offline') activeNudge = null;
		};

		if (!navigator.onLine) {
			activeNudge = 'offline';
		}

		window.addEventListener('offline', handleOffline);
		window.addEventListener('online', handleOnline);

		// 2. Check for updates (desktop app only)
		checkForUpdates();
		const interval = setInterval(checkForUpdates, 30 * 60 * 1000); // Check every 30m

		// Expose global trigger for settings page check button
		(window as any).__materioCheckUpdateModal = checkForUpdates;

		return () => {
			window.removeEventListener('offline', handleOffline);
			window.removeEventListener('online', handleOnline);
			clearInterval(interval);
		};
	});
</script>

{#if isTauri && activeNudge}
	<aside
		id="appNudgeCard"
		class="leaderboard-nudge-card"
		role="status"
		aria-live="polite"
	>
		{#if activeNudge === 'update'}
			<img src="/assets/img/greet.webp" alt="Update" class="leaderboard-nudge-image" />
			<div class="leaderboard-nudge-content">
				<h4 class="leaderboard-nudge-title">Update Available</h4>
				<p class="leaderboard-nudge-text">
					{#if newVersion}
						Version {newVersion.replace(/^v/, '')} is ready to install.
					{:else}
						A new version is ready to install.
					{/if}
				</p>
				<div class="leaderboard-nudge-actions">
					<button
						type="button"
						class="leaderboard-nudge-btn leaderboard-nudge-btn-primary"
						disabled={isInstalling}
						onclick={handleInstallAndRestart}
					>
						{isInstalling ? 'Updating and Restarting' : 'Update and Restart'}
					</button>
					<button
						type="button"
						class="leaderboard-nudge-btn"
						onclick={handleDismiss}
					>
						Later
					</button>
				</div>
				<p class="nudge-hint">
					<span>Automatically restarts Materio with latest enhancements</span>
				</p>
			</div>
		{:else if activeNudge === 'offline'}
			<img src="/assets/img/internet.webp" alt="Offline" class="leaderboard-nudge-image" />
			<div class="leaderboard-nudge-content">
				<h4 class="leaderboard-nudge-title">Offline Mode</h4>
				<p class="leaderboard-nudge-text">
					You are currently offline. Access your downloaded materials in the library.
				</p>
				<div class="leaderboard-nudge-actions">
					<button
						type="button"
						class="leaderboard-nudge-btn leaderboard-nudge-btn-primary"
						onclick={handleViewDownloads}
					>
						View Downloads
					</button>
					<button
						type="button"
						class="leaderboard-nudge-btn"
						onclick={handleDismiss}
					>
						Dismiss
					</button>
				</div>
				<p class="nudge-hint">
					<span>Save PDFs for offline reading by clicking bookmark in viewer</span>
				</p>
			</div>
		{/if}
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
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: #fdfcf9;
		box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.1), 0 2px 6px rgba(0, 0, 0, 0.04);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, sans-serif !important;
		animation: nudgeSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	:global(body.dark-mode) .leaderboard-nudge-card,
	:global(html.dark) .leaderboard-nudge-card {
		background: #202020;
		border-color: rgba(255, 255, 255, 0.12);
		box-shadow: 0 8px 28px -4px rgba(0, 0, 0, 0.45);
	}

	.leaderboard-nudge-image {
		width: 52px;
		height: 52px;
		object-fit: contain;
		justify-self: center;
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
		color: #1a1a1a;
		letter-spacing: -0.01em;
	}

	:global(body.dark-mode) .leaderboard-nudge-title,
	:global(html.dark) .leaderboard-nudge-title {
		color: #f5f5f5;
	}

	.leaderboard-nudge-text {
		margin: 0;
		color: #555555;
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, sans-serif !important;
		font-size: 13px;
		line-height: 1.35;
		font-weight: 400;
	}

	:global(body.dark-mode) .leaderboard-nudge-text,
	:global(html.dark) .leaderboard-nudge-text {
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
		border: 1px solid rgba(0, 0, 0, 0.2);
		background: transparent;
		color: #333;
		border-radius: 10px;
		padding: 5px 12px;
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, sans-serif !important;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.18s ease;
	}

	:global(body.dark-mode) .leaderboard-nudge-btn,
	:global(html.dark) .leaderboard-nudge-btn {
		border-color: rgba(255, 255, 255, 0.22);
		color: #eee;
	}

	.leaderboard-nudge-btn:hover {
		background: rgba(0, 0, 0, 0.05);
	}

	:global(body.dark-mode) .leaderboard-nudge-btn:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.leaderboard-nudge-btn-primary {
		background: #ff6600 !important;
		border-color: #ff6600 !important;
		color: #fff !important;
	}

	.leaderboard-nudge-btn-primary:hover {
		background: #e65c00 !important;
		border-color: #e65c00 !important;
		transform: translateY(-1px);
	}

	.leaderboard-nudge-btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.nudge-hint {
		margin: 3px 0 0;
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, sans-serif !important;
		font-size: 11px;
		color: #777777;
		display: flex;
		align-items: flex-start;
		gap: 4px;
		line-height: 1.25;
	}

	:global(body.dark-mode) .nudge-hint,
	:global(html.dark) .nudge-hint {
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
</style>
