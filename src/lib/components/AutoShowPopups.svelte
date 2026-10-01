<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { activeModalStore, overlayLockStore } from '$lib/stores.js';

	// Evaluates the auto-show rules managed in the admin panel (form_activity
	// collection, ported from the parent formActivity.json) and opens the
	// matching pop-up wizard through the promo-class DynamicFormsModal.
	// Frequency caps, visits and do-not-disturb persist in localStorage.

	let timer = null;
	let unsub = null;
	let currentPath = '/';

	function readInt(key, fallback = 0) {
		try {
			const v = parseInt(localStorage.getItem(key) || '', 10);
			return Number.isFinite(v) ? v : fallback;
		} catch { return fallback; }
	}

	function pageKey(pathname) {
		const p = String(pathname || '/').toLowerCase();
		if (p === '/' || p === '/home') return 'home';
		if (p.includes('account')) return 'account';
		return p.replace(/[^a-z0-9]+/g, '');
	}

	function isSignedIn() {
		try {
			return !!(localStorage.getItem('token') || localStorage.getItem('materio_auth_token') || localStorage.getItem('materio_token'));
		} catch { return false; }
	}

	function cachedUserId() {
		try {
			for (const key of ['user', 'materio_user']) {
				const raw = localStorage.getItem(key);
				if (!raw) continue;
				const id = JSON.parse(raw)?.id;
				if (id) return String(id);
			}
		} catch {}
		return '';
	}

	function ruleMatches(rule, popups, now, doneIds) {
		if (!rule || !rule.enabled) return null;
		const popup = (popups || []).find((p) => p && p.id === rule.formId);
		if (!popup) { console.log(`[autoshow] rule “${rule.id}” skipped: no live pop-up called “${rule.formId}”`); return null; }
		if (rule.frequency === 'once' && (doneIds.includes(rule.formId) || localStorage.getItem(`materio_form_done_${rule.formId}`))) { console.log(`[autoshow] rule “${rule.id}” skipped: already answered`); return null; }
		const cond = rule.trigger?.conditions || {};
		const last = readInt(`materio_form_last_${rule.id}`, 0);
		if (last && now - last < freqHours(rule) * 3600000) { console.log(`[autoshow] rule “${rule.id}” skipped: already shown recently`); return null; }
		if (rule.startDate && now < new Date(rule.startDate).getTime()) { console.log(`[autoshow] rule “${rule.id}” skipped: starts ${rule.startDate}`); return null; }
		if (rule.endDate && now > new Date(rule.endDate).getTime()) { console.log(`[autoshow] rule “${rule.id}” skipped: ended ${rule.endDate}`); return null; }
		const wantUser = cond.userType || 'any';
		const authed = isSignedIn();
		if (wantUser === 'authenticated' && !authed) { console.log(`[autoshow] rule “${rule.id}” skipped: needs a signed-in visitor`); return null; }
		if (wantUser === 'anonymous' && authed) { console.log(`[autoshow] rule “${rule.id}” skipped: needs a guest visitor`); return null; }
		const visits = readInt('visits', 1);
		if ((cond.minVisits || 0) > visits) { console.log(`[autoshow] rule “${rule.id}” skipped: needs ${cond.minVisits} visits (you have ${visits})`); return null; }
		const key = pageKey(currentPath);
		if (Array.isArray(cond.pages) && cond.pages.length && !cond.pages.includes(key)) { console.log(`[autoshow] rule “${rule.id}” skipped: not targeted at this page`); return null; }
		if (Array.isArray(cond.excludePages) && cond.excludePages.includes(key)) { console.log(`[autoshow] rule “${rule.id}” skipped: excluded on this page`); return null; }
		return popup;
	}

	function freqHours(rule) {		if (rule.frequency === 'once') return Infinity;
		if (rule.frequency === 'daily') return 24;
		if (rule.frequency === 'weekly') return 168;
		if (rule.frequency === 'every-30days') return 720;
		if (rule.frequency === 'custom') return Number(rule.customFrequencyHours) || 24;
		return 24;
	}

	async function evaluate() {
		let data = null;
		try {
			const uid = cachedUserId();
			const res = await fetch(`/api/v2/forms/popups${uid ? `?userId=${encodeURIComponent(uid)}` : ''}`, { headers: { Accept: 'application/json' } });
			if (!res.ok) return;
			data = await res.json();
		} catch { return; }
		const doneIds = data?.doneIds || [];
		const activity = data?.activity;
		console.log(`[autoshow] ${ (data?.popups || []).length } live pop-ups, engine ${activity?.enabled ? 'on' : 'off'}`);
		if (!activity || activity.enabled === false) return;
		const settings = activity.settings || {};
		try {
			if (settings.respectDoNotDisturb !== false && localStorage.getItem(settings.doNotDisturbKey || 'materio_dnd_forms')) return;
		} catch { return; }
		const now = Date.now();
		const sessionShown = readInt('materio_forms_session_shown', 0);
		if (sessionShown >= (settings.maxFormsPerSession || 1)) return;
		const lastAny = readInt('materio_forms_last_shown', 0);
		if (lastAny && now - lastAny < (settings.minTimeBetweenForms || 0)) return;

		const rules = [...(activity.activities || [])].sort((a, b) => (a.priority || 99) - (b.priority || 99));
		for (const rule of rules) {
			const popup = ruleMatches(rule, data.popups, now, doneIds);
			if (!popup) continue;
			const delay = Math.max(0, Number(rule.trigger?.delay) || 0);
			console.log(`[autoshow] scheduled “${popup.id}” in ${delay}ms`);
			timer = setTimeout(() => {
				try {
					if (get(activeModalStore)) { console.log('[autoshow] skipped, another modal is open'); return; }
					// The viva interviewer is a card overlay rather than an
					// activeModalStore entry, so it has to be checked separately.
					// Without this a promo could stack on top of an open
					// interview and the visitor would see two overlapping cards.
					if (get(overlayLockStore)) { console.log('[autoshow] skipped, an overlay owns the screen'); return; }
					console.log(`[autoshow] opening “${popup.id}”`);
					activeModalStore.set(popup.id);
					localStorage.setItem(`materio_form_last_${rule.id}`, String(Date.now()));
					localStorage.setItem('materio_forms_last_shown', String(Date.now()));
					sessionStorage.setItem('materio_forms_session_shown', String(readInt('materio_forms_session_shown', 0) + 1));
				} catch {}
			}, delay);
			return; // one pop-up per evaluation
		}
		console.log('[autoshow] no matching rule this visit');
	}

	onMount(() => {
		if (!browser) return;
		try {
			// One-time migration from the old key name, keeping the existing count.
			if (localStorage.getItem('visits') === null && localStorage.getItem('materio_visits') !== null) {
				localStorage.setItem('visits', String(readInt('materio_visits', 0)));
				localStorage.removeItem('materio_visits');
			}
			localStorage.setItem('visits', String(readInt('visits', 0) + 1));
		} catch {}
		unsub = page.subscribe(($page) => { currentPath = $page?.url?.pathname || '/'; });
		// Small idle delay so the app shell paints first.
		timer = setTimeout(evaluate, 1200);
	});

	onDestroy(() => {
		if (timer) clearTimeout(timer);
		if (unsub) unsub();
	});
</script>
