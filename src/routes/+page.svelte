<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { getSkipLanding, getAppStart, isForceApp } from '$lib/utils/landingPrefs.js';
	import { isTauri, isCapacitor, isNative } from '$lib/config/api.js';
	import LandingPage from '$lib/components/LandingPage.svelte';
	import MainApp from '$lib/components/MainApp.svelte';

	function checkInitialApp(): boolean {
		if (!browser) return false;
		const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
		const inNative = isNative || isTauri || isCapacitor || Boolean(
			win && (
				win.__TAURI_INTERNALS__ ||
				win.__TAURI__ ||
				(win.location as Location | undefined)?.protocol === 'tauri:' ||
				(win.location as Location | undefined)?.protocol === 'capacitor:' ||
				(win.location as Location | undefined)?.hostname === 'tauri.localhost' ||
				win.Capacitor
			)
		);
		if (inNative) return true;
		if (isForceApp()) return true;
		if (getSkipLanding()) return true;
		return false;
	}

	const initialApp = checkInitialApp();
	let showLanding = $state(!initialApp);
	let checked = $state(initialApp);
	let showApp = $state(initialApp);

	function evaluate() {
		if (!browser) return;
		const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
		// In native desktop (Tauri) or mobile (Capacitor) apps, never show landing page; jump directly to app
		const inNativeApp = isNative || isTauri || isCapacitor || Boolean(
			win && (
				win.__TAURI_INTERNALS__ ||
				win.__TAURI__ ||
				(win.location as Location | undefined)?.protocol === 'tauri:' ||
				(win.location as Location | undefined)?.protocol === 'capacitor:' ||
				(win.location as Location | undefined)?.hostname === 'tauri.localhost' ||
				win.Capacitor
			)
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

<svelte:head>
	<title>Materio — Curated Study Materials &amp; Smart Notes</title>
	<meta name="description" content="Official materials you trust, in a way you love — Because e-learning shouldn't feel like suffering. Find organized, official study materials, notes, and peer help all in one clean place." />
	<link rel="canonical" href="https://getmaterio.app/" />
</svelte:head>

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
