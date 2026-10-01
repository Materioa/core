<script lang="ts">
	import { onMount } from "svelte";
	import { getLoginUrl, getSignupUrl } from "$lib/utils/app-urls.js";

	function handleLogin() {
		window.location.href = getLoginUrl();
	}

	function handleSignup() {
		window.location.href = getSignupUrl();
	}

	let releaseData = $state({
		version: 'v2.1.49',
		windows: {
			name: 'Materio_2.1.49_x64-setup.exe',
			version: 'v2.1.49',
			downloadUrl: 'https://github.com/Materioa/core/releases/download/v2.1.49/Materio_2.1.49_x64-setup.exe',
			msiUrl: 'https://github.com/Materioa/core/releases/download/v2.1.49/Materio_2.1.49_x64_en-US.msi',
			size: '48.5 MB'
		},
		android: {
			name: 'Materio_2.1.49_arm64.apk',
			version: 'v2.1.49',
			downloadUrl: 'https://github.com/Materioa/core/releases/download/v2.1.49/Materio_2.1.49_arm64.apk',
			size: '55.0 MB'
		}
	});

	onMount(() => {
		if (typeof document !== "undefined") {
			document.body.classList.remove("dark-mode", "coffee-mode", "coffee-dark-mode", "home-tab-active");
			document.body.classList.add("landing-active");
		}

		fetch('/api/releases/latest')
			.then(r => r.ok ? r.json() : null)
			.then(d => {
				if (d) {
					if (d.windows?.available !== false && d.windows?.downloadUrl) releaseData.windows.downloadUrl = d.windows.downloadUrl;
					if (d.windows?.msiUrl) releaseData.windows.msiUrl = d.windows.msiUrl;
					if (d.windows?.size) releaseData.windows.size = d.windows.size;
					// `name` and `version` were never assigned here, so the asset
					// filename and version string stayed frozen at whatever was
					// hardcoded above (v2.1.49) no matter what the API returned.
					if (d.windows?.name) releaseData.windows.name = d.windows.name;
					if (d.windows?.version) releaseData.windows.version = d.windows.version;
					// Only overwrite the APK link when this release actually
					// ships one — otherwise the button would 404.
					if (d.android?.available !== false && d.android?.downloadUrl) releaseData.android.downloadUrl = d.android.downloadUrl;
					if (d.android?.available !== false && d.android?.size) releaseData.android.size = d.android.size;
					if (d.android?.available !== false && d.android?.name) releaseData.android.name = d.android.name;
					if (d.version) releaseData.version = d.version;
				}
			})
			.catch(() => {});

		return () => {
			if (typeof document !== "undefined") {
				document.body.classList.remove("landing-active");
			}
		};
	});
</script>

<svelte:head>
	<title>Downloads · Materio</title>
	<meta
		name="description"
		content="Download official Materio native apps for Windows and Android. Offline notes vault, instant search, and local MCP server for AI tools."
	/>
	<link rel="stylesheet" href="/assets/style/landing.css" />
	<link rel="stylesheet" href="/assets/style/pricing.css" />
</svelte:head>

<div class="w-full min-h-screen bg-cream-50 flex flex-col items-center overflow-x-hidden">
	<!-- Simple header (exact landing design language from pricing) -->
	<header
		class="w-full bg-cream-50/80 backdrop-blur-md border-b border-cream-200/40"
	>
		<div
			class="w-full max-w-5xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between"
		>
			<a href="/" class="flex items-center">
				<img
					src="/assets/img/materio_new_bk.svg"
					alt="materio"
					class="h-7 w-auto"
				/>
			</a>
			<nav class="flex items-center gap-3 sm:gap-5">
				<a
					href="/"
					class="text-sm font-medium text-neutral-600 hover:text-cream-dark transition-colors"
					>Home</a
				>
				<button
					onclick={handleLogin}
					class="text-sm font-semibold text-neutral-600 hover:text-cream-dark transition-colors focus:outline-none"
				>
					Log in
				</button>
				<button
					onclick={handleSignup}
					class="btn-dark-hero px-5 py-2.5 text-sm font-semibold tracking-wide text-white rounded-2xl transition-all active:scale-[0.98] focus:outline-none"
				>
					Get Started
				</button>
			</nav>
		</div>
	</header>

	<!-- Main Downloads Section — matching PricingSection editorial language -->
	<main class="w-full max-w-5xl px-4 sm:px-6 md:px-8 mb-32 flex flex-col items-center text-center space-y-4 pt-12 md:pt-16 box-border">
		<!-- Heading -->
		<div class="flex flex-col items-center space-y-3 max-w-2xl">
			<h1
				class="font-heading text-3xl md:text-5xl font-semibold tracking-tight text-cream-dark leading-[1.15]"
			>
				Download Materio
			</h1>
			<p
				class="font-sans text-[17px] md:text-lg font-normal leading-relaxed text-neutral-500 max-w-xl"
			>
				Official native apps for your laptop and phone. Study anywhere, online or offline.
			</p>
		</div>

		<!-- Side-by-side Cards Grid -->
		<div class="download-cards-grid">
			<!-- CARD 1: WINDOWS -->
			<div class="app-download-card">
				<div class="app-card-header">
					<svg class="os-direct-icon" viewBox="0 0 24 24" fill="currentColor">
						<path d="M3 5.478L10.286 4.5v6.522H3V5.478zm0 7.422h7.286v6.6L3 18.522v-5.622zm8.286-8.522L21 3v8.022h-9.714V4.378zm0 7.622H21V20.5l-9.714-1.378V12z"/>
					</svg>

					<div class="mt-4">
						<h2 class="font-heading text-2xl sm:text-3xl font-semibold tracking-tight text-cream-dark">
							Windows
							<!-- Per-platform version. Releases here are frequently
							     single-platform, so the top-level version is the
							     newest build of EITHER app and does not describe this
							     card — showing it on both put a Windows version next to
							     an APK from an older release. -->
							<span class="align-middle text-base font-sans font-normal text-neutral-400 ml-2">{releaseData.windows.version || releaseData.version}</span>
						</h2>
						<p class="font-sans text-[14.5px] leading-relaxed text-neutral-500 mt-2">
							Native desktop app with offline study vault, instant search, and integrated local MCP server.
						</p>
					</div>
				</div>

				<div class="app-card-footer">
					<a
						href={releaseData.windows.downloadUrl}
						data-sveltekit-reload
						rel="external"
						class="btn-primary-download"
					>
						<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
							<polyline points="7 10 12 15 17 10"/>
							<line x1="12" y1="15" x2="12" y2="3"/>
						</svg>
						<span>Download for Windows</span>
					</a>
					<div class="secondary-download-options">
						<span>Windows 10, 11 (64-bit)</span>
						<span class="dot-separator">•</span>
						<span>{releaseData.windows.size || '78.5 MB'}</span>
						{#if releaseData.windows.msiUrl}
							<span class="dot-separator">•</span>
							<a href={releaseData.windows.msiUrl} class="sub-link" rel="external" download>or .MSI package</a>
						{/if}
					</div>
				</div>
			</div>

			<!-- CARD 2: ANDROID -->
			<div class="app-download-card">
				<div class="app-card-header">
					<svg class="os-direct-icon" viewBox="0 0 24 24" fill="currentColor">
						<path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4482.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.4116 13.8533 8.084 12 8.084c-1.8533 0-3.5902.3276-5.1368.8657L4.8409 5.4467a.4161.4161 0 00-.5677-.1521.4157.4157 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396"/>
					</svg>

					<div class="mt-4">
						<h2 class="font-heading text-2xl sm:text-3xl font-semibold tracking-tight text-cream-dark">
							Android
							<!-- See the Windows card: each platform gets its own
							     version, resolved server-side as "newest release that
							     actually shipped this platform's asset". -->
							<span class="align-middle text-base font-sans font-normal text-neutral-400 ml-2">{releaseData.android.version || releaseData.version}</span>
						</h2>
						<p class="font-sans text-[14.5px] leading-relaxed text-neutral-500 mt-2">
							Fast, pocket-sized study companion with full offline caching, gestures, and dark mode reading.
						</p>
					</div>
				</div>

				<div class="app-card-footer">
					<a
						href={releaseData.android.downloadUrl}
						data-sveltekit-reload
						rel="external"
						class="btn-primary-download"
					>
						<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
							<polyline points="7 10 12 15 17 10"/>
							<line x1="12" y1="15" x2="12" y2="3"/>
						</svg>
						<span>Download APK</span>
					</a>
					<div class="secondary-download-options">
						<span>Android 5.0+</span>
						<span class="dot-separator">•</span>
						<span>{releaseData.android.size || '54.0 MB'}</span>
						<span class="dot-separator">•</span>
						<span class="sub-link">Direct APK Install</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Bottom Note -->
		<div class="mt-8 text-center text-sm text-neutral-500">
			<span>Prefer using Materio without installing anything? </span>
			<a href="/home" class="font-semibold text-cream-dark hover:text-[#EB5E28] transition-colors underline underline-offset-4">
				Launch the Web App →
			</a>
		</div>
	</main>

	<!-- Footer (exact same as pricing page and landing page) -->
	<footer
		class="w-full pt-16 pb-0 px-6 md:px-12 border-t border-cream-200/60 bg-white max-w-5xl mx-auto flex flex-col relative overflow-hidden"
	>
		<!-- Footer Grid -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 mb-12 text-left">
			<!-- Column 1: Product -->
			<div class="flex flex-col space-y-3.5">
				<h4
					class="text-[14px] font-semibold text-neutral-400 tracking-wide mb-2"
				>
					Product
				</h4>
				<a
					href="https://getmaterio.app"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>Materio</a
				>
				<a
					href="https://room.getmaterio.app"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>Insightroom</a
				>
				<a
					href="https://chat.getmaterio.app"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>Thinklet</a
				>
				<a
					href="/connectors"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>MCP Connectors</a
				>
				<a
					href="https://getmaterio.app/changelog"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>Changelog</a
				>
			</div>

			<!-- Column 2: Resources -->
			<div class="flex flex-col space-y-3.5">
				<h4
					class="text-[14px] font-semibold text-neutral-400 tracking-wide mb-2"
				>
					Resources
				</h4>
				<a
					href="https://getmaterio.app/docs"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>Docs</a
				>
				<a
					href="/downloads"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
				>
					Downloads
				</a>
				<a
					href="/#faqs"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>FAQs</a
				>
			</div>

			<!-- Column 3: Company -->
			<div class="flex flex-col space-y-3.5">
				<h4
					class="text-[14px] font-semibold text-neutral-400 tracking-wide mb-2"
				>
					Company
				</h4>
				<a
					href="https://getmaterio.app/whatisthis"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>About</a
				>
				<a
					href="https://github.com/Materioa"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>Github</a
				>
				<a
					href="mailto:hello@getmaterio.app"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>Contact</a
				>
			</div>

			<!-- Column 4: Legal -->
			<div class="flex flex-col space-y-3.5">
				<h4
					class="text-[14px] font-semibold text-neutral-400 tracking-wide mb-2"
				>
					Legal
				</h4>
				<a
					href="https://getmaterio.app/privacy"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>Privacy</a
				>
				<a
					href="https://getmaterio.app/terms"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>Terms</a
				>
				<a
					href="https://getmaterio.app/cookies"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>Cookies</a
				>
				<a
					href="https://getmaterio.app/license"
					target="_blank"
					class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
					>License</a
				>
			</div>
		</div>

		<!-- Bottom Row -->
		<div
			class="flex flex-col sm:flex-row items-center justify-between py-6 border-t border-cream-200/40 text-neutral-400 text-xs gap-4 sm:gap-0 z-10"
		>
			<div>
				© 2026 <span class="mx-1 text-neutral-300">|</span>Designed in
				India
			</div>
			<div class="flex items-center space-x-2">
				<!-- Status indicator dot -->
				<span class="relative flex h-2 w-2">
					<span
						class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
					></span>
					<span
						class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"
					></span>
				</span>
				<span class="font-semibold text-[13px] text-emerald-700/90"
					>Operational</span
				>
			</div>
		</div>

		<!-- Giant Faded Logo Background -->
		<div
			class="w-full flex justify-center pointer-events-none select-none overflow-hidden mt-6 mb-[-36px] md:mb-[-72px]"
			style="mask-image: linear-gradient(to bottom, oklch(0 0 0 / 0.28) 0%, oklch(0 0 0 / 0) 100%); -webkit-mask-image: linear-gradient(to bottom, oklch(0 0 0 / 0.28) 0%, oklch(0 0 0 / 0) 100%);"
		>
			<img
				src="/assets/img/materio_new_bk.svg"
				alt="materio watermark"
				class="w-[500px] sm:w-[700px] md:w-[900px] max-w-none h-auto"
			/>
		</div>
	</footer>
</div>

<style>
	:global(body.landing-active) {
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, sans-serif !important;
	}

	:global(h1), :global(h2), :global(h3), :global(h4), :global(h5), :global(h6),
	:global(.font-heading) {
		font-family: 'Quadrant', 'Quadrant Notepad', Georgia, serif !important;
	}

	.download-cards-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
		width: 100%;
		max-width: 960px;
		margin: 2.5rem auto 0;
		text-align: left;
		box-sizing: border-box;
	}

	@media (min-width: 768px) {
		.download-cards-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
			gap: 1.75rem;
		}
	}

	.app-download-card {
		position: relative;
		background: #ffffff;
		border: 1px solid rgba(229, 226, 218, 0.85);
		border-radius: 24px;
		padding: 2.25rem 2rem 2rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 2.25rem;
		box-shadow: 0 4px 20px -2px rgba(28, 25, 23, 0.05), 0 2px 6px -1px rgba(28, 25, 23, 0.03);
		transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
		min-height: 280px;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	@media (max-width: 640px) {
		.app-download-card {
			padding: 1.75rem 1.25rem 1.5rem;
			gap: 1.75rem;
			border-radius: 20px;
		}
	}

	.app-download-card:hover {
		transform: translateY(-4px);
		box-shadow: 0 18px 36px -4px rgba(28, 25, 23, 0.09), 0 6px 14px -2px rgba(28, 25, 23, 0.04);
		border-color: rgba(235, 94, 40, 0.35);
	}

	.app-card-header {
		display: flex;
		flex-direction: column;
	}

	.os-direct-icon {
		width: 32px;
		height: 32px;
		color: #252422;
		transition: color 0.2s ease;
	}

	.app-download-card:hover .os-direct-icon {
		color: #EB5E28;
	}

	.app-card-footer {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.btn-primary-download {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		width: 100%;
		padding: 0.875rem 1.25rem;
		background: linear-gradient(180deg, #2b2b2b 0%, #1c1c1c 100%);
		color: #ffffff !important;
		border: 1px solid #141414;
		border-radius: 16px;
		font-size: 14.5px;
		font-weight: 600;
		text-decoration: none;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.12);
		transition: all 0.2s ease;
		cursor: pointer;
	}

	.btn-primary-download:hover {
		background: linear-gradient(180deg, #EB5E28 0%, #d85220 100%);
		border-color: #c9491a;
		box-shadow: 0 6px 18px rgba(235, 94, 40, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.2);
		color: #ffffff !important;
		transform: translateY(-1px);
	}

	.btn-primary-download:active {
		transform: scale(0.98);
	}

	.secondary-download-options {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		row-gap: 4px;
		column-gap: 6px;
		font-size: 12.5px;
		color: #78716c;
		text-align: center;
		line-height: 1.4;
	}

	.dot-separator {
		opacity: 0.4;
	}

	.sub-link {
		color: #EB5E28;
		font-weight: 500;
		text-decoration: underline;
		text-underline-offset: 3px;
		transition: color 0.15s ease;
	}

	.sub-link:hover {
		color: #c9491a;
	}

	.btn-dark-hero {
		background: linear-gradient(180deg, #3a3a3a 0%, #202020 100%);
		border: 1px solid #181818;
		box-shadow:
			0 4px 12px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.1);
		transition:
			background 0.25s ease,
			box-shadow 0.25s ease;
	}
	.btn-dark-hero:hover {
		background: linear-gradient(180deg, #4c4c4c 0%, #303030 100%);
	}
</style>
