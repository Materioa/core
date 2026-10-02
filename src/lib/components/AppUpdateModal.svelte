<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { isTauri, toApiUrl } from '$lib/config/api.js';
	import { desktopUpdateStore } from '$lib/stores.js';
	import { sfx } from '$lib/sounds/index.js';
	import * as cue from '$lib/sounds/events.js';

	// Update nudge state (desktop app only; offline + top-50 cards live in NudgeCards).
	let activeNudge = $state(null);
	let newVersion = $state<string>('');
	let isInstalling = $state(false);

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
		if (!browser || !isTauri) return { status: 'skipped' };
		try {
			// In Tauri v2, if @tauri-apps/plugin-updater is configured:
			if (isTauri && (window as any).__TAURI__?.updater) {
				try {
					const { check } = (window as any).__TAURI__.updater;
					// The updater plugin can be present in the JS bundle while
					// the Rust side has no endpoint/signature configured (our
					// release pipeline intentionally ships no updater
					// signatures). Its check() then never settles, which left
					// desktop users stuck on "Checking for updates…" forever:
					// the await never resolved, so the caller's finally block
					// never ran and the spinner never cleared. Time-box it and
					// fall through to the API-based check below.
					cue.updateCheckStarted();
					const update = await Promise.race([
						Promise.resolve().then(() => check()),
						new Promise((r) => setTimeout(() => r(null), 4000))
					]);
					if (update?.available) {
						newVersion = update.version;
						activeNudge = 'update';
						desktopUpdateStore.set({ available: true, version: newVersion });
						cue.updateAvailable();
						return { status: 'update', remote: newVersion, local: currentVersion() };
					}
				} catch (e) {
					console.warn('Tauri updater check failed, falling back to API:', e);
				}
			}

			// Fallback: check /api/releases/latest (cache-busted: a stale
			// WebView HTTP cache must never mask a published release)
			const localVer = currentVersion();
			// @ts-ignore
			const res = await fetch(toApiUrl(`/api/releases/latest?t=${Date.now()}`));
			if (res.ok) {
				const data = await res.json();
				// Platform-aware: only prompt when this release actually ships
				// a Windows asset (an Android-only tag must not nudge desktop).
				const winInfo = data.windows || {};
				if (winInfo.available === false || !winInfo.downloadUrl) {
					desktopUpdateStore.set({ available: false, version: '' });
					return { status: 'current', remote: null, local: localVer };
				}
				const remoteVer = (winInfo.version || data.version || '').replace(/^v/, '');
				console.info(`[updater] local=${localVer} remote=${remoteVer || '?'}`);
				if (remoteVer && isNewerVersion(remoteVer, localVer)) {
					newVersion = winInfo.version || data.version;
					activeNudge = 'update';
					desktopUpdateStore.set({ available: true, version: newVersion });
					cue.updateAvailable();
					return { status: 'update', remote: newVersion, local: localVer };
				} else {
					desktopUpdateStore.set({ available: false, version: '' });
					return { status: 'current', remote: remoteVer || null, local: localVer };
				}
			}
			return { status: 'error', remote: null, local: localVer, error: `HTTP ${res.status}` };
		} catch (err) {
			console.warn('Update check failed:', err);
			return { status: 'error', remote: null, local: currentVersion(), error: String(err) };
		}
	}

	function currentVersion(): string {
		try {
			// @ts-ignore
			const built = typeof __MATERIO_APP_VERSION__ !== 'undefined' ? __MATERIO_APP_VERSION__ : null;
			return String((window as any).__MATERIO_APP_VERSION__ || built || '2.1.0').replace(/^v/, '');
		} catch {
			return '2.1.0';
		}
	}

	async function handleInstallAndRestart() {
		isInstalling = true;
		cue.updateInstalling();
		// Hoisted out of the try below: the catch handler needs it to offer the
		// manual installer, but it was declared inside the try, so on ANY
		// failure (including the mismatch throw right after it) it was out of
		// scope — the recovery path threw ReferenceError instead of helping.
		let resolvedUrl: string | null = null;
		// The navbar update icon goes away once the update starts.
		desktopUpdateStore.set({ available: false, version: '' });
		try {
			// Tauri desktop app native updater & restarter
			if (isTauri) {
				const invoke = (window as any).__TAURI__?.core?.invoke || (window as any).__TAURI__?.invoke;
				if (typeof invoke === 'function') {
					let downloadUrl = null;
					let expectedVersion = '';
					try {
						// Cache-busted: installing from a stale cached
						// "latest" response would DOWNGRADE the app.
						const res = await fetch(toApiUrl(`/api/releases/latest?t=${Date.now()}`));
						if (res.ok) {
							const data = await res.json();
							expectedVersion = String(data.windows?.version || data.version || '').replace(/^v/, '');
							downloadUrl = data.windows?.downloadUrl || data.windows?.standaloneUrl || null;
						}
					} catch {}
					// Kept for the failure path so the user can still get the
					// installer even when the in-app download fails.
					resolvedUrl = downloadUrl;
					// Never install a versioned asset that doesn't match the
					// release just resolved above.
					if (downloadUrl && expectedVersion &&
						!downloadUrl.includes(expectedVersion) && !downloadUrl.includes('v' + expectedVersion)) {
						throw new Error(`Update download mismatch: expected ${expectedVersion}, got ${downloadUrl}`);
					}

					await invoke('install_update_and_restart', { downloadUrl, expectedVersion });
					// The app is about to be torn down; this is the last cue it
					// will ever play.
					cue.updateInstalled();
					return;
				}
			}

			// Fallback: navigate to downloads
			window.location.href = '/downloads';
		} catch (err) {
			console.error('Failed to install update:', err);
			cue.updateFailed();
			const msg = String((err as any)?.message || err || 'Unknown error');
			// Do NOT silently navigate to /downloads inside the app. That shows
			// an in-app page the user cannot install anything from, with no
			// explanation of what failed — which presented as the updater
			// freezing for minutes and then giving up. Surface the real reason
			// and offer the one path that reliably works: open the installer in
			// the system browser so it can actually be downloaded and run.
			const openInBrowser = async () => {
				try {
					const invoke2 =
						(window as any).__TAURI__?.core?.invoke || (window as any).__TAURI__?.invoke;
					if (typeof invoke2 === 'function' && resolvedUrl) {
						await invoke2('open_external_url', { url: resolvedUrl });
						return;
					}
				} catch {}
				window.open(resolvedUrl || '/downloads', '_blank');
			};
			try {
				// materioConfirm (not materioAlert) — only confirm resolves a
				// boolean and offers a cancel; alert has no callback.
				const confirmFn = (window as any).materioConfirm;
				const message =
					`The update could not be installed automatically.\n\n${msg}\n\n` +
					`Open the installer in your browser to update manually?`;
				if (typeof confirmFn === 'function') {
					confirmFn(message, {
						title: 'Update Failed',
						confirmText: 'Open Installer',
						cancelText: 'Close',
						danger: true
					}).then((ok) => {
						if (ok) openInBrowser();
					});
				} else {
					openInBrowser();
				}
			} catch {}
		} finally {
			isInstalling = false;
			activeNudge = null;
		}
	}

	function handleDismiss() {
		activeNudge = null;
		sfx('close', { emphasis: 'subtle' });
	}

	onMount(() => {
		if (!browser || !isTauri) return;

		// Check for updates (desktop app only)
		checkForUpdates();
		const interval = setInterval(checkForUpdates, 30 * 60 * 1000); // Check every 30m

		// Expose global trigger for settings page check button
		(window as any).__materioCheckUpdateModal = checkForUpdates;

		// Navbar update icon re-opens the update card (desktop app only).
		(window as any).__materioShowUpdateNudge = () => {
			if (newVersion) {
				activeNudge = 'update';
			} else {
				checkForUpdates();
			}
		};

		return () => {
			clearInterval(interval);
		};
	});
</script>

{#if isTauri && activeNudge === 'update'}
	<aside
		id="appNudgeCard"
		class="leaderboard-nudge-card"
		role="status"
		aria-live="polite"
	>
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
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, sans-serif !important;
		animation: nudgeSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
	}

	:global(body.coffee-mode) .leaderboard-nudge-card {
		background: #f7f1e7;
		border-color: rgba(111, 78, 55, 0.18);
		box-shadow: 0 8px 24px -4px rgba(78, 52, 46, 0.15);
	}

	:global(body.dark-mode) .leaderboard-nudge-card,
	:global(html.dark) .leaderboard-nudge-card {
		background: #202020;
		border-color: rgba(255, 255, 255, 0.12);
		box-shadow: 0 8px 28px -4px rgba(0, 0, 0, 0.45);
	}

	:global(body.coffee-dark-mode) .leaderboard-nudge-card {
		background: #241914 !important;
		border-color: rgba(255, 255, 255, 0.14) !important;
		box-shadow: 0 8px 28px -4px rgba(0, 0, 0, 0.55) !important;
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
		transition: filter 0.25s ease;
	}

	/* Invert greet icon in dark, espresso coffee-dark, and amoled themes so it becomes white */
	:global(body.dark-mode) .leaderboard-nudge-image,
	:global(body.coffee-dark-mode) .leaderboard-nudge-image,
	:global(body.amoled-mode) .leaderboard-nudge-image,
	:global(html.dark) .leaderboard-nudge-image {
		/* brightness(0) before invert() so the flip is luminance-only. A bare
		   invert(1) reverses hue as well, and greet.webp is an illustration,
		   not an icon authored for inversion. */
		filter: brightness(0) invert(1);
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
	:global(body.coffee-dark-mode) .leaderboard-nudge-title,
	:global(html.dark) .leaderboard-nudge-title {
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
	:global(body.coffee-dark-mode) .leaderboard-nudge-text,
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
	:global(body.coffee-dark-mode) .leaderboard-nudge-btn,
	:global(html.dark) .leaderboard-nudge-btn {
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

	.leaderboard-nudge-btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.nudge-hint {
		margin: 3px 0 0;
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, sans-serif !important;
		font-size: 11px;
		color: var(--color-text-muted, #777777);
		display: flex;
		align-items: flex-start;
		gap: 4px;
		line-height: 1.25;
	}

	:global(body.dark-mode) .nudge-hint,
	:global(body.coffee-dark-mode) .nudge-hint,
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
