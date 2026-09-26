<script lang="ts">
	import PricingSection from "$lib/components/PricingSection.svelte";
	import { getLoginUrl, getSignupUrl } from "$lib/utils/app-urls.js";
	import { onMount } from "svelte";

	function handleLogin() {
		window.location.href = getLoginUrl();
	}

	function handleSignup() {
		window.location.href = getSignupUrl();
	}

	onMount(() => {
		if (typeof document !== "undefined") {
			document.body.classList.remove("dark-mode", "coffee-mode", "home-tab-active");
			document.body.classList.add("landing-active");
		}
		return () => {
			if (typeof document !== "undefined") {
				document.body.classList.remove("landing-active");
			}
		};
	});
</script>

<svelte:head>
	<title>Pricing · Materio</title>
	<meta
		name="description"
		content="Simple pricing for every kind of learner. Materio Plus at ₹199/month and Materio Pro at ₹349/month — billed monthly, cancel anytime."
	/>
	<link rel="stylesheet" href="/assets/style/landing.css" />
	<link rel="stylesheet" href="/assets/style/pricing.css" />
</svelte:head>

<div class="w-full min-h-screen bg-cream-50 flex flex-col items-center">
	<!-- Simple header (landing design language) -->
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

	<!-- Pricing (own page — Plus ₹199/mo · Pro ₹349/mo, monthly Razorpay billing) -->
	<main class="w-full flex flex-col items-center px-2 pt-12 md:pt-16">
		<PricingSection />
	</main>

	<!-- Footer (same as landing page) -->
	<footer
		class="w-full pt-16 pb-0 px-6 md:px-12 border-t border-cream-200/60 bg-white max-w-5xl mx-auto flex flex-col relative overflow-hidden"
	>
		<!-- Footer Grid -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 mb-12">
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
