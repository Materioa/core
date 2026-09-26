<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { isTauri } from '$lib/config/api.js';

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
		if (!browser) return;
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
			const res = await fetch('/api/releases/latest');
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
			// Tauri v2 native updater
			if (isTauri && (window as any).__TAURI__?.updater) {
				const { check } = (window as any).__TAURI__.updater;
				const update = await check();
				if (update?.available) {
					// Download and install
					await update.downloadAndInstall();
					// Relaunch the application
					if ((window as any).__TAURI__?.process?.relaunch) {
						await (window as any).__TAURI__.process.relaunch();
						return;
					}
				}
			}

			// Fallback: navigate to downloads or reload
			window.location.href = '/api/download/windows';
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
		if (!browser) return;

		// 1. Offline & Online detection matching parent Materio
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

		// 2. Check for updates (desktop app check)
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

{#if activeNudge}
	<aside
		id="appNudgeCard"
		class="leaderboard-nudge-card"
		role="status"
		aria-live="polite"
	>
		{#if activeNudge === 'update'}
			<img src="/assets/img/greet.webp" alt="Update" class="leaderboard-nudge-image" />
			<div class="leaderboard-nudge-content">
				<p class="leaderboard-nudge-text">
					New update available {newVersion ? `(${newVersion})` : ''}!<br />
					Ready to download and install.
				</p>
				<div class="leaderboard-nudge-actions">
					<button
						type="button"
						class="leaderboard-nudge-btn leaderboard-nudge-btn-primary"
						disabled={isInstalling}
						onclick={handleInstallAndRestart}
					>
						{isInstalling ? 'Installing…' : 'Restart & Install'}
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
					<span>⚡ Automatically restarts Materio with latest enhancements</span>
				</p>
			</div>
		{:else if activeNudge === 'offline'}
			<img src="/assets/img/internet.webp" alt="Offline" class="leaderboard-nudge-image" />
			<div class="leaderboard-nudge-content">
				<p class="leaderboard-nudge-text">
					You seem to be offline.<br />
					Want to access your downloaded materials?
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
					<span>💡 You can save PDFs for offline reading by clicking bookmark in viewer</span>
				</p>
			</div>
		{/if}
	</aside>
{/if}

<style>
	/* Ported directly from parent Materio leaderboard.css lines 79-145 */
	.leaderboard-nudge-card {
		position: fixed;
		right: 18px;
		bottom: 18px;
		z-index: 1200;
		width: min(360px, calc(100vw - 24px));
		display: grid;
		grid-template-columns: 68px 1fr;
		gap: 10px;
		align-items: center;
		padding: 10px 12px;
		border-radius: 16px;
		border: 1px solid rgba(0, 0, 0, 0.14);
		background: #f0eee6;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.09);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		animation: nudgeSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	:global(body.dark-mode) .leaderboard-nudge-card,
	:global(html.dark) .leaderboard-nudge-card {
		background: #242424;
		border-color: rgba(255, 255, 255, 0.14);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
	}

	.leaderboard-nudge-image {
		width: 52px;
		height: 52px;
		object-fit: contain;
		justify-self: center;
	}

	.leaderboard-nudge-content {
		display: grid;
		gap: 6px;
	}

	.leaderboard-nudge-text {
		margin: 0;
		color: #333;
		font-family: 'Manrope', sans-serif;
		font-size: 13px;
		line-height: 1.25;
		font-weight: 600;
	}

	:global(body.dark-mode) .leaderboard-nudge-text,
	:global(html.dark) .leaderboard-nudge-text {
		color: #eee;
	}

	.leaderboard-nudge-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
	}

	.leaderboard-nudge-btn {
		border: 1px solid rgba(0, 0, 0, 0.28);
		background: transparent;
		color: #333;
		border-radius: 10px;
		padding: 4px 10px;
		font-family: 'Manrope', sans-serif;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	:global(body.dark-mode) .leaderboard-nudge-btn,
	:global(html.dark) .leaderboard-nudge-btn {
		border-color: rgba(255, 255, 255, 0.25);
		color: #eee;
	}

	.leaderboard-nudge-btn-primary {
		background: #ff6600 !important;
		border-color: #ff6600 !important;
		color: #fff !important;
	}

	.leaderboard-nudge-btn-primary:hover {
		background: #e65c00 !important;
	}

	.leaderboard-nudge-btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.nudge-hint {
		margin: 2px 0 0;
		font-size: 10px;
		color: #888;
		display: flex;
		align-items: flex-start;
		gap: 4px;
		line-height: 1.2;
	}

	:global(body.dark-mode) .nudge-hint,
	:global(html.dark) .nudge-hint {
		color: #aaa;
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
