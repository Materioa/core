<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { getSkipLanding, getAppStart, isForceApp } from '$lib/utils/landingPrefs.js';
	import { isTauri, isCapacitor, isNative } from '$lib/config/api.js';
	import LandingPage from '$lib/components/LandingPage.svelte';
	import MainApp from '$lib/components/MainApp.svelte';

	let showLanding = $state(true);
	let checked = $state(false);
	let showApp = $state(false);

	function evaluate() {
		if (!browser) return;
		// In native desktop (Tauri) or mobile (Capacitor) apps, never show landing page; jump directly to app
		const inNativeApp = isNative || isTauri || isCapacitor || Boolean(
			window.__TAURI_INTERNALS__ ||
			window.__TAURI__ ||
			window.location?.protocol === 'tauri:' ||
			window.location?.protocol === 'capacitor:' ||
			window.location?.hostname === 'tauri.localhost' ||
			window.Capacitor
		);
		if (inNativeApp) {
			showLanding = false;
			showApp = true;
			checked = true;
			return;
		}

		// Session "Go to App" click (app-start preference is 'root').
		if (isForceApp()) {
			showLanding = false;
			showApp = true;
			checked = true;
			return;
		}
		const skip = getSkipLanding();
		if (skip) {
			const start = getAppStart();
			if (start === 'home') {
				goto('/home', { replaceState: true });
				return;
			}
			showLanding = false;
			showApp = true;
		} else {
			showLanding = true;
			showApp = false;
		}
		checked = true;
	}

	onMount(() => {
		evaluate();
		const onPrefs = () => evaluate();
		const onStorage = (e: StorageEvent) => {
			if (e.key && (e.key.includes('materio_skip_landing') || e.key.includes('materio_app_start'))) evaluate();
		};
		window.addEventListener('landingPrefsChanged', onPrefs);
		window.addEventListener('materioForceAppChanged', onPrefs);
		window.addEventListener('storage', onStorage);
		return () => {
			window.removeEventListener('landingPrefsChanged', onPrefs);
			window.removeEventListener('materioForceAppChanged', onPrefs);
			window.removeEventListener('storage', onStorage);
		};
	});
</script>

{#if !checked}
	<div style="min-height:100vh; background:#faf9f5; display:flex; align-items:center; justify-content:center; color:#999; font-family: 'OpenRunde', 'Open Runde', sans-serif;">
		<span style="font-size:14px; opacity:0.6;">Loading…</span>
	</div>
{:else if showLanding}
	<LandingPage />
{:else if showApp}
	<MainApp initialTab="home" />
{:else}
	<div style="min-height:100vh; background:#faf9f5; display:flex; align-items:center; justify-content:center; color:#999;">
		<span style="font-size:14px;">Loading…</span>
	</div>
{/if}
