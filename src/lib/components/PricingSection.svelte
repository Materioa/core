<script>
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { LANDING_PLANS, startLandingCheckout, readToken, accountsBase } from "$lib/utils/billing.js";
	import { getSignupUrl } from "$lib/utils/app-urls.js";
	import { setForceApp } from "$lib/utils/landingPrefs.js";

	let busyPlan = $state(null);
	let checkoutError = $state("");

	// Subscription awareness: 'unknown' (logged out / unreachable),
	// 'free', 'plus', 'pro', 'super' (admin).
	let currentPlan = $state("unknown");
	// Exact purchased tier id from billing status ('plus' | 'pro' | 'weekly' | null).
	let currentPlanId = $state(null);
	// Pro card billing toggle.
	let proBilling = $state("monthly");

	let isSuper = $derived(currentPlan === "super");
	let loggedIn = $derived(currentPlan !== "unknown");
	let monthlyProActive = $derived(currentPlanId === "pro");
	let weeklyActive = $derived(currentPlanId === "weekly");

	function ctaState(planId) {
		if (isSuper) return { label: "Included in Super", disabled: true };
		if (planId === "weekly") {
			if (weeklyActive) return { label: "Current plan", disabled: true };
			if (monthlyProActive) return { label: "On Monthly Pro", disabled: true };
			return { label: LANDING_PLANS.weekly.cta, disabled: false };
		}
		if (currentPlan === planId) return { label: "Current plan", disabled: true };
		return { label: LANDING_PLANS[planId].cta, disabled: false };
	}

	function manageSubscription() {
		window.location.href = `${accountsBase().replace(/\/$/, "")}/upgrade`;
	}

	function openApp() {
		setForceApp();
		goto("/", { replaceState: true });
	}

	function planLabel() {
		if (currentPlan === "plus") return "Materio Plus";
		if (currentPlan === "pro") return "Materio Pro";
		return null;
	}

	onMount(async () => {
		const token = readToken();
		if (!token) return;
		try {
			const res = await fetch(
				`${accountsBase().replace(/\/$/, "")}/api/v2/billing/status`,
				{ headers: { Authorization: `Bearer ${token}` } }
			);
			if (!res.ok) return;
			const data = await res.json();
			if (data?.plan === "super" || data?.hasAdminPrivileges) currentPlan = "super";
			else if (data?.plan === "pro") currentPlan = "pro";
			else if (data?.plan === "plus") currentPlan = "plus";
			else currentPlan = "free";
			currentPlanId = data?.subscription?.plan ?? null;
			if (currentPlanId === "weekly") proBilling = "weekly";
		} catch {
			// Offline / unreachable — stay in logged-out mode.
		}
	});

	const freeFeatures = [
		"Unlimited library browsing",
		"Standard Thinklet answers",
		"Community Insightroom posts",
		"Personal notebooks on this device"
	];

	async function choose(planId) {
		busyPlan = planId;
		checkoutError = "";
		const err = await startLandingCheckout(planId);
		if (err) checkoutError = err;
		busyPlan = null;
	}

	function signup() {
		window.location.href = getSignupUrl();
	}
</script>

<!-- Pricing Section — same editorial language as the rest of the landing page -->
<section
	id="pricing"
	class="w-full max-w-5xl px-5 sm:px-6 md:px-0 mb-32 flex flex-col items-center text-center space-y-4 scroll-mt-24"
>
	<!-- Heading -->
	<div class="flex flex-col items-center space-y-3.5 max-w-2xl">
		<span
			class="inline-flex items-center space-x-1 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors uppercase tracking-wider"
		>
			Pricing
		</span>
		<h2
			class="font-heading text-3xl md:text-4xl font-semibold tracking-tight text-cream-dark leading-[1.15]"
		>
			Simple pricing for<br class="hidden sm:inline" /> every kind of learner.
		</h2>
		<p
			class="font-sans text-[17px] md:text-lg font-normal leading-relaxed text-neutral-500 max-w-xl"
		>
			Start free. Upgrade for more AI, more notebooks and more of Materio —
			billed monthly, cancel anytime from Materio ID.
		</p>
		{#if isSuper}
			<span
				class="inline-flex items-center text-xs font-semibold uppercase tracking-wider text-neutral-500 bg-white border border-cream-300 rounded-full px-3 py-1.5"
			>
				You have Super access — everything's already included
			</span>
		{:else if planLabel()}
			<button
				onclick={manageSubscription}
				class="inline-flex items-center text-xs font-semibold uppercase tracking-wider text-cream-dark bg-white border border-cream-300 rounded-full px-3 py-1.5 hover:opacity-75 transition-opacity focus:outline-none"
			>
				You're on {planLabel()} — manage subscription
			</button>
		{/if}
	</div>

	{#if checkoutError}
		<div
			class="w-full max-w-2xl bg-red-50 border border-red-200 rounded-2xl px-5 py-3.5 text-sm text-red-700 font-medium"
		>
			{checkoutError}
		</div>
	{/if}

	<!-- Cards -->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 w-full mt-8 text-left">
		<!-- Free -->
		<div
			class="flex flex-col bg-cream-50 border border-cream-300 rounded-3xl p-7 shadow-[0_8px_30px_rgba(0,0,0,0.015)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.05)] transition-shadow"
		>
			<span class="text-[13px] font-semibold text-neutral-400 tracking-widest uppercase">Free</span>
			<div class="flex items-baseline gap-1.5 mt-3">
				<span class="font-sans text-4xl font-semibold tracking-tight text-cream-dark">₹0</span>
				<span class="text-sm text-neutral-400 font-medium">/ forever</span>
			</div>
			<p class="font-sans text-[15px] leading-relaxed text-neutral-500 mt-3">
				Everything you need to start studying with Materio.
			</p>
			<ul class="flex flex-col gap-2.5 mt-6 mb-8">
				{#each freeFeatures as f}
					<li class="flex items-start gap-2.5 text-[14px] leading-relaxed text-neutral-600">
						<svg class="w-4 h-4 mt-0.5 shrink-0 text-neutral-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
						<span>{f}</span>
					</li>
				{/each}
			</ul>
			{#if loggedIn && (currentPlan === "plus" || currentPlan === "pro")}
				<button
					onclick={manageSubscription}
					class="btn-light-hero mt-auto w-full py-3.5 text-center text-[15px] font-semibold tracking-wide text-cream-dark rounded-2xl transition-all active:scale-[0.98] focus:outline-none"
				>
					Manage subscription
				</button>
			{:else if loggedIn}
				<button
					onclick={openApp}
					class="btn-light-hero mt-auto w-full py-3.5 text-center text-[15px] font-semibold tracking-wide text-cream-dark rounded-2xl transition-all active:scale-[0.98] focus:outline-none"
				>
					Open Materio
				</button>
			{:else}
				<button
					onclick={signup}
					class="btn-light-hero mt-auto w-full py-3.5 text-center text-[15px] font-semibold tracking-wide text-cream-dark rounded-2xl transition-all active:scale-[0.98] focus:outline-none"
				>
					Get Started
				</button>
			{/if}
		</div>

		<!-- Plus (popular) -->
		<div
			class="relative flex flex-col bg-[#171412] text-cream-50 border border-[#2a2521] rounded-3xl p-7 shadow-[0_20px_60px_rgba(23,20,18,0.25)] hover:shadow-[0_24px_70px_rgba(235,94,40,0.22)] transition-shadow overflow-hidden"
		>
			<div
				class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#EB5E28] via-[#ff8a3d] to-[#EB5E28]"
			></div>
			<div class="flex items-center justify-between">
				<span class="text-[13px] font-semibold text-white/50 tracking-widest uppercase">Plus</span>
				<span
					class="text-[11px] font-bold uppercase tracking-wider text-white bg-[#EB5E28] rounded-full px-3 py-1"
				>
					Most Popular
				</span>
			</div>
			<div class="flex items-baseline gap-1.5 mt-3">
				<span class="font-sans text-4xl font-semibold tracking-tight text-white">₹{LANDING_PLANS.plus.priceInr}</span>
				<span class="text-sm text-white/50 font-medium">/ month</span>
			</div>
			<p class="font-sans text-[15px] leading-relaxed text-white/60 mt-3">
				{LANDING_PLANS.plus.blurb}
			</p>
			<ul class="flex flex-col gap-2.5 mt-6 mb-8">
				{#each LANDING_PLANS.plus.features as f}
					<li class="flex items-start gap-2.5 text-[14px] leading-relaxed text-white/85">
						<svg class="w-4 h-4 mt-0.5 shrink-0 text-[#EB5E28]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
						<span>{f}</span>
					</li>
				{/each}
			</ul>
			<button
				onclick={() => choose("plus")}
				disabled={busyPlan !== null || ctaState("plus").disabled}
				class="mt-auto w-full py-3.5 text-center text-[15px] font-semibold tracking-wide text-white rounded-2xl transition-all active:scale-[0.98] focus:outline-none disabled:opacity-60 bg-gradient-to-t from-[#EB5E28] via-[#f26a2e] to-[#ff8a3d] border border-white/20 shadow-lg hover:brightness-110"
			>
				{busyPlan === "plus" ? "Redirecting to secure checkout…" : ctaState("plus").label}
			</button>
		</div>

		<!-- Pro -->
		<div
			class="flex flex-col bg-cream-50 border-[2px] border-cream-dark/80 rounded-3xl p-7 shadow-[0_8px_30px_rgba(0,0,0,0.015)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)] transition-shadow"
		>
			<span class="text-[13px] font-semibold text-neutral-400 tracking-widest uppercase">Pro</span>
			{#if !monthlyProActive}
				<div class="flex gap-1 p-1 mt-4 bg-cream-100/60 border border-cream-300 rounded-xl">
					<button
						onclick={() => (proBilling = "monthly")}
						class="flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all {proBilling === 'monthly' ? 'bg-white border border-cream-300 text-cream-dark' : 'text-neutral-500 hover:text-cream-dark'} focus:outline-none"
					>Monthly ₹349</button>
					<button
						onclick={() => (proBilling = "weekly")}
						class="flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all {proBilling === 'weekly' ? 'bg-white border border-cream-300 text-cream-dark' : 'text-neutral-500 hover:text-cream-dark'} focus:outline-none"
					>Weekly ₹79</button>
				</div>
			{/if}
			<div class="flex items-baseline gap-1.5 mt-3">
				<span class="font-sans text-4xl font-semibold tracking-tight text-cream-dark">₹{proBilling === "weekly" ? LANDING_PLANS.weekly.priceInr : LANDING_PLANS.pro.priceInr}</span>
				<span class="text-sm text-neutral-400 font-medium">/ {proBilling === "weekly" ? "week" : "month"}</span>
			</div>
			<p class="font-sans text-[15px] leading-relaxed text-neutral-500 mt-3">
				{proBilling === "weekly" ? LANDING_PLANS.weekly.blurb : LANDING_PLANS.pro.blurb}
			</p>
			<ul class="flex flex-col gap-2.5 mt-6 mb-8">
				{#each LANDING_PLANS.pro.features as f}
					<li class="flex items-start gap-2.5 text-[14px] leading-relaxed text-neutral-600">
						<svg class="w-4 h-4 mt-0.5 shrink-0 text-cream-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
						<span>{f}</span>
					</li>
				{/each}
			</ul>
			{#if proBilling === "weekly"}
				<button
					onclick={() => choose("weekly")}
					disabled={busyPlan !== null || ctaState("weekly").disabled}
					class="btn-dark-hero mt-auto w-full py-3.5 text-center text-[15px] font-semibold tracking-wide text-white rounded-2xl transition-all active:scale-[0.98] focus:outline-none disabled:opacity-60"
				>
					{busyPlan === "weekly" ? "Redirecting to secure checkout…" : ctaState("weekly").label}
				</button>
			{:else}
				<button
					onclick={() => choose("pro")}
					disabled={busyPlan !== null || ctaState("pro").disabled}
					class="btn-dark-hero mt-auto w-full py-3.5 text-center text-[15px] font-semibold tracking-wide text-white rounded-2xl transition-all active:scale-[0.98] focus:outline-none disabled:opacity-60"
				>
					{busyPlan === "pro" ? "Redirecting to secure checkout…" : ctaState("pro").label}
				</button>
			{/if}
		</div>
	</div>

	<!-- Footnote -->
	<div class="flex flex-col items-center gap-2 mt-8 max-w-2xl">
		<p class="font-sans text-sm text-neutral-400 leading-relaxed">
			Plus and Pro bill monthly · Weekly Pass bills weekly · Cancel anytime.
			Secure Razorpay payments — UPI, cards, netbanking.
			Test mode? Use card
			<span class="font-mono font-semibold text-neutral-500">4718 6091 0820 4366</span>.
		</p>
		<p class="font-sans text-sm text-neutral-400 leading-relaxed">
			Purchases sync instantly with your Materio ID — manage billing, renewal
			and cancellation anytime under
			<span class="font-semibold text-neutral-500">Payments and Subscription</span>.
		</p>
	</div>
</section>

<style>
	h2,
	:global(.font-heading), :global(.font-quadrant) {
		font-family: 'Quadrant', 'Quadrant Notepad', Georgia, serif !important;
	}
</style>
