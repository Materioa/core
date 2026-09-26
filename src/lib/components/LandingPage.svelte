<script>
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { smoothCorners } from "@lisse/svelte";
	import { getCookie } from "$lib/auth";
	import { getLoginUrl, getSignupUrl } from "$lib/utils/app-urls.js";
	import { getSkipLanding, getAppStart, setSkipLanding, setForceApp, clearForceApp } from "$lib/utils/landingPrefs.js";
	import { ProgressiveBlur } from "$lib/components/magic/progressive-blur";
	import { HugeiconsIcon } from "@hugeicons/svelte";
	import {
		ArrowRight01Icon,
		Compass01Icon,
		Shield01Icon,
		SparklesIcon,
		GlobeIcon,
		Menu09Icon,
		Cancel01Icon,
		HeartIcon,
		GoogleDriveIcon,
		WhatsappIcon,
		UniversityIcon,
		Download01Icon,
		Bookmark01Icon,
		Grid2X2PlusIcon,
		PuzzleIcon,
		News01Icon,
		CargoShipIcon,
		HelpCircleIcon,
		InformationCircleIcon,
		AdvertisimentIcon,
		Mail01Icon,
	} from "@hugeicons/core-free-icons";
	import { fade } from "svelte/transition";
	import { cubicOut } from "svelte/easing";

	let user = $state(null);
	let loading = $state(true);

	// Go-to-App hover + "Skip this page next time?" popup state.
	// Preference is shared with the app settings routing section via landingPrefs.
	let stickyGoHover = $state(false);
	let heroGoHover = $state(false);
	let heroCardGoHover = $state(false);
	let stickySkipDismissed = $state(false);
	let heroSkipDismissed = $state(false);
	let heroCardSkipDismissed = $state(false);
	let mobileSkipDismissed = $state(false);

	function handleGoToApp() {
		const start = getAppStart();
		if (start === 'home') {
			goto('/home');
		} else {
			// App lives at `/`: same-URL goto() is a no-op, so flag this
			// session to render the app — +page and the root layout react
			// to the flag via storage/custom events.
			setForceApp();
			goto('/', { replaceState: true });
		}
	}
	function handleAlwaysOpen() {
		setSkipLanding(true);
		const start = getAppStart();
		if (start === 'home') {
			goto('/home');
		} else {
			setForceApp();
			goto('/', { replaceState: true });
		}
	}

	// New SSO auth (auth.getmaterio.app handoff flow): session lives in
	// localStorage under `token` + `user`. Legacy `materio_auth_token` /
	// `materio_user` (cookie + localStorage) are read as fallback only.
	function readSessionUser() {
		try {
			const token =
				localStorage.getItem("token") ||
				localStorage.getItem("materio_auth_token") ||
				getCookie("token") ||
				getCookie("materio_auth_token");
			const cached =
				localStorage.getItem("user") ||
				localStorage.getItem("materio_user");
			if (token && cached) return JSON.parse(cached);
			if (!token) {
				localStorage.removeItem("user");
				localStorage.removeItem("materio_user");
			}
		} catch (err) {
			console.error("Failed to read session:", err);
		}
		return null;
	}

	onMount(async () => {
		const urlParams = new URLSearchParams(window.location.search);
		const code = urlParams.get("code") || urlParams.get("handoff");

		if (code) {
			// Handoff codes are exchanged by `/auth/callback` (per the SSO
			// guide) — forward anything that lands here instead of
			// exchanging inline like the legacy flow did.
			goto(`/auth/callback?code=${encodeURIComponent(code)}`, { replaceState: true });
			return;
		}

		user = readSessionUser();
		loading = false;
	});

	function handleLoginRedirect() {
		window.location.href = getLoginUrl();
	}

	function handleSignupRedirect() {
		window.location.href = getSignupUrl();
	}

	function handleLogout() {
		try {
			localStorage.removeItem("token");
			localStorage.removeItem("user");
			localStorage.removeItem("materio_auth_token");
			localStorage.removeItem("materio_user");
			for (const name of ["token", "user", "materio_auth_token", "materio_user"]) {
				document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
				if (window.location.hostname.endsWith("getmaterio.app")) {
					document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; domain=.getmaterio.app`;
				}
			}
		} catch {}
		clearForceApp();
		user = null;
		window.location.href = "/";
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

	function blurSlide(
		node,
		{ delay = 0, duration = 400, x = 20, blur = 8 },
	) {
		return {
			delay,
			duration,
			easing: cubicOut,
			css: (t, u) => `
				transform: translateX(${u * x}px);
				opacity: ${t};
				filter: blur(${u * blur}px);
			`,
		};
	}
	let scrollY = $state(0);
	let heroCard = $state(null);
	let scrolled = $derived(
		heroCard
			? scrollY > heroCard.offsetTop + heroCard.offsetHeight - 20
			: scrollY > 800,
	);

	let mobileMenuOpen = $state(false);

	$effect(() => {
		if (typeof document !== "undefined") {
			if (mobileMenuOpen) {
				document.body.style.overflow = "hidden";
				document.documentElement.style.overflow = "hidden";
			} else {
				document.body.style.overflow = "";
				document.documentElement.style.overflow = "";
			}
		}
		return () => {
			if (typeof document !== "undefined") {
				document.body.style.overflow = "";
				document.documentElement.style.overflow = "";
			}
		};
	});

	let stickyActiveTab = $state(null);
	let stickyProductLink = $state(null);
	let stickyResourcesLink = $state(null);
	let stickyCompanyLink = $state(null);
	let lastStickyLeft = 0;
	let stickyDropdownLeft = $derived.by(() => {
		if (stickyActiveTab === "product" && stickyProductLink) {
			lastStickyLeft =
				stickyProductLink.offsetLeft +
				stickyProductLink.offsetWidth / 2 -
				160;
		} else if (stickyActiveTab === "resources" && stickyResourcesLink) {
			lastStickyLeft =
				stickyResourcesLink.offsetLeft +
				stickyResourcesLink.offsetWidth / 2 -
				160;
		} else if (stickyActiveTab === "company" && stickyCompanyLink) {
			lastStickyLeft =
				stickyCompanyLink.offsetLeft +
				stickyCompanyLink.offsetWidth / 2 -
				160;
		}
		return lastStickyLeft;
	});
	let stickyWasOpen = $state(false);

	$effect(() => {
		if (stickyActiveTab) {
			const t = setTimeout(() => {
				if (stickyActiveTab) stickyWasOpen = true;
			}, 50);
			return () => clearTimeout(t);
		} else {
			stickyWasOpen = false;
		}
	});

	let heroActiveTab = $state(null);
	let heroProductLink = $state(null);
	let heroResourcesLink = $state(null);
	let heroCompanyLink = $state(null);
	let lastHeroLeft = 0;
	let heroDropdownLeft = $derived.by(() => {
		if (heroActiveTab === "product" && heroProductLink) {
			lastHeroLeft =
				heroProductLink.offsetLeft +
				heroProductLink.offsetWidth / 2 -
				160;
		} else if (heroActiveTab === "resources" && heroResourcesLink) {
			lastHeroLeft =
				heroResourcesLink.offsetLeft +
				heroResourcesLink.offsetWidth / 2 -
				160;
		} else if (heroActiveTab === "company" && heroCompanyLink) {
			lastHeroLeft =
				heroCompanyLink.offsetLeft +
				heroCompanyLink.offsetWidth / 2 -
				160;
		}
		return lastHeroLeft;
	});
	let heroWasOpen = $state(false);

	$effect(() => {
		if (heroActiveTab) {
			const t = setTimeout(() => {
				if (heroActiveTab) heroWasOpen = true;
			}, 50);
			return () => clearTimeout(t);
		} else {
			heroWasOpen = false;
		}
	});

	let statusText = $state("All systems operational");
	let statusType = $state("operational");

	let posts = $state([]);

	function formatDate(dateStr) {
		if (!dateStr) return "";
		try {
			const cleanStr = dateStr.split(" ")[0];
			const date = new Date(cleanStr);
			if (isNaN(date.getTime())) return dateStr;
			return date.toLocaleDateString("en-US", {
				month: "long",
				day: "numeric",
				year: "numeric",
			});
		} catch (e) {
			return dateStr;
		}
	}

	onMount(async () => {
		try {
			const res = await fetch(
				"https://getmaterio.app/api/v2/features?action=posts&category=whats-new",
			);
			if (res.ok) {
				const data = await res.json();
				if (Array.isArray(data) && data.length > 0) {
					posts = data.slice(0, 2);
				}
			}
		} catch (e) {
			console.error("Failed to load posts:", e);
		}

		try {
			const statusRes = await fetch(
				"https://status.getmaterio.app/api/v1/summary",
			);
			if (statusRes.ok) {
				const statusData = await statusRes.json();
				if (
					statusData.ongoing_incidents &&
					statusData.ongoing_incidents.length > 0
				) {
					statusText = "Degraded performance";
					statusType = "degraded";
				} else if (
					statusData.in_progress_maintenances &&
					statusData.in_progress_maintenances.length > 0
				) {
					statusText = "Maintenance in progress";
					statusType = "degraded";
				} else {
					statusText = "All systems operational";
					statusType = "operational";
				}
			} else {
				statusText = "Status unknown";
				statusType = "degraded";
			}
		} catch (e) {
			console.error("Failed to load status:", e);
			statusText = "Status unknown";
			statusType = "degraded";
		}
	});

	let imageErrors = $state({});
	const connectorLogos = [
		{
			name: "ChatGPT",
			img: "/assets/img/chatgpt-icon.svg",
			bg: "bg-white",
			border: "border-emerald-200/55",
			textColor: "text-emerald-700",
			logoColor: "#10a37f",
		},
		{
			name: "Claude",
			img: "/assets/img/claude-ai-icon.svg",
			bg: "bg-white",
			border: "border-orange-200/55",
			textColor: "text-orange-700",
			logoColor: "#ea825a",
		},
		{
			name: "Perplexity",
			img: "/assets/img/perplexity-ai-icon.svg",
			bg: "bg-white",
			border: "border-teal-200/55",
			textColor: "text-teal-700",
			logoColor: "#22808d",
		},
		{
			name: "Notion",
			img: "/assets/img/notion-icon.svg",
			bg: "bg-white",
			border: "border-zinc-300/50",
			textColor: "text-zinc-800",
			logoColor: "#000000",
		},
		{
			name: "Poke",
			img: "/assets/img/poke-ai-icon.webp",
			bg: "bg-white",
			border: "border-blue-200/55",
			textColor: "text-blue-700",
			logoColor: "#4f46e5",
		},
		{
			name: "Thinklet",
			img: "/assets/img/thinklet-ai-icon.svg",
			bg: "bg-white",
			border: "border-purple-200/55",
			textColor: "text-purple-700",
			logoColor: "#7c3aed",
		},
	];
</script>

<svelte:window bind:scrollY />

<!-- SEO Meta Tags -->
<svelte:head>
	<link rel="stylesheet" href="/assets/style/landing.css" />
	<title>Materio</title>
	<meta
		name="description"
		content="Official materials you trust, in a way you love — Because e-learning shouldn't feel like suffering. Find organized, official study materials, notes, and peer help — all in one clean place."
	/>
	<meta name="robots" content="index, follow" />
	<link rel="canonical" href="https://getmaterio.app" />
	<meta
		name="keywords"
		content="Materio, Materio PU, Materio - Home, Materioa, materio, materioa, Parul University, PU, PU Materials, CSE Materials PU, Vadodara, Jinansh Mehta, Materio Github, Materio Study Materials, Study materials, CSE Materials PU"
	/>

	<!-- Open Graph Meta Tags -->
	<meta property="og:title" content="Materio" />
	<meta
		property="og:description"
		content="Official materials you trust, in a way you love — Because e-learning shouldn't feel like suffering. Find organized, official study materials, notes, and peer help — all in one clean place."
	/>
	<meta
		property="og:image"
		content="https://getmaterio.app/assets/img/open-graph.png"
	/>
	<meta
		property="og:image"
		content="https://getmaterio.app/assets/img/open-graph.jpeg"
	/>
	<meta
		property="og:image"
		content="https://getmaterio.app/assets/img/open-graph-general.png"
	/>
	<meta
		property="og:image"
		content="https://getmaterio.app/assets/img/open-graph-general.jpg"
	/>
	<meta property="og:url" content="https://getmaterio.app" />
	<meta property="og:type" content="website" />

	<!-- Twitter Meta Tags -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Materio" />
	<meta
		name="twitter:description"
		content="Official materials you trust, in a way you love — Because e-learning shouldn't feel like suffering."
	/>
	<meta
		name="twitter:image"
		content="https://getmaterio.app/assets/img/open-graph.png"
	/>
	<meta name="theme-color" content="#333333" />
</svelte:head>

<ProgressiveBlur
	position="top"
	height="90px"
	class="fixed top-0 left-0 right-0 z-40 pointer-events-none transition-opacity duration-300 {scrolled
		? 'opacity-100'
		: 'opacity-0'}"
/>

<header
	class="fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-in-out h-16 flex items-center justify-between px-6 md:px-12 bg-cream-50/80 backdrop-blur-md border-b border-cream-200/40 shadow-sm {scrolled
		? 'opacity-100 translate-y-0'
		: 'opacity-0 pointer-events-none -translate-y-2'}"
>
	<a href="/" class="flex items-center group">
		<img
			src="/assets/img/materio_new_bk.svg"
			alt="materio"
			class="h-7 md:h-8 w-auto transition-transform group-hover:scale-[1.01]"
		/>
	</a>

	<!-- Outer wrapper to detect mouse leaving navigation entirely -->
	<!-- svelte-ignore a11y_mouse_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="hidden md:flex items-center relative py-2"
		onmouseleave={() => (stickyActiveTab = null)}
	>
		<nav class="flex items-center space-x-8">
			<!-- Product Tab Button -->
			<button
				bind:this={stickyProductLink}
				onmouseenter={() => (stickyActiveTab = "product")}
				class="text-sm font-medium text-neutral-600 hover:text-[#ff5400] transition-colors inline-flex items-center gap-1.5 focus:outline-none"
			>
				Product
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="2"
					stroke="currentColor"
					class="w-3.5 h-3.5 opacity-60 transition-transform duration-300 {stickyActiveTab ===
					'product'
						? 'rotate-180'
						: ''}"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M19.5 8.25l-7.5 7.5-7.5-7.5"
					/>
				</svg>
			</button>

			<!-- Resources Tab Button -->
			<button
				bind:this={stickyResourcesLink}
				onmouseenter={() => (stickyActiveTab = "resources")}
				class="text-sm font-medium text-neutral-600 hover:text-[#ff5400] transition-colors inline-flex items-center gap-1.5 focus:outline-none"
			>
				Resources
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="2"
					stroke="currentColor"
					class="w-3.5 h-3.5 opacity-60 transition-transform duration-300 {stickyActiveTab ===
					'resources'
						? 'rotate-180'
						: ''}"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M19.5 8.25l-7.5 7.5-7.5-7.5"
					/>
				</svg>
			</button>

			<!-- Company Tab Button -->
			<button
				bind:this={stickyCompanyLink}
				onmouseenter={() => (stickyActiveTab = "company")}
				class="text-sm font-medium text-neutral-600 hover:text-[#ff5400] transition-colors inline-flex items-center gap-1.5 focus:outline-none"
			>
				Company
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="2"
					stroke="currentColor"
					class="w-3.5 h-3.5 opacity-60 transition-transform duration-300 {stickyActiveTab ===
					'company'
						? 'rotate-180'
						: ''}"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M19.5 8.25l-7.5 7.5-7.5-7.5"
					/>
				</svg>
			</button>

			<!-- Pricing Link (Disabled)
			<a
				href="/pricing"
				onmouseenter={() => (stickyActiveTab = null)}
				class="text-sm font-medium text-neutral-600 hover:text-[#ff5400] transition-colors"
				>Pricing</a
			>
			-->
		</nav>

		<!-- Single shared dropdown panel container (Solid, rounded-2xl, absolute-positioned) -->
		<div
			class="nav-drop absolute top-full mt-2 w-[320px] bg-white border border-cream-300 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.12)] origin-top z-50 overflow-hidden {stickyActiveTab
				? 'opacity-100 visible scale-100 translate-y-0'
				: 'opacity-0 invisible scale-95 translate-y-1.5 pointer-events-none'}"
			style="left: {stickyDropdownLeft}px; transition: {stickyWasOpen
				? 'left 300ms cubic-bezier(0.16, 1, 0.3, 1), '
				: ''} opacity 300ms, transform 300ms, visibility 300ms;"
		>
			<div class="w-full overflow-hidden">
				<!-- Sliding inner block -->
				<div
					class="flex {stickyWasOpen
						? 'transition-transform duration-300 ease-out'
						: ''}"
					style="width: 960px; transform: translateX({stickyActiveTab ===
					'resources'
						? '-320px'
						: stickyActiveTab === 'company'
							? '-640px'
							: '0px'})"
				>
					<!-- Pane 1: Product -->
					<div
						class="w-[320px] p-[26px] flex flex-col space-y-[12px] shrink-0"
					>
						<a
							href="#features"
							class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
						>
							<HugeiconsIcon
								icon={Grid2X2PlusIcon}
								size={20}
								strokeWidth={2}
								class="text-neutral-400 mt-0.5 shrink-0"
							/>
							<div class="flex flex-col">
								<span
									class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
									>Features</span
								>
								<span
									class="text-[13px] text-neutral-400 font-medium mt-0.5"
									>Built for everyday studying</span
								>
							</div>
						</a>
						<a
							href="/connectors"
							target="_blank"
							class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
						>
							<HugeiconsIcon
								icon={PuzzleIcon}
								size={20}
								strokeWidth={2}
								class="text-neutral-400 mt-0.5 shrink-0"
							/>
							<div class="flex flex-col">
								<span
									class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
									>Connectors</span
								>
								<span
									class="text-[13px] text-neutral-400 font-medium mt-0.5"
									>Available wherever you work</span
								>
							</div>
						</a>
						<a
							href="https://room.getmaterio.app"
							target="_blank"
							class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
						>
							<HugeiconsIcon
								icon={News01Icon}
								size={20}
								strokeWidth={2}
								class="text-neutral-400 mt-0.5 shrink-0"
							/>
							<div class="flex flex-col">
								<span
									class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
									>Insightroom</span
								>
								<span
									class="text-[13px] text-neutral-400 font-medium mt-0.5"
									>Originals for deeper learning</span
								>
							</div>
						</a>
					</div>

					<!-- Pane 2: Resources -->
					<div
						class="w-[320px] p-[26px] flex flex-col space-y-[12px] shrink-0"
					>
						<a
							href="https://getmaterio.app/changelog"
							target="_blank"
							class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
						>
							<HugeiconsIcon
								icon={CargoShipIcon}
								size={20}
								strokeWidth={2}
								class="text-neutral-400 mt-0.5 shrink-0"
							/>
							<div class="flex flex-col">
								<span
									class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
									>Changelog</span
								>
								<span
									class="text-[13px] text-neutral-400 font-medium mt-0.5"
									>What's new and updates</span
								>
							</div>
						</a>
						<a
							href="#downloads"
							class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
						>
							<HugeiconsIcon
								icon={Download01Icon}
								size={20}
								strokeWidth={2}
								class="text-neutral-400 mt-0.5 shrink-0"
							/>
							<div class="flex flex-col">
								<span
									class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
									>Downloads</span
								>
								<span
									class="text-[13px] text-neutral-400 font-medium mt-0.5"
									>Get the App</span
								>
							</div>
						</a>
						<a
							href="#faqs"
							class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
						>
							<HugeiconsIcon
								icon={HelpCircleIcon}
								size={20}
								strokeWidth={2}
								class="text-neutral-400 mt-0.5 shrink-0"
							/>
							<div class="flex flex-col">
								<span
									class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
									>FAQ</span
								>
								<span
									class="text-[13px] text-neutral-400 font-medium mt-0.5"
									>Frequently Asked Questions</span
								>
							</div>
						</a>
					</div>

					<!-- Pane 3: Company -->
					<div
						class="w-[320px] p-[26px] flex flex-col space-y-[12px] shrink-0"
					>
						<a
							href="https://getmaterio.app/whatisthis"
							target="_blank"
							class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
						>
							<HugeiconsIcon
								icon={InformationCircleIcon}
								size={20}
								strokeWidth={2}
								class="text-neutral-400 mt-0.5 shrink-0"
							/>
							<div class="flex flex-col">
								<span
									class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
									>About</span
								>
								<span
									class="text-[13px] text-neutral-400 font-medium mt-0.5"
									>Our story and mission</span
								>
							</div>
						</a>
						<!-- Advertising Link (Disabled)
						<a
							href="/advertising"
							class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
						>
							<HugeiconsIcon
								icon={AdvertisimentIcon}
								size={20}
								strokeWidth={2}
								class="text-neutral-400 mt-0.5 shrink-0"
							/>
							<div class="flex flex-col">
								<span
									class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
									>Advertising</span
								>
								<span
									class="text-[13px] text-neutral-400 font-medium mt-0.5"
									>Partner with Materio</span
								>
							</div>
						</a>
						-->
						<a
							href="mailto:hello@getmaterio.app"
							class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
						>
							<HugeiconsIcon
								icon={Mail01Icon}
								size={20}
								strokeWidth={2}
								class="text-neutral-400 mt-0.5 shrink-0"
							/>
							<div class="flex flex-col">
								<span
									class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
									>Contact</span
								>
								<span
									class="text-[13px] text-neutral-400 font-medium mt-0.5"
									>Get in touch with us</span
								>
							</div>
						</a>
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="flex items-center">
		<div class="hidden md:flex items-center gap-6 mr-6">
			{#if !loading && user}
				<button
					onclick={handleLogout}
					class="text-sm font-semibold text-neutral-600 hover:text-[#ff5400] transition-colors focus:outline-none"
				>
					Log Out
				</button>
				<!-- svelte-ignore a11y_mouse_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="relative" onmouseenter={() => stickyGoHover = true} onmouseleave={() => stickyGoHover = false}>
					<button
						onclick={handleGoToApp}
						class="text-sm font-semibold text-neutral-600 hover:text-[#ff5400] transition-colors focus:outline-none"
					>
						Go to App
					</button>
					{#if stickyGoHover && !stickySkipDismissed}
						<div class="skip-tip absolute top-full right-0 mt-3 w-[280px] bg-white border border-neutral-200 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] px-4 py-3 z-50 text-left" transition:fade={{ duration: 150 }}>
							<div class="flex items-start justify-between gap-2">
								<p class="skip-tip-q text-[13px] font-medium text-neutral-700 leading-snug">Skip this page next time?</p>
								<button onclick={() => stickySkipDismissed = true} class="skip-tip-x shrink-0 -mr-1 -mt-0.5 p-1 rounded-full hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors" aria-label="Dismiss">
									<HugeiconsIcon icon={Cancel01Icon} size={14} />
								</button>
							</div>
							<button onclick={handleAlwaysOpen} class="skip-tip-go mt-1 text-[13px] font-semibold text-[#ff5400] hover:text-[#e04a00] inline-flex items-center gap-1 transition-colors">
								Always open Materio <span aria-hidden="true">→</span>
							</button>
						</div>
					{/if}
				</div>
			{:else}
				<button
					onclick={handleLoginRedirect}
					class="text-sm font-semibold text-neutral-600 hover:text-[#ff5400] transition-colors focus:outline-none"
				>
					Login
				</button>
				<button
					onclick={handleSignupRedirect}
					use:smoothCorners={{
						corners: { radius: 12, smoothing: 0.8 },
					}}
					class="inline-flex items-center justify-center px-4 py-2 text-xs font-semibold tracking-wide text-white transition-all focus:outline-none btn-dark-header"
				>
					Get Started
				</button>
			{/if}
		</div>
		<button
			onclick={() => (mobileMenuOpen = true)}
			class="md:hidden text-neutral-800 p-2 -mr-2 transition-opacity hover:opacity-70"
		>
			<HugeiconsIcon icon={Menu09Icon} size={24} />
		</button>
	</div>
</header>

<main
	class="w-full min-h-screen bg-cream-50 p-[calc(var(--spacing)*2)] flex flex-col items-center"
>
	<!-- Giant Hero Card with Sky Background -->
	<div
		bind:this={heroCard}
		use:smoothCorners={{ corners: { radius: 24, smoothing: 0.8 } }}
		class="w-full p-0 mb-16 shadow-xl relative overflow-hidden flex flex-col items-center"
		style="background-image: url('/assets/img/0a981100.webp'); background-size: cover; background-position: center;"
	>
		<!-- Inline Card Header (Scrolls naturally inside the card) -->
		<header
			class="w-full flex items-center justify-between pt-[15px] px-[15px] bg-transparent mb-16 relative z-[60]"
		>
			<!-- Logo -->
			<a href="/" class="flex items-center group ml-3 md:ml-5">
				<img
					src="/assets/img/materio_new_bk.svg"
					alt="materio"
					class="h-7 md:h-8 w-auto transition-transform group-hover:scale-[1.01]"
				/>
			</a>

			<!-- Navigation with single shared sliding dropdown box -->
			<!-- svelte-ignore a11y_mouse_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="hidden md:flex items-center relative py-2"
				onmouseleave={() => (heroActiveTab = null)}
			>
				<nav class="flex items-center space-x-10">
					<!-- Product Tab Button -->
					<button
						bind:this={heroProductLink}
						onmouseenter={() => (heroActiveTab = "product")}
						class="text-[15px] font-semibold text-neutral-800 hover:text-black transition-colors inline-flex items-center gap-1.5 focus:outline-none"
					>
						Product
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="2"
							stroke="currentColor"
							class="w-3.5 h-3.5 opacity-60 transition-transform duration-300 {heroActiveTab ===
							'product'
								? 'rotate-180'
								: ''}"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19.5 8.25l-7.5 7.5-7.5-7.5"
							/>
						</svg>
					</button>

					<!-- Resources Tab Button -->
					<button
						bind:this={heroResourcesLink}
						onmouseenter={() => (heroActiveTab = "resources")}
						class="text-[15px] font-semibold text-neutral-800 hover:text-black transition-colors inline-flex items-center gap-1.5 focus:outline-none"
					>
						Resources
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="2"
							stroke="currentColor"
							class="w-3.5 h-3.5 opacity-60 transition-transform duration-300 {heroActiveTab ===
							'resources'
								? 'rotate-180'
								: ''}"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19.5 8.25l-7.5 7.5-7.5-7.5"
							/>
						</svg>
					</button>

					<!-- Company Tab Button -->
					<button
						bind:this={heroCompanyLink}
						onmouseenter={() => (heroActiveTab = "company")}
						class="text-[15px] font-semibold text-neutral-800 hover:text-black transition-colors inline-flex items-center gap-1.5 focus:outline-none"
					>
						Company
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="2"
							stroke="currentColor"
							class="w-3.5 h-3.5 opacity-60 transition-transform duration-300 {heroActiveTab ===
							'company'
								? 'rotate-180'
								: ''}"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19.5 8.25l-7.5 7.5-7.5-7.5"
							/>
						</svg>
					</button>

					<!-- Pricing Link (Disabled)
					<a
						href="/pricing"
						onmouseenter={() => (heroActiveTab = null)}
						class="text-[15px] font-semibold text-neutral-800 hover:text-black transition-colors"
						>Pricing</a
					>
					-->
				</nav>

				<!-- Single shared dropdown panel container (Solid, rounded-2xl, absolute-positioned) -->
				<div
					class="nav-drop absolute top-full mt-2 w-[320px] bg-white border border-cream-300 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.12)] origin-top z-50 overflow-hidden {heroActiveTab
						? 'opacity-100 visible scale-100 translate-y-0'
						: 'opacity-0 invisible scale-95 translate-y-1.5 pointer-events-none'}"
					style="left: {heroDropdownLeft}px; transition: {heroWasOpen
						? 'left 300ms cubic-bezier(0.16, 1, 0.3, 1), '
						: ''} opacity 300ms, transform 300ms, visibility 300ms;"
				>
					<div class="w-full overflow-hidden">
						<!-- Sliding inner block -->
						<div
							class="flex {heroWasOpen
								? 'transition-transform duration-300 ease-out'
								: ''}"
							style="width: 960px; transform: translateX({heroActiveTab ===
							'resources'
								? '-320px'
								: heroActiveTab === 'company'
									? '-640px'
									: '0px'})"
						>
							<!-- Pane 1: Product -->
							<div
								class="w-[320px] p-[26px] flex flex-col space-y-[12px] shrink-0"
							>
								<a
									href="#features"
									class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
								>
									<HugeiconsIcon
										icon={Grid2X2PlusIcon}
										size={20}
										strokeWidth={2}
										class="text-neutral-400 mt-0.5 shrink-0"
									/>
									<div class="flex flex-col">
										<span
											class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
											>Features</span
										>
										<span
											class="text-[13px] text-neutral-400 font-medium mt-0.5"
											>Built for everyday studying</span
										>
									</div>
								</a>
								<a
									href="/connectors"
									target="_blank"
									class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
								>
									<HugeiconsIcon
										icon={PuzzleIcon}
										size={20}
										strokeWidth={2}
										class="text-neutral-400 mt-0.5 shrink-0"
									/>
									<div class="flex flex-col">
										<span
											class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
											>Connectors</span
										>
										<span
											class="text-[13px] text-neutral-400 font-medium mt-0.5"
											>Available wherever you work</span
										>
									</div>
								</a>
								<a
									href="https://room.getmaterio.app"
									target="_blank"
									class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
								>
									<HugeiconsIcon
										icon={News01Icon}
										size={20}
										strokeWidth={2}
										class="text-neutral-400 mt-0.5 shrink-0"
									/>
									<div class="flex flex-col">
										<span
											class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
											>Insightroom</span
										>
										<span
											class="text-[13px] text-neutral-400 font-medium mt-0.5"
											>Originals for deeper learning</span
										>
									</div>
								</a>
							</div>

							<!-- Pane 2: Resources -->
							<div
								class="w-[320px] p-[26px] flex flex-col space-y-[12px] shrink-0"
							>
								<a
									href="https://getmaterio.app/changelog"
									target="_blank"
									class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
								>
									<HugeiconsIcon
										icon={CargoShipIcon}
										size={20}
										strokeWidth={2}
										class="text-neutral-400 mt-0.5 shrink-0"
									/>
									<div class="flex flex-col">
										<span
											class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
											>Changelog</span
										>
										<span
											class="text-[13px] text-neutral-400 font-medium mt-0.5"
											>What's new and updates</span
										>
									</div>
								</a>
								<a
									href="/downloads"
									class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
								>
									<HugeiconsIcon
										icon={Download01Icon}
										size={20}
										strokeWidth={2}
										class="text-neutral-400 mt-0.5 shrink-0"
									/>
									<div class="flex flex-col">
										<span
											class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
											>Downloads</span
										>
										<span
											class="text-[13px] text-neutral-400 font-medium mt-0.5"
											>Get the App</span
										>
									</div>
								</a>
								<a
									href="#faqs"
									class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
								>
									<HugeiconsIcon
										icon={HelpCircleIcon}
										size={20}
										strokeWidth={2}
										class="text-neutral-400 mt-0.5 shrink-0"
									/>
									<div class="flex flex-col">
										<span
											class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
											>FAQ</span
										>
										<span
											class="text-[13px] text-neutral-400 font-medium mt-0.5"
											>Frequently Asked Questions</span
										>
									</div>
								</a>
							</div>

							<!-- Pane 3: Company -->
							<div
								class="w-[320px] p-[26px] flex flex-col space-y-[12px] shrink-0"
							>
								<a
									href="https://getmaterio.app/whatisthis"
									target="_blank"
									class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
								>
									<HugeiconsIcon
										icon={InformationCircleIcon}
										size={20}
										strokeWidth={2}
										class="text-neutral-400 mt-0.5 shrink-0"
									/>
									<div class="flex flex-col">
										<span
											class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
											>About</span
										>
										<span
											class="text-[13px] text-neutral-400 font-medium mt-0.5"
											>Our story and mission</span
										>
									</div>
								</a>
								<!-- Advertising Link (Disabled)
								<a
									href="/advertising"
									class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
								>
									<HugeiconsIcon
										icon={AdvertisimentIcon}
										size={20}
										strokeWidth={2}
										class="text-neutral-400 mt-0.5 shrink-0"
									/>
									<div class="flex flex-col">
										<span
											class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
											>Advertising</span
										>
										<span
											class="text-[13px] text-neutral-400 font-medium mt-0.5"
											>Partner with Materio</span
										>
									</div>
								</a>
								-->
								<a
									href="mailto:hello@getmaterio.app"
									class="flex items-start gap-[20px] p-[10px] -mx-[10px] rounded-xl hover:bg-cream-100/40 transition-colors duration-200 group/item text-left font-normal"
								>
									<HugeiconsIcon
										icon={Mail01Icon}
										size={20}
										strokeWidth={2}
										class="text-neutral-400 mt-0.5 shrink-0"
									/>
									<div class="flex flex-col">
										<span
											class="text-[15px] font-semibold text-neutral-900 group-hover/item:text-[#ff5400] transition-colors"
											>Contact</span
										>
										<span
											class="text-[13px] text-neutral-400 font-medium mt-0.5"
											>Get in touch with us</span
										>
									</div>
								</a>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- CTA & Mobile Menu -->
			<div class="flex items-center">
				<div class="hidden md:flex items-center gap-6 mr-6">
					{#if !loading && user}
						<button
							onclick={handleLogout}
							class="text-[15px] font-semibold text-neutral-800 hover:text-black transition-colors focus:outline-none"
						>
							Log Out
						</button>
						<!-- svelte-ignore a11y_mouse_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="relative" onmouseenter={() => heroGoHover = true} onmouseleave={() => heroGoHover = false}>
							<button
								onclick={handleGoToApp}
								class="text-[15px] font-semibold text-neutral-800 hover:text-black transition-colors focus:outline-none"
							>
								Go to App
							</button>
							{#if heroGoHover && !heroSkipDismissed}
								<div class="skip-tip absolute top-full right-0 mt-3 w-[280px] bg-white border border-neutral-200 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] px-4 py-3 z-50 text-left" transition:fade={{ duration: 150 }}>
									<div class="flex items-start justify-between gap-2">
										<p class="skip-tip-q text-[13px] font-medium text-neutral-700 leading-snug">Skip this page next time?</p>
										<button onclick={() => heroSkipDismissed = true} class="skip-tip-x shrink-0 -mr-1 -mt-0.5 p-1 rounded-full hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors" aria-label="Dismiss">
											<HugeiconsIcon icon={Cancel01Icon} size={14} />
										</button>
									</div>
									<button onclick={handleAlwaysOpen} class="skip-tip-go mt-1 text-[13px] font-semibold text-[#ff5400] hover:text-[#e04a00] inline-flex items-center gap-1 transition-colors">
										Always open Materio <span aria-hidden="true">→</span>
									</button>
								</div>
							{/if}
						</div>
					{:else}
						<button
							onclick={handleLoginRedirect}
							class="text-[15px] font-semibold text-neutral-800 hover:text-black transition-colors focus:outline-none"
						>
							Login
						</button>
						<button
							onclick={handleSignupRedirect}
							use:smoothCorners={{
								corners: { radius: 14, smoothing: 0.8 },
							}}
							class="inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold tracking-wide text-white transition-all focus:outline-none btn-dark-header"
						>
							Get Started
						</button>
					{/if}
				</div>
				<button
					onclick={() => (mobileMenuOpen = true)}
					class="md:hidden text-neutral-800 p-2 -mr-2 transition-opacity hover:opacity-70"
				>
					<HugeiconsIcon icon={Menu09Icon} size={24} />
				</button>
			</div>
		</header>

		<!-- Hero Content inside Card -->
		<div
			class="flex flex-col items-start text-left md:items-center md:text-center relative z-20 max-w-4xl px-[15px] md:px-4 w-full"
		>
			<!-- Main Title -->
			<h1
				class="font-heading text-3xl md:text-5xl font-bold tracking-tight text-cream-dark leading-[1.1] mb-6"
			>
				Everything you've been taught.<br class="hidden sm:inline" /> Instantly
				accessible.
			</h1>

			<!-- Hero CTA Buttons -->
			<div class="flex flex-row items-center gap-4 mt-2 mb-4 select-none">
				{#if !loading && user}
					<!-- svelte-ignore a11y_mouse_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="relative inline-flex" onmouseenter={() => heroCardGoHover = true} onmouseleave={() => heroCardGoHover = false}>
						<button
							onclick={handleGoToApp}
							use:smoothCorners={{
								corners: { radius: 14, smoothing: 0.8 },
							}}
							class="inline-flex items-center justify-center px-7 py-3 text-sm font-semibold tracking-wide text-white transition-all active:scale-[0.98] focus:outline-none btn-dark-hero"
						>
							Go to App
						</button>
						{#if heroCardGoHover && !heroCardSkipDismissed}
							<div class="skip-tip skip-tip-c absolute top-full left-1/2 mt-3 w-[280px] bg-white border border-neutral-200 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] px-4 py-3 z-50 text-left" transition:fade={{ duration: 150 }}>
								<div class="flex items-start justify-between gap-2">
									<p class="skip-tip-q text-[13px] font-medium text-neutral-700 leading-snug">Skip this page next time?</p>
									<button onclick={() => heroCardSkipDismissed = true} class="skip-tip-x shrink-0 -mr-1 -mt-0.5 p-1 rounded-full hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors" aria-label="Dismiss">
										<HugeiconsIcon icon={Cancel01Icon} size={14} />
									</button>
								</div>
								<button onclick={handleAlwaysOpen} class="skip-tip-go mt-1 text-[13px] font-semibold text-[#ff5400] hover:text-[#e04a00] inline-flex items-center gap-1 transition-colors">
									Always open Materio <span aria-hidden="true">→</span>
								</button>
							</div>
						{/if}
					</div>
				{:else}
					<button
						onclick={handleSignupRedirect}
						use:smoothCorners={{
							corners: { radius: 14, smoothing: 0.8 },
						}}
						class="inline-flex items-center justify-center px-7 py-3 text-sm font-semibold tracking-wide text-white transition-all active:scale-[0.98] focus:outline-none btn-dark-hero"
					>
						Get Started
					</button>
					<button
						onclick={handleGoToApp}
						use:smoothCorners={{
							corners: { radius: 14, smoothing: 0.8 },
						}}
						class="inline-flex items-center justify-center px-7 py-3 text-sm font-semibold tracking-wide text-neutral-800 transition-all active:scale-[0.98] focus:outline-none btn-light-hero"
					>
						Explore
					</button>
				{/if}
			</div>
		</div>

		<!-- Mock Browser Window (Screenshot Container) -->
		<!-- Overflowing on mobile: fixed width pulls it off the right edge, negative margin clips bottom -->
		<div
			class="self-start md:self-center rounded-t-xl w-[800px] max-w-none md:w-[calc(100%-96px)] md:max-w-full ml-[15px] md:ml-0 mt-8 md:mt-12 h-[320px] sm:h-[450px] md:h-[550px] bg-cream-100/90 backdrop-blur-xl border-t border-x border-cream-200/40 shadow-[0_20px_50px_oklch(0.2079_0.01_67.2_/_0.06)] flex flex-col relative z-10 overflow-hidden mb-[-20px] md:mb-0"
		>
			<!-- Browser Header/Toolbar -->
			<div
				class="h-[40px] px-4 border-b border-cream-200/40 flex items-center justify-between bg-cream-100/60 backdrop-blur-sm select-none"
			>
				<!-- Left side: Traffic Lights & Controls -->
				<div class="flex items-center space-x-3.5">
					<!-- Traffic Light Controls -->
					<div class="flex items-center space-x-1.5">
						<div class="w-3 h-3 rounded-full bg-[#EC6A5E]"></div>
						<div class="w-3 h-3 rounded-full bg-[#F4BF4F]"></div>
						<div class="w-3 h-3 rounded-full bg-[#61C554]"></div>
					</div>
					<!-- Sidebar Icon -->
					<div
						class="text-neutral-500/80 hover:text-neutral-700 transition-colors ml-2 cursor-pointer"
					>
						<svg
							class="w-4 h-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<rect
								x="3"
								y="3"
								width="18"
								height="18"
								rx="2"
								stroke-width="1.8"
							/>
							<path d="M9 3v18" stroke-width="1.8" />
						</svg>
					</div>
					<!-- Separator -->
					<div class="h-3 w-[1px] bg-neutral-300/80"></div>
					<!-- Chevron Down -->
					<div
						class="text-neutral-500/80 hover:text-neutral-700 transition-colors cursor-pointer"
					>
						<svg
							class="w-3.5 h-3.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="m6 9 6 6 6-6" />
						</svg>
					</div>
					<!-- Chevron Left (Disabled/Grayed) -->
					<div class="text-neutral-300 pl-0.5">
						<svg
							class="w-4 h-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="m15 18-6-6 6-6" />
						</svg>
					</div>
				</div>

				<!-- Address Bar -->
				<div
					class="flex-grow ml-3 mr-1.5 h-8 rounded-md bg-cream-200/50 border border-cream-300/30 px-2.5 flex items-center justify-between"
				>
					<!-- Domain info with icon & lock -->
					<div class="flex items-center space-x-2 pl-0.5">
						<img
							src="/assets/img/favicon.png"
							alt="Favicon"
							class="w-[15px] h-[15px] rounded-[3px] select-none"
						/>
						<span
							class="text-neutral-700 text-[11px] font-medium tracking-tight"
							>getmaterio.app</span
						>
						<svg
							class="w-2.5 h-2.5 text-neutral-400/90"
							viewBox="0 0 24 24"
							fill="currentColor"
						>
							<rect
								x="3"
								y="11"
								width="18"
								height="11"
								rx="2"
								ry="2"
							/>
							<path
								d="M7 11V7a5 5 0 0 1 10 0v4"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</div>
					<!-- Horizontal Menu Dots inside translucent circle -->
					<div
						class="w-5 h-5 rounded-full bg-neutral-500/10 flex items-center justify-center text-neutral-500 hover:bg-neutral-500/20 transition-colors cursor-pointer"
					>
						<svg
							class="w-3 h-3"
							viewBox="0 0 24 24"
							fill="currentColor"
						>
							<circle cx="12" cy="12" r="1.5" />
							<circle cx="6" cy="12" r="1.5" />
							<circle cx="18" cy="12" r="1.5" />
						</svg>
					</div>
				</div>

				<!-- Extra Actions -->
				<div
					class="flex items-center justify-end text-neutral-500/80 pl-2"
				>
					<div
						class="hover:text-neutral-700 transition-colors cursor-pointer p-0.5"
					>
						<svg
							class="w-4.5 h-4.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M5 12h14" />
							<path d="M12 5v14" />
						</svg>
					</div>
				</div>
			</div>

			<div class="flex-grow bg-cream-50/10 relative">
				<img
					src="/assets/img/hero.webp"
					alt="Materio Workspace"
					class="w-full h-full object-cover object-top"
				/>
			</div>
		</div>
	</div>

	<section
		id="problem"
		class="w-full max-w-5xl px-5 sm:px-6 md:px-0 flex flex-col pt-12 border-t border-cream-200 mb-24 space-y-8"
	>
		<!-- Heading and Paragraph Row -->
		<div class="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
			<div class="md:col-span-5 flex flex-col">
				<h2
					class="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-cream-dark leading-[1.2]"
				>
					Everything you learn ends up somewhere else.
				</h2>
			</div>
			<div class="md:col-span-7 flex flex-col">
				<p
					class="font-sans text-lg md:text-xl font-normal leading-relaxed text-neutral-500"
				>
					Every semester starts the same way: notes arrive in WhatsApp
					groups, assignments appear on college portals, PDFs get
					downloaded, and useful links disappear into bookmarks.
					Materio turns that scattered collection into one curated
					learning library.
				</p>
			</div>
		</div>

		<!-- Diagram Row: Spans full width -->
		<div class="w-full">
			<!-- Visual Flow Container -->
			<div
				class="w-full bg-cream-100/25 border border-cream-300 rounded-3xl p-6 md:p-8 flex flex-col overflow-hidden relative select-none"
			>
				<!-- Dotted background pattern -->
				<div
					class="absolute inset-0 bg-[radial-gradient(#d3c9ba_1.5px,transparent_1.5px)] [background-size:24px_24px] opacity-50 pointer-events-none"
				></div>

				<!-- Desktop Layout (Left-to-Right Sankey Ecosystem Flow) -->
				<div class="relative z-10 w-full hidden md:block h-[400px]">
					<!-- Left Section: Scattered Learning Sources (occupies left 26% of container) -->
					<div
						class="absolute left-0 top-0 h-full w-[26%] flex flex-col justify-between py-2 items-end pr-4"
					>
						<!-- WhatsApp Groups -->
						<div
							class="flex items-center space-x-2 bg-cream-50 hover:bg-cream-100/60 border border-cream-300/80 pl-3.5 pr-3.5 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all rotate-1.5 translate-y-0.5 hover:-translate-y-0.5 w-fit select-none"
						>
							<HugeiconsIcon
								icon={WhatsappIcon}
								size={14}
								class="text-neutral-400 flex-shrink-0"
							/>
							<span class="text-[11px] font-medium tracking-tight"
								>WhatsApp Groups</span
							>
						</div>

						<!-- College Portal -->
						<div
							class="flex items-center space-x-2 bg-cream-50 hover:bg-cream-100/60 border border-cream-300/80 pl-3.5 pr-3.5 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all -rotate-2 translate-y-1 hover:-translate-y-0.5 w-fit select-none translate-x-3"
						>
							<HugeiconsIcon
								icon={UniversityIcon}
								size={14}
								class="text-neutral-400 flex-shrink-0"
							/>
							<span class="text-[11px] font-medium tracking-tight"
								>College Portal</span
							>
						</div>

						<!-- Google Drive -->
						<div
							class="flex items-center space-x-2 bg-cream-50 hover:bg-cream-100/60 border border-cream-300/80 pl-3.5 pr-3.5 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all rotate-1 -translate-y-0.5 hover:-translate-y-1 w-fit select-none -translate-x-2"
						>
							<HugeiconsIcon
								icon={GoogleDriveIcon}
								size={14}
								class="text-neutral-400 flex-shrink-0"
							/>
							<span class="text-[11px] font-medium tracking-tight"
								>Google Drive</span
							>
						</div>

						<!-- Downloads -->
						<div
							class="flex items-center space-x-2 bg-cream-50 hover:bg-cream-100/60 border border-cream-300/80 pl-3.5 pr-3.5 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all -rotate-1.5 translate-y-0.5 hover:-translate-y-0.5 w-fit select-none translate-x-2"
						>
							<HugeiconsIcon
								icon={Download01Icon}
								size={14}
								class="text-neutral-400 flex-shrink-0"
							/>
							<span class="text-[11px] font-medium tracking-tight"
								>Downloads</span
							>
						</div>

						<!-- Bookmarks -->
						<div
							class="flex items-center space-x-2 bg-cream-50 hover:bg-cream-100/60 border border-cream-300/80 pl-3.5 pr-3.5 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all rotate-2 -translate-y-1 hover:-translate-y-1.5 w-fit select-none -translate-x-1"
						>
							<HugeiconsIcon
								icon={Bookmark01Icon}
								size={14}
								class="text-neutral-400 flex-shrink-0"
							/>
							<span class="text-[11px] font-medium tracking-tight"
								>Bookmarks</span
							>
						</div>
					</div>

					<!-- Center Section: materio Logo focal point (occupies center x=38% to x=52%) -->
					<div
						class="absolute left-[38%] top-0 h-full w-[14%] flex items-center justify-center"
					>
						<div
							class="bg-cream-50 border border-cream-300 px-5 py-4 rounded-3xl shadow-[0_4px_25px_rgba(235,94,40,0.08)] hover:shadow-[0_4px_35px_rgba(235,94,40,0.18)] hover:border-brand-400/80 transition-all w-full flex items-center justify-center select-none relative z-25"
						>
							<img
								src="/assets/img/materio_new_bk.svg"
								alt="materio"
								class="h-6 w-auto select-none"
							/>
						</div>
					</div>

					<!-- Right Section: One Curated Learning Library (occupies right 44% of container) -->
					<div
						class="absolute right-0 top-0 h-full w-[44%] flex flex-col justify-center pl-4"
					>
						<!-- Inset Rounded Box Container with subtle dotted backdrop -->
						<div
							class="w-full bg-cream-50/20 border border-cream-300 rounded-3xl p-6 flex flex-col justify-between h-[360px] relative select-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)]"
						>
							<!-- Row 1 -->
							<div class="flex flex-wrap gap-3 items-center">
								<!-- Pill 1: Official Notes -->
								<div
									class="flex items-center space-x-1.5 bg-cream-50 hover:bg-cream-100/60 border border-cream-200/55 pl-3 pr-3.5 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all rotate-1 translate-y-0.5 select-none hover:border-cream-300"
								>
									<svg
										class="w-3.5 h-3.5 text-neutral-400 flex-shrink-0"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path
											d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
										/>
										<polyline points="14 2 14 8 20 8" />
									</svg>
									<span
										class="text-[11px] font-medium tracking-tight"
										>Official Notes</span
									>
								</div>

								<!-- Pill 2: Question Banks -->
								<div
									class="flex items-center space-x-1.5 bg-cream-50 hover:bg-cream-100/60 border border-cream-200/55 pl-3 pr-3.5 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all -rotate-1 -translate-y-0.5 select-none hover:border-cream-300"
								>
									<svg
										class="w-3.5 h-3.5 text-neutral-400 flex-shrink-0"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<circle cx="12" cy="12" r="10" />
										<path
											d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
										/>
										<line
											x1="12"
											y1="17"
											x2="12.01"
											y2="17"
										/>
									</svg>
									<span
										class="text-[11px] font-medium tracking-tight"
										>Question Banks</span
									>
								</div>
							</div>

							<!-- Row 2 -->
							<div class="flex flex-wrap gap-3 items-center">
								<!-- Pill 3: Previous Year Papers -->
								<div
									class="flex items-center space-x-1.5 bg-cream-50 hover:bg-cream-100/60 border border-cream-200/55 pl-3.5 pr-4 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all rotate-1.5 translate-y-1 select-none hover:border-cream-300"
								>
									<svg
										class="w-3.5 h-3.5 text-neutral-400 flex-shrink-0"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<circle cx="12" cy="12" r="10" />
										<polyline points="12 6 12 12 16 14" />
									</svg>
									<span
										class="text-[11px] font-medium tracking-tight"
										>Previous Year Papers</span
									>
								</div>

								<!-- Pill 4: Reference Books -->
								<div
									class="flex items-center space-x-1.5 bg-cream-50 hover:bg-cream-100/60 border border-cream-200/55 px-3.5 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all -rotate-1 translate-y-0.5 select-none hover:border-cream-300"
								>
									<svg
										class="w-3.5 h-3.5 text-neutral-400 flex-shrink-0"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path
											d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
										/>
										<path
											d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5v-15z"
										/>
									</svg>
									<span
										class="text-[11px] font-medium tracking-tight"
										>Reference Books</span
									>
								</div>
							</div>

							<!-- Row 3 -->
							<div class="flex flex-wrap gap-3 items-center">
								<!-- Pill 5: Lecture Slides -->
								<div
									class="flex items-center space-x-1.5 bg-cream-50 hover:bg-cream-100/60 border border-cream-200/55 px-3.5 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all rotate-0.5 -translate-y-1 select-none hover:border-cream-300"
								>
									<svg
										class="w-3.5 h-3.5 text-neutral-400 flex-shrink-0"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<rect
											x="2"
											y="3"
											width="20"
											height="14"
											rx="2"
											ry="2"
										/>
										<line x1="8" y1="21" x2="16" y2="21" />
										<line x1="12" y1="17" x2="12" y2="21" />
									</svg>
									<span
										class="text-[11px] font-medium tracking-tight"
										>Lecture Slides</span
									>
								</div>

								<!-- Pill 6: Lab Manuals -->
								<div
									class="flex items-center space-x-1.5 bg-cream-50 hover:bg-cream-100/60 border border-cream-200/55 px-3.5 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all -rotate-1.5 translate-y-1 select-none hover:border-cream-300"
								>
									<svg
										class="w-3.5 h-3.5 text-neutral-400 flex-shrink-0"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d="M6 3h12v18H6z" />
										<path d="M10 6h4M10 10h4M10 14h4" />
									</svg>
									<span
										class="text-[11px] font-medium tracking-tight"
										>Lab Manuals</span
									>
								</div>
							</div>

							<!-- Row 4 -->
							<div class="flex flex-wrap gap-3 items-center">
								<!-- Pill 7: Assignments -->
								<div
									class="flex items-center space-x-1.5 bg-cream-50 hover:bg-cream-100/60 border border-cream-200/55 px-3.5 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all rotate-1 -translate-y-0.5 select-none hover:border-cream-300"
								>
									<svg
										class="w-3.5 h-3.5 text-neutral-400 flex-shrink-0"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path
											d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
										/>
										<path
											d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"
										/>
									</svg>
									<span
										class="text-[11px] font-medium tracking-tight"
										>Assignments</span
									>
								</div>

								<!-- Pill 8: Practical Files -->
								<div
									class="flex items-center space-x-1.5 bg-cream-50 hover:bg-cream-100/60 border border-cream-200/55 px-3 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all -rotate-1 translate-y-1 select-none hover:border-cream-300"
								>
									<svg
										class="w-3.5 h-3.5 text-neutral-400 flex-shrink-0"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path
											d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
										/>
										<rect
											x="8"
											y="2"
											width="8"
											height="4"
											rx="1"
											ry="1"
										/>
									</svg>
									<span
										class="text-[11px] font-medium tracking-tight"
										>Practical Files</span
									>
								</div>

								<!-- Pill 9: Articles -->
								<div
									class="flex items-center space-x-1.5 bg-cream-50 hover:bg-cream-100/60 border border-cream-200/55 px-3 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600 transition-all rotate-2 translate-y-0.5 select-none hover:border-cream-300"
								>
									<svg
										class="w-3.5 h-3.5 text-neutral-400 flex-shrink-0"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path
											d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
										/>
										<path
											d="M16 8h2M16 12h2M16 16h2M6 8h6v8H6z"
										/>
									</svg>
									<span
										class="text-[11px] font-medium tracking-tight"
										>Articles</span
									>
								</div>
							</div>
						</div>
					</div>

					<!-- SVG Curved Sankey Connectors (Responsive overlay based on percentage values) -->
					<svg
						class="absolute inset-0 w-full h-full text-cream-400 pointer-events-none"
						viewBox="0 0 100 100"
						fill="none"
						preserveAspectRatio="none"
					>
						<!-- Left elements to center logo (lines converge to left edge of logo x=38, y=50) -->
						<path
							d="M 26 10 C 32 10, 32 50, 38 50"
							stroke="#b0a494"
							stroke-width="0.18"
							stroke-linecap="round"
						/>
						<path
							d="M 26 30 C 32 30, 32 50, 38 50"
							stroke="#b0a494"
							stroke-width="0.18"
							stroke-linecap="round"
						/>
						<path
							d="M 26 50 L 38 50"
							stroke="#b0a494"
							stroke-width="0.18"
							stroke-linecap="round"
						/>
						<path
							d="M 26 70 C 32 70, 32 50, 38 50"
							stroke="#b0a494"
							stroke-width="0.18"
							stroke-linecap="round"
						/>
						<path
							d="M 26 90 C 32 90, 32 50, 38 50"
							stroke="#b0a494"
							stroke-width="0.18"
							stroke-linecap="round"
						/>

						<!-- Neutral circle anchor nodes on left -->
						<circle cx="26" cy="10" r="0.4" fill="#b0a494" />
						<circle cx="26" cy="30" r="0.4" fill="#b0a494" />
						<circle cx="26" cy="50" r="0.4" fill="#b0a494" />
						<circle cx="26" cy="70" r="0.4" fill="#b0a494" />
						<circle cx="26" cy="90" r="0.4" fill="#b0a494" />

						<!-- One single line exits the logo right edge (52, 50) connecting to the library container left edge (56, 50) -->
						<path
							d="M 52 50 L 56 50"
							stroke="#b0a494"
							stroke-width="0.18"
							stroke-linecap="round"
						/>

						<!-- Single circle anchor node at library entrance point -->
						<circle cx="56" cy="50" r="0.4" fill="#b0a494" />
					</svg>
				</div>

				<!-- Mobile/Tablet Layout (Graceful Fallback Stack) -->
				<div
					class="relative z-10 w-full md:hidden flex flex-col items-center space-y-6"
				>
					<!-- Mobile Scattered Resources (Top) -->
					<div class="w-full flex flex-col items-center space-y-3.5">
						<span
							class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest block mb-1"
						>
							Scattered Resources
						</span>
						<div class="flex flex-wrap justify-center gap-3.5">
							<div
								class="flex items-center space-x-2 bg-cream-50 border border-cream-300/80 px-3.5 py-2 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<HugeiconsIcon
									icon={WhatsappIcon}
									size={14}
									class="text-neutral-400 flex-shrink-0"
								/>
								<span class="text-xs font-medium"
									>WhatsApp Groups</span
								>
							</div>
							<div
								class="flex items-center space-x-2 bg-cream-50 border border-cream-300/80 px-3.5 py-2 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<HugeiconsIcon
									icon={UniversityIcon}
									size={14}
									class="text-neutral-400 flex-shrink-0"
								/>
								<span class="text-xs font-medium"
									>College Portal</span
								>
							</div>
							<div
								class="flex items-center space-x-2 bg-cream-50 border border-cream-300/80 px-3.5 py-2 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<HugeiconsIcon
									icon={GoogleDriveIcon}
									size={14}
									class="text-neutral-400 flex-shrink-0"
								/>
								<span class="text-xs font-medium"
									>Google Drive</span
								>
							</div>
							<div
								class="flex items-center space-x-2 bg-cream-50 border border-cream-300/80 px-3.5 py-2 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<HugeiconsIcon
									icon={Download01Icon}
									size={14}
									class="text-neutral-400 flex-shrink-0"
								/>
								<span class="text-xs font-medium"
									>Downloads</span
								>
							</div>
							<div
								class="flex items-center space-x-2 bg-cream-50 border border-cream-300/80 px-3.5 py-2 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<HugeiconsIcon
									icon={Bookmark01Icon}
									size={14}
									class="text-neutral-400 flex-shrink-0"
								/>
								<span class="text-xs font-medium"
									>Bookmarks</span
								>
							</div>
						</div>
					</div>

					<!-- Mobile Centered wordmark separator (Darkened Line) -->
					<div class="w-[1.5px] h-8 bg-[#b0a494]"></div>

					<!-- Central logo with brand glow -->
					<div
						class="bg-cream-50 border border-cream-300 px-6 py-3.5 rounded-2xl shadow-[0_4px_25px_rgba(235,94,40,0.08)] hover:shadow-[0_4px_35px_rgba(235,94,40,0.18)] hover:border-brand-400/80 transition-all"
					>
						<img
							src="/assets/img/materio_new_bk.svg"
							alt="materio"
							class="h-5 w-auto"
						/>
					</div>

					<!-- Mobile Centered wordmark separator (Darkened Line) -->
					<div class="w-[1.5px] h-8 bg-[#b0a494]"></div>

					<!-- Mobile Curated Library (Bottom) -->
					<div
						class="w-full bg-cream-50/20 border border-cream-300 rounded-3xl p-5 flex flex-col items-center space-y-4 shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)]"
					>
						<span
							class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest block text-center"
						>
							One Curated Learning Library
						</span>
						<div class="flex flex-wrap justify-center gap-3">
							<!-- Pill 1: Official Notes -->
							<div
								class="flex items-center space-x-1.5 bg-cream-50 border border-cream-200/55 px-3 py-1.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<span class="text-xs font-medium"
									>Official Notes</span
								>
							</div>
							<!-- Pill 2: Question Banks -->
							<div
								class="flex items-center space-x-1.5 bg-cream-50 border border-cream-200/55 px-3 py-1.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<span class="text-xs font-medium"
									>Question Banks</span
								>
							</div>
							<!-- Pill 3: Previous Year Papers -->
							<div
								class="flex items-center space-x-1.5 bg-cream-50 border border-cream-200/55 px-3 py-1.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<span class="text-xs font-medium"
									>Previous Year Papers</span
								>
							</div>
							<!-- Pill 4: Reference Books -->
							<div
								class="flex items-center space-x-1.5 bg-cream-50 border border-cream-200/55 px-3 py-1.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<span class="text-xs font-medium"
									>Reference Books</span
								>
							</div>
							<!-- Pill 5: Lecture Slides -->
							<div
								class="flex items-center space-x-1.5 bg-cream-50 border border-cream-200/55 px-3 py-1.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<span class="text-xs font-medium"
									>Lecture Slides</span
								>
							</div>
							<!-- Pill 6: Lab Manuals -->
							<div
								class="flex items-center space-x-1.5 bg-cream-50 border border-cream-200/55 px-3 py-1.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<span class="text-xs font-medium"
									>Lab Manuals</span
								>
							</div>
							<!-- Pill 7: Assignments -->
							<div
								class="flex items-center space-x-1.5 bg-cream-50 border border-cream-200/55 px-3 py-1.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<span class="text-xs font-medium"
									>Assignments</span
								>
							</div>
							<!-- Pill 8: Practical Files -->
							<div
								class="flex items-center space-x-1.5 bg-cream-50 border border-cream-200/55 px-3 py-1.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<span class="text-xs font-medium"
									>Practical Files</span
								>
							</div>
							<!-- Pill 9: Articles -->
							<div
								class="flex items-center space-x-1.5 bg-cream-50 border border-cream-200/55 px-3 py-1.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-neutral-600"
							>
								<span class="text-xs font-medium">Articles</span
								>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- Info Grid (Below the Hero Card) -->
	{#if posts.length > 0}
		<div
			class="w-full max-w-5xl px-5 sm:px-6 md:px-0 grid grid-cols-1 md:grid-cols-12 gap-8 pt-6 border-t border-cream-200 mb-24"
		>
			<div class="md:col-span-4 flex flex-col">
				<a
					href="#updates"
					class="inline-flex items-center space-x-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors uppercase tracking-wider mb-2"
				>
					<span>Latest Updates</span>
					<HugeiconsIcon icon={ArrowRight01Icon} size={14} />
				</a>
			</div>
			<div class="md:col-span-8 flex flex-col space-y-8">
				{#each posts as post}
					<div class="flex flex-col space-y-1">
						{#if post.date}
							<div
								class="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest"
							>
								{formatDate(post.date)}
							</div>
						{/if}
						<p
							class="font-sans text-lg md:text-xl font-normal leading-relaxed text-neutral-500"
						>
							<span class="text-cream-dark font-semibold"
								>{post.title}{post.title.trim().endsWith(".") ||
								post.title.trim().endsWith("?") ||
								post.title.trim().endsWith("!")
									? ""
									: "."}</span
							>
							{post.excerpt}
							<a
								href="https://getmaterio.app/{post.category ||
									'whats-new'}/{post.slug}"
								target="_blank"
								class="inline-flex items-center ml-2 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors uppercase tracking-wider group"
							>
								<span class="group-hover:underline">Read</span>
								<HugeiconsIcon
									icon={ArrowRight01Icon}
									size={11}
									class="ml-1 transition-transform group-hover:translate-x-0.5"
								/>
							</a>
						</p>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Features Section (Premium Editorial Zig-Zag Layout) -->
	<section
		id="features"
		class="w-full max-w-5xl px-5 sm:px-6 md:px-0 mb-32 flex flex-col space-y-24 md:space-y-36"
	>
		<!-- Feature 1: NAVIGATION -->
		<div
			class="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 items-center"
		>
			<!-- Text Column (Left) -->
			<div class="md:col-span-5 flex flex-col space-y-4">
				<span
					class="text-[14px] font-semibold text-neutral-400 tracking-widest block"
				>
					(1)
				</span>
				<h3
					class="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-cream-dark leading-tight"
				>
					Everything starts here.
				</h3>
				<p class="font-sans text-base leading-relaxed text-neutral-500">
					Finding the right material shouldn't require digging through
					folders. Materio's navigation is designed around how
					students actually study, making every subject, topic and
					resource easy to reach.
				</p>
			</div>

			<!-- Preview Container Column (Right) -->
			<div class="md:col-span-7">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="w-full bg-cream-100/25 border-[3px] border-cream-300 rounded-3xl relative select-none shadow-[0_8px_30px_rgba(0,0,0,0.015)] h-[300px] md:h-[380px] flex items-center justify-center overflow-hidden group"
					oncontextmenu={(e) => e.preventDefault()}
				>
					<!-- Blurred WebP background card -->
					<div
						class="absolute inset-0 transition-colors overflow-hidden"
					>
						<!-- WebP Image -->
						<div
							class="absolute inset-0 bg-cover bg-center"
							style="background-image: url('/assets/img/52ceb5a9-f834-4a67-a09b-61143afbd2bc.webp');"
						></div>
						<!-- Light Blur Overlay -->
						<div
							class="absolute inset-0 bg-white/40 backdrop-blur-[13px]"
						></div>
					</div>

					<!-- Foreground Screenshot Image (positioned top-20%, scaled up to naturally clip the bottom edge) -->
					<img
						src="/assets/img/22sd1df60p.webp"
						alt="Navigation preview"
						class="absolute top-[20%] right-0 w-[80%] md:w-[70%] h-auto object-contain z-20"
					/>
				</div>
			</div>
		</div>

		<!-- Feature 2: THINKLET -->
		<div
			class="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 items-center"
		>
			<!-- Preview Container Column (Left) - Order 2 on Mobile, Order 1 on Desktop -->
			<div class="md:col-span-7 order-2 md:order-1">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="w-full bg-cream-100/25 border-[3px] border-cream-300 rounded-3xl relative select-none shadow-[0_8px_30px_rgba(0,0,0,0.015)] h-[300px] md:h-[380px] flex items-center justify-center overflow-hidden"
					oncontextmenu={(e) => e.preventDefault()}
				>
					<!-- Blurred WebP background card -->
					<div
						class="absolute inset-0 transition-colors overflow-hidden"
					>
						<!-- WebP Image -->
						<div
							class="absolute inset-0 bg-cover bg-center"
							style="background-image: url('/assets/img/db78586b-1e3c-4e9e-8856-e57bc9a393ad.webp');"
						></div>
						<!-- Light Blur Overlay -->
						<div
							class="absolute inset-0 bg-white/40 backdrop-blur-[13px]"
						></div>
					</div>

					<!-- Centered Foreground Screenshot Image (zoomed to reduce outer margins) -->
					<img
						src="/assets/img/da3de6dd-945a-4faf-899b-7a1a22e473ed.webp"
						alt="Thinklet preview"
						class="w-[95%] md:w-[92%] h-auto max-h-[92%] object-contain z-20"
					/>
				</div>
			</div>

			<!-- Text Column (Right) - Order 1 on Mobile, Order 2 on Desktop -->
			<div
				class="md:col-span-5 flex flex-col space-y-4 order-1 md:order-2"
			>
				<span
					class="text-[14px] font-semibold text-neutral-400 tracking-widest block"
				>
					(2)
				</span>
				<h3
					class="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-cream-dark leading-tight"
				>
					Your study companion, built in.
				</h3>
				<p class="font-sans text-base leading-relaxed text-neutral-500">
					Thinklet helps you understand your materials instead of just
					searching them. Ask questions, generate summaries and
					explore complex concepts naturally without ever leaving the
					page.
				</p>
			</div>
		</div>

		<!-- Feature 3: PERSONALIZATION -->
		<div
			class="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 items-center"
		>
			<!-- Text Column (Left) -->
			<div class="md:col-span-5 flex flex-col space-y-4">
				<span
					class="text-[14px] font-semibold text-neutral-400 tracking-widest block"
				>
					(3)
				</span>
				<h3
					class="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-cream-dark leading-tight"
				>
					Built around the way you study.
				</h3>
				<p class="font-sans text-base leading-relaxed text-neutral-500">
					Materio remembers your progress and keeps your library ready
					whenever you return, creating a seamless experience across
					every study session.
				</p>
			</div>

			<!-- Preview Container Column (Right) -->
			<div class="md:col-span-7">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="w-full bg-cream-100/25 border-[3px] border-cream-300 rounded-3xl relative select-none shadow-[0_8px_30px_rgba(0,0,0,0.015)] h-[300px] md:h-[380px] flex items-center justify-center overflow-hidden"
					oncontextmenu={(e) => e.preventDefault()}
				>
					<!-- Blurred WebP background card -->
					<div
						class="absolute inset-0 transition-colors overflow-hidden"
					>
						<!-- WebP Image -->
						<div
							class="absolute inset-0 bg-cover bg-center"
							style="background-image: url('/assets/img/5481d080-ec1d-4f4a-9feb-b477e3ea4bb6.webp');"
						></div>
						<!-- Light Blur Overlay -->
						<div
							class="absolute inset-0 bg-white/40 backdrop-blur-[13px]"
						></div>
					</div>

					<!-- Foreground Screenshot Image (positioned top-20%, scaled up to naturally clip the bottom edge) -->
					<img
						src="/assets/img/Frame@2160p.webp"
						alt="Personalization preview"
						class="absolute top-[38%] md:top-[20%] right-0 w-[90%] md:w-[70%] h-auto object-contain z-20"
					/>
				</div>
			</div>
		</div>

		<!-- Feature 4: READING EXPERIENCE -->
		<div
			class="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 items-center"
		>
			<!-- Preview Container Column (Left) - Order 2 on Mobile, Order 1 on Desktop -->
			<div class="md:col-span-7 order-2 md:order-1">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="w-full bg-cream-100/25 border-[3px] border-cream-300 rounded-3xl relative select-none shadow-[0_8px_30px_rgba(0,0,0,0.015)] h-[300px] md:h-[380px] flex items-center justify-center overflow-hidden"
					oncontextmenu={(e) => e.preventDefault()}
				>
					<!-- Blurred WebP background card -->
					<div
						class="absolute inset-0 transition-colors overflow-hidden"
					>
						<!-- WebP Image -->
						<div
							class="absolute inset-0 bg-cover bg-center"
							style="background-image: url('/assets/img/7bf7b2ae-9959-4411-9bdf-56a144f60428.webp');"
						></div>
						<!-- Light Blur Overlay -->
						<div
							class="absolute inset-0 bg-white/40 backdrop-blur-[13px]"
						></div>
					</div>

					<!-- Foreground Screenshot Image (horizontally centered, aligned to top-[25px], scaled down slightly to naturally clip at the bottom) -->
					<img
						src="/assets/img/5rm2160p.webp"
						alt="Reading Experience preview"
						class="absolute top-[60px] md:top-[25px] left-1/2 -translate-x-1/2 w-[92%] md:w-[80%] h-auto object-contain z-20"
					/>
				</div>
			</div>

			<!-- Text Column (Right) - Order 1 on Mobile, Order 2 on Desktop -->
			<div
				class="md:col-span-5 flex flex-col space-y-4 order-1 md:order-2"
			>
				<span
					class="text-[14px] font-semibold text-neutral-400 tracking-widest block"
				>
					(4)
				</span>
				<h3
					class="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-cream-dark leading-tight"
				>
					Comfortable for every study session.
				</h3>
				<p class="font-sans text-base leading-relaxed text-neutral-500">
					Choose the reading experience that fits your environment.
					Whether you're reading during the day, at night or on an
					e-ink display, Materio adapts with you.
				</p>
			</div>
		</div>

		<!-- Feature 5: INSIGHTROOM -->
		<div
			class="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 items-center"
		>
			<!-- Text Column (Left) -->
			<div class="md:col-span-5 flex flex-col space-y-4">
				<span
					class="text-[14px] font-semibold text-neutral-400 tracking-widest block"
				>
					(5)
				</span>
				<h3
					class="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-cream-dark leading-tight"
				>
					Go beyond the syllabus.
				</h3>
				<p class="font-sans text-base leading-relaxed text-neutral-500">
					Discover original articles, educational explainers and
					AI-powered summaries that help you understand topics more
					deeply.
				</p>
			</div>

			<!-- Preview Container Column (Right) -->
			<div class="md:col-span-7">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="w-full bg-cream-100/25 border-[3px] border-cream-300 rounded-3xl relative select-none shadow-[0_8px_30px_rgba(0,0,0,0.015)] h-[300px] md:h-[380px] flex items-center justify-center overflow-hidden"
					oncontextmenu={(e) => e.preventDefault()}
				>
					<!-- Blurred WebP background card -->
					<div
						class="absolute inset-0 transition-colors overflow-hidden"
					>
						<!-- WebP Image -->
						<div
							class="absolute inset-0 bg-cover bg-center"
							style="background-image: url('/assets/img/9738efed-f1d0-40ba-9b5d-e865413081c4.webp');"
						></div>
						<!-- Light Blur Overlay -->
						<div
							class="absolute inset-0 bg-white/40 backdrop-blur-[13px]"
						></div>
					</div>

					<!-- Foreground Screenshot Image (scaled up even more and top-aligned to push it down and clip the bottom edge) -->
					<img
						src="/assets/img/mr34eyy450p.webp"
						alt="Flashcards preview"
						class="absolute top-[25%] right-0 w-[105%] md:w-[95%] h-auto object-contain z-20"
					/>
				</div>
			</div>
		</div>

		<!-- Feature 6: SEARCH -->
		<div
			class="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 items-center"
		>
			<!-- Preview Container Column (Left) - Order 2 on Mobile, Order 1 on Desktop -->
			<div class="md:col-span-7 order-2 md:order-1">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="w-full bg-cream-100/25 border-[3px] border-cream-300 rounded-3xl relative select-none shadow-[0_8px_30px_rgba(0,0,0,0.015)] h-[300px] md:h-[380px] flex items-center justify-center overflow-hidden"
					oncontextmenu={(e) => e.preventDefault()}
				>
					<!-- Blurred WebP background card -->
					<div
						class="absolute inset-0 transition-colors overflow-hidden"
					>
						<!-- WebP Image -->
						<div
							class="absolute inset-0 bg-cover bg-center"
							style="background-image: url('/assets/img/24d4ff6ts.webp');"
						></div>
						<!-- Light Blur Overlay -->
						<div
							class="absolute inset-0 bg-white/40 backdrop-blur-[13px]"
						></div>
					</div>

					<!-- Foreground Screenshot Image (horizontally centered, width-constrained, clipped at bottom) -->
					<img
						src="/assets/img/ae28fdl60p.webp"
						alt="Search preview"
						class="absolute top-[38%] md:top-[22%] left-1/2 -translate-x-1/2 w-[88%] md:w-[82%] h-auto object-contain z-20"
					/>
				</div>
			</div>

			<!-- Text Column (Right) - Order 1 on Mobile, Order 2 on Desktop -->
			<div
				class="md:col-span-5 flex flex-col space-y-4 order-1 md:order-2"
			>
				<span
					class="text-[14px] font-semibold text-neutral-400 tracking-widest block"
				>
					(6)
				</span>
				<h3
					class="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-cream-dark leading-tight"
				>
					Find exactly what you're looking for.
				</h3>
				<p class="font-sans text-base leading-relaxed text-neutral-500">
					Search across your entire library in seconds. Whether it's a
					chapter, concept, question bank or lecture slides, Materio
					surfaces the most relevant materials from your curated
					collection.
				</p>
			</div>
		</div>
	</section>

	<!-- Small Features Row -->
	<section
		id="downloads"
		class="w-full max-w-5xl px-5 sm:px-6 md:px-0 mb-32 flex flex-col space-y-12"
	>
		<div class="flex flex-col items-start space-y-3.5 max-w-2xl">
			<h2
				class="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-cream-dark leading-tight"
			>
				The details that make a difference.
			</h2>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10 w-full">
			<!-- Column 1: Offline Reading -->
			<div class="flex flex-col space-y-4 group">
				<!-- Image Frame -->
				<div
					use:smoothCorners={{
						corners: { radius: 24, smoothing: 0.8 },
					}}
					class="h-[200px] md:h-[240px] w-full overflow-hidden bg-cream-100/25 border-[3px] border-cream-300 rounded-3xl relative flex items-center justify-center select-none shadow-[0_8px_30px_rgba(0,0,0,0.015)]"
				>
					<!-- Blurred Background Card -->
					<div
						class="absolute inset-0 transition-colors overflow-hidden"
					>
						<div
							class="absolute inset-0 bg-cover bg-center"
							style="background-image: url('/assets/img/9dbdc858-c6c6-492b-98f4-7ef5a1ca303e.webp');"
						></div>
						<div
							class="absolute inset-0 bg-white/40 backdrop-blur-[10px]"
						></div>
					</div>
					<!-- Foreground Screenshot Image (Clipped at bottom and right, zoomed) -->
					<img
						src="/assets/img/downloads.webp"
						alt="Downloads preview"
						class="absolute top-[25%] left-[20%] w-[160%] max-w-none h-auto object-contain z-20 rounded-tl-xl border-l-[2px] border-t-[2px] border-cream-200/50 shadow-md"
					/>
				</div>
				<!-- Typography -->
				<div class="flex flex-col space-y-2">
					<span
						class="text-[14px] font-semibold text-neutral-400 tracking-widest block"
					>
						(7)
					</span>
					<h3
						class="font-heading text-lg md:text-xl font-semibold tracking-tight text-cream-dark leading-tight"
					>
						Offline Reading
					</h3>
					<p
						class="font-sans text-sm leading-relaxed text-neutral-500"
					>
						Access downloaded notes, slides, and manuals directly
						from your browser. Keep studying even when campus Wi-Fi
						drops.
					</p>
				</div>
			</div>

			<!-- Column 2: Peer Sharing -->
			<div class="flex flex-col space-y-4 group">
				<!-- Image Frame -->
				<div
					use:smoothCorners={{
						corners: { radius: 24, smoothing: 0.8 },
					}}
					class="h-[200px] md:h-[240px] w-full overflow-hidden bg-cream-100/25 border-[3px] border-cream-300 rounded-3xl relative flex items-center justify-center select-none shadow-[0_8px_30px_rgba(0,0,0,0.015)]"
				>
					<!-- Blurred Background Card -->
					<div
						class="absolute inset-0 transition-colors overflow-hidden"
					>
						<div
							class="absolute inset-0 bg-cover bg-center"
							style="background-image: url('/assets/img/85ce3b41-d668-4feb-abf3-24bb63fe35e0.webp');"
						></div>
						<div
							class="absolute inset-0 bg-white/40 backdrop-blur-[10px]"
						></div>
					</div>
					<!-- Foreground Screenshot Image (Centered, bottom aligned, zoomed) -->
					<img
						src="/assets/img/sharedcontext.webp"
						alt="Sharing preview"
						class="absolute bottom-[-15px] left-1/2 -translate-x-1/2 w-[85%] h-auto object-contain z-20 rounded-t-lg border-t border-x border-cream-200/50 shadow-md"
					/>
				</div>
				<!-- Typography -->
				<div class="flex flex-col space-y-2">
					<span
						class="text-[14px] font-semibold text-neutral-400 tracking-widest block"
					>
						(8)
					</span>
					<h3
						class="font-heading text-lg md:text-xl font-semibold tracking-tight text-cream-dark leading-tight"
					>
						Direct Links
					</h3>
					<p
						class="font-sans text-sm leading-relaxed text-neutral-500"
					>
						Instantly share custom bookmarks, notes, or folders with
						your study group using clean, direct links.
					</p>
				</div>
			</div>

			<!-- Column 3: Personal Library -->
			<div class="flex flex-col space-y-4 group">
				<!-- Image Frame -->
				<div
					use:smoothCorners={{
						corners: { radius: 24, smoothing: 0.8 },
					}}
					class="h-[200px] md:h-[240px] w-full overflow-hidden bg-cream-100/25 border-[3px] border-cream-300 rounded-3xl relative flex items-center justify-center select-none shadow-[0_8px_30px_rgba(0,0,0,0.015)]"
				>
					<!-- Blurred Background Card -->
					<div
						class="absolute inset-0 transition-colors overflow-hidden"
					>
						<div
							class="absolute inset-0 bg-cover bg-center"
							style="background-image: url('/assets/img/199cbe54-f67b-48ab-8b74-bbf9667cee13.webp');"
						></div>
						<div
							class="absolute inset-0 bg-white/40 backdrop-blur-[10px]"
						></div>
					</div>
					<!-- Foreground Screenshot Image (Clipped at bottom and right, zoomed) -->
					<img
						src="/assets/img/notebook.webp"
						alt="Notebook preview"
						class="absolute top-[25%] left-[20%] w-[160%] max-w-none h-auto object-contain z-20 rounded-tl-xl border-l-[2px] border-t-[2px] border-cream-200/50 shadow-md"
					/>
				</div>
				<!-- Typography -->
				<div class="flex flex-col space-y-2">
					<span
						class="text-[14px] font-semibold text-neutral-400 tracking-widest block"
					>
						(9)
					</span>
					<h3
						class="font-heading text-lg md:text-xl font-semibold tracking-tight text-cream-dark leading-tight"
					>
						Curated Notebooks
					</h3>
					<p
						class="font-sans text-sm leading-relaxed text-neutral-500"
					>
						Save, organize, and customize bookmarks into specialized
						notebooks tailored for specific exams or subjects.
					</p>
				</div>
			</div>
		</div>

		<!-- Native Apps Banner -->
		<div
			use:smoothCorners={{
				corners: { radius: 24, smoothing: 0.8 },
			}}
			class="w-full mt-4 p-6 sm:p-8 bg-gradient-to-r from-cream-100/40 via-white/80 to-cream-100/40 border-[2px] border-cream-300 rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.02)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6"
		>
			<div class="flex items-center gap-4">
				<div class="w-12 h-12 rounded-2xl bg-[#ff5400]/10 flex items-center justify-center shrink-0 border border-[#ff5400]/20 text-[#ff5400]">
					<HugeiconsIcon icon={Download01Icon} size={24} />
				</div>
				<div>
					<h3 class="font-heading text-lg sm:text-xl font-semibold text-cream-dark">Get Materio Native Apps</h3>
					<p class="font-sans text-sm text-neutral-500 mt-0.5">Download for Windows & Android with offline sync and local MCP server.</p>
				</div>
			</div>
			<a
				href="/downloads"
				use:smoothCorners={{
					corners: { radius: 14, smoothing: 0.8 },
				}}
				class="btn-dark-hero px-6 py-3 text-[14px] font-semibold text-white tracking-wide inline-flex items-center gap-2 whitespace-nowrap"
			>
				<span>View Downloads</span>
				<HugeiconsIcon icon={ArrowRight01Icon} size={16} />
			</a>
		</div>
	</section>

	<!-- Connectors Section (3D Tilted Grid & Fallback State) -->
	<section
		id="connectors"
		class="w-full max-w-5xl px-5 sm:px-6 md:px-0 mb-32 flex flex-col items-center text-center space-y-4"
	>
		<!-- Heading and Badge -->
		<div class="flex flex-col items-center space-y-3.5 max-w-2xl">
			<span
				class="inline-flex items-center space-x-1 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
			>
				Connectors
			</span>
			<h2
				class="font-heading text-3xl md:text-4xl font-semibold tracking-tight text-cream-dark leading-[1.15]"
			>
				Access the entire Materio library<br class="hidden sm:inline" />
				from your favorite AI.
			</h2>
		</div>

		<!-- 3D Perspective Grid of 6 Logos (1 Row) -->
		<div
			class="relative w-full py-0 flex flex-col items-center justify-center"
		>
			<!-- 3D Perspective Wrapper (no overflow-hidden here, so icons can elevate freely) -->
			<div
				class="perspective-container relative w-full max-w-2xl px-2 py-2 flex justify-center z-10"
			>
				<!-- Tilted Grid (1 row, 6 columns) -->
				<div
					class="grid grid-cols-6 gap-3 sm:gap-6 md:gap-8 w-full px-2 tilted-grid-transform justify-center justify-items-center"
				>
					{#each connectorLogos as logo}
						<div
							class="logo-card group relative flex items-center justify-center transition-all duration-300"
							style="aspect-ratio: 1 / 1;"
						>
							{#if !imageErrors[logo.name]}
								<img
									src={logo.img}
									alt={logo.name}
									class="w-full h-full object-contain"
									onerror={() =>
										(imageErrors[logo.name] = true)}
								/>
							{:else}
								<!-- Premium typography-based placeholder fallback -->
								<div
									class="w-full h-full flex flex-col items-center justify-center bg-white border border-cream-200/50"
									style="color: {logo.logoColor}; border-radius: 22.5%;"
								>
									<div
										class="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-xs sm:text-sm font-black tracking-tight mb-1"
										style="background-color: {logo.logoColor}15; color: {logo.logoColor};"
									>
										{logo.name.slice(0, 2).toUpperCase()}
									</div>
									<span
										class="text-[8px] sm:text-[10px] font-bold tracking-tight text-neutral-500"
										>{logo.name}</span
									>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>

			<!-- 2D Overlay Container centered on screen, wrapping the grid width precisely -->
			<!-- This forces the blurs/fades to render in 2D space on top of the 3D grid and overlap the side icons correctly -->
			<div
				class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-2xl px-2 pointer-events-none z-30"
			>
				<!-- Left side progressive blur & fade -->
				<ProgressiveBlur
					position="left"
					width="auto"
					class="absolute left-0 top-0 bottom-0 z-30 w-12 md:w-[72px]"
				/>
				<div
					class="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-cream-50 to-transparent z-40"
				></div>

				<!-- Right side progressive blur & fade -->
				<ProgressiveBlur
					position="right"
					width="auto"
					class="absolute right-0 top-0 bottom-0 z-30 w-12 md:w-[72px]"
				/>
				<div
					class="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-cream-50 to-transparent z-40"
				></div>
			</div>
		</div>

		<!-- Bottom Description -->
		<p
			class="font-sans text-[17px] md:text-lg font-normal leading-relaxed text-neutral-500 max-w-3xl px-4"
		>
			Access Materio's curated library directly from the AI assistants and
			workspaces you already use through the Model Context Protocol (MCP).
			No switching tabs or manually copying context—just ask naturally
			from the tools you already use.
		</p>
	</section>
</main>

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
			<!-- Pricing Link (Disabled)
			<a
				href="/pricing"
				class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
				>Pricing</a
			>
			-->
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
				href="#faqs"
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
			<!-- Advertising Link (Disabled)
			<a
				href="/advertising"
				target="_blank"
				class="text-[16px] font-semibold text-cream-dark hover:opacity-75 transition-opacity"
				>Advertising</a
			>
			-->
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
				{#if statusType === "operational"}
					<span
						class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
					></span>
					<span
						class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"
					></span>
				{:else if statusType === "checking"}
					<span
						class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"
					></span>
					<span
						class="relative inline-flex rounded-full h-2 w-2 bg-amber-500"
					></span>
				{:else}
					<span
						class="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"
					></span>
					<span
						class="relative inline-flex rounded-full h-2 w-2 bg-rose-500"
					></span>
				{/if}
			</span>
			<span
				class="font-semibold text-[13px] {statusType === 'operational'
					? 'text-emerald-700/90'
					: statusType === 'checking'
						? 'text-amber-700/90'
						: 'text-rose-700/90'}">{statusText}</span
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

<!-- Mobile Menu Overlay -->
{#if mobileMenuOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		transition:fade={{ duration: 250 }}
		class="fixed inset-0 z-[100] bg-cream-50/98 backdrop-blur-xl overflow-y-auto overscroll-contain flex flex-col justify-between"
	>
		<div>
			<!-- Header -->
			<div class="flex items-center justify-between p-6 pt-8 pb-4">
				<!-- Logo -->
				<a
					href="/"
					class="flex items-center ml-1"
					onclick={() => (mobileMenuOpen = false)}
				>
					<img
						src="/assets/img/materio_new_bk.svg"
						alt="materio"
						class="h-7 w-auto"
					/>
				</a>
				<!-- Close Button -->
				<button
					onclick={() => (mobileMenuOpen = false)}
					class="p-2 -mr-2 text-neutral-800 transition-opacity hover:opacity-70"
				>
					<HugeiconsIcon icon={Cancel01Icon} size={24} />
				</button>
			</div>

			<!-- Links -->
			<div class="flex flex-col mt-4">
				<a
					href="#features"
					onclick={() => (mobileMenuOpen = false)}
					in:blurSlide={{ delay: 100 }}
					out:fade={{ duration: 150 }}
					class="py-5 px-7 border-t border-cream-200/60 font-exposure text-[26px] tracking-tight text-[#ff5400] hover:bg-cream-100/50 transition-colors"
				>
					Features
				</a>
				<a
					href="/connectors"
					target="_blank"
					onclick={() => (mobileMenuOpen = false)}
					in:blurSlide={{ delay: 150 }}
					out:fade={{ duration: 150 }}
					class="py-5 px-7 border-t border-cream-200/60 font-exposure text-[26px] tracking-tight text-[#ff5400] hover:bg-cream-100/50 transition-colors"
				>
					Connectors
				</a>
				<a
					href="#faqs"
					onclick={() => (mobileMenuOpen = false)}
					in:blurSlide={{ delay: 200 }}
					out:fade={{ duration: 150 }}
					class="py-5 px-7 border-t border-cream-200/60 font-exposure text-[26px] tracking-tight text-[#ff5400] hover:bg-cream-100/50 transition-colors"
				>
					FAQ
				</a>
				<!-- Pricing Link (Disabled)
				<a
					href="/pricing"
					onclick={() => (mobileMenuOpen = false)}
					in:blurSlide={{ delay: 250 }}
					out:fade={{ duration: 150 }}
					class="py-5 px-7 border-t border-cream-200/60 font-exposure text-[26px] tracking-tight text-[#ff5400] hover:bg-cream-100/50 transition-colors"
				>
					Pricing
				</a>
				-->
				<a
					href="/downloads"
					onclick={() => (mobileMenuOpen = false)}
					in:blurSlide={{ delay: 300 }}
					out:fade={{ duration: 150 }}
					class="py-5 px-7 border-t border-cream-200/60 font-exposure text-[26px] tracking-tight text-[#ff5400] hover:bg-cream-100/50 transition-colors"
				>
					Downloads
				</a>

				{#if !loading && user}
					<button
						onclick={() => {
							mobileMenuOpen = false;
							handleLogout();
						}}
						in:blurSlide={{ delay: 300 }}
						out:fade={{ duration: 150 }}
						class="w-full text-left py-5 px-7 border-y border-cream-200/60 font-exposure text-[26px] tracking-tight text-[#ff5400] hover:bg-cream-100/50 transition-colors focus:outline-none"
					>
						Log Out
					</button>
				{:else}
					<button
						onclick={() => {
							mobileMenuOpen = false;
							handleLoginRedirect();
						}}
						in:blurSlide={{ delay: 300 }}
						out:fade={{ duration: 150 }}
						class="w-full text-left py-5 px-7 border-y border-cream-200/60 font-exposure text-[26px] tracking-tight text-[#ff5400] hover:bg-cream-100/50 transition-colors focus:outline-none"
					>
						Log in
					</button>
				{/if}
			</div>
		</div>

		<!-- Bottom CTA Button -->
		<div class="p-6 pb-10 mt-auto w-full flex flex-col">
			{#if !loading && user}
				<button
					onclick={() => { mobileMenuOpen = false; handleGoToApp(); }}
					use:smoothCorners={{
						corners: { radius: 18, smoothing: 0.8 },
					}}
					class="w-full py-4 text-center text-[17px] font-semibold tracking-wide text-white transition-all active:scale-[0.98] focus:outline-none bg-gradient-to-t from-[#161616] via-[#242424] to-[#363636] border border-white/25 shadow-lg"
				>
					Go to App
				</button>
				{#if !mobileSkipDismissed}
					<div class="mt-4 px-1 flex items-start justify-between gap-2">
						<div>
							<p class="text-[13px] font-medium text-neutral-500 leading-snug">Skip this page next time?</p>
							<button
								onclick={() => { mobileMenuOpen = false; handleAlwaysOpen(); }}
								class="mt-1 text-[13px] font-semibold text-[#ff5400] active:text-[#e04a00] inline-flex items-center gap-1 transition-colors focus:outline-none"
							>
								Always open Materio <span aria-hidden="true">→</span>
							</button>
						</div>
						<button
							onclick={() => mobileSkipDismissed = true}
							class="shrink-0 p-1 rounded-full text-neutral-400 active:text-neutral-600 transition-colors"
							aria-label="Dismiss"
						>
							<HugeiconsIcon icon={Cancel01Icon} size={14} />
						</button>
					</div>
				{/if}
			{:else}
				<button
					onclick={() => {
						mobileMenuOpen = false;
						handleSignupRedirect();
					}}
					use:smoothCorners={{
						corners: { radius: 18, smoothing: 0.8 },
					}}
					class="w-full py-4 text-center text-[17px] font-semibold tracking-wide text-white transition-all active:scale-[0.98] focus:outline-none bg-gradient-to-t from-[#161616] via-[#242424] to-[#363636] border border-white/25 shadow-lg"
				>
					Get Started
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Subtle transition styles */
	:global(html:has(.landing-page)) {
		scroll-behavior: smooth;
	}
	:global(.heart-red svg),
	:global(.heart-red path) {
		fill: #ef4444 !important;
		color: #ef4444 !important;
		stroke: #ef4444 !important;
	}

	.perspective-container {
		perspective: 1200px;
		perspective-origin: 50% 0%;
	}

	.tilted-grid-transform {
		transform: rotateX(32deg) rotateY(0deg) rotateZ(0deg) scale(0.95);
		transform-style: preserve-3d;
	}

	.logo-card {
		transform-style: preserve-3d;
		transform: translateY(0) translateZ(0);
		transition:
			transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1),
			filter 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
		width: 100%;
		max-width: 76px;
		aspect-ratio: 1 / 1;
		filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.12));
	}

	@media (min-width: 640px) {
		.logo-card {
			max-width: 92px;
		}
	}

	.logo-card:hover {
		transform: translateY(-6px) translateZ(4px);
		filter: drop-shadow(0 10px 14px rgba(0, 0, 0, 0.16));
	}

	/* Premium Squircle CTA Buttons styling (with color transition only on hover) */
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

	.btn-light-hero {
		background: linear-gradient(180deg, #ffffff 0%, #e8e8e8 100%);
		border: 1px solid #cfcfcf;
		box-shadow:
			0 4px 12px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.8);
		transition:
			background 0.25s ease,
			box-shadow 0.25s ease;
	}
	.btn-light-hero:hover {
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
	}

	.btn-dark-header {
		background: linear-gradient(180deg, #3a3a3a 0%, #202020 100%);
		border: 1px solid #181818;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.1);
		transition:
			background 0.25s ease,
			box-shadow 0.25s ease;
	}
	.btn-dark-header:hover {
		background: linear-gradient(180deg, #4c4c4c 0%, #303030 100%);
	}
	/* "Skip this page next time?" hover tooltip (plain CSS: Tailwind isn't bundled) */
	.skip-tip {
		position: absolute; top: 100%; right: 0; margin-top: 12px; width: 280px; max-width: calc(100vw - 32px);
		background: #fff; border: 1px solid #e5e5e5; border-radius: 16px;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12); padding: 12px 16px; z-index: 50; text-align: left;
	}
	/* Invisible hover bridge over the margin gap so moving the cursor from
		the button to the tooltip doesn't trigger mouseleave (which made the
		menus/tooltips disappear before they could be clicked). */
	.skip-tip::before {
		content: ""; position: absolute; top: -12px; left: 0; right: 0; height: 12px; background: transparent;
	}
	.nav-drop::before {
		content: ""; position: absolute; top: -8px; left: 0; right: 0; height: 8px; background: transparent;
	}
	.skip-tip-c { right: auto; left: 50%; transform: translateX(-50%); }
	.skip-tip > div:first-child { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
	.skip-tip-q { font-size: 13px; font-weight: 500; color: #525252; line-height: 1.4; margin: 0; }
	.skip-tip-x { flex-shrink: 0; margin: -2px -4px 0 0; padding: 4px; border: 0; border-radius: 999px; background: none; color: #a3a3a3; cursor: pointer; }
	.skip-tip-x:hover { background: #f5f5f5; color: #525252; }
	.skip-tip-go { margin-top: 4px; font-size: 13px; font-weight: 600; color: #ff5400; background: none; border: 0; padding: 0; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
	.skip-tip-go:hover { color: #e04a00; }

	:global(h1), :global(h2), :global(h3), :global(h4), :global(h5), :global(h6),
	:global(.font-heading), :global(.font-quadrant), :global(.font-exposure) {
		font-family: 'Quadrant', 'Quadrant Notepad', Georgia, serif !important;
	}
</style>
