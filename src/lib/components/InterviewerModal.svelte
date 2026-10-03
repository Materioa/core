<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { activeModalStore, overlayLockStore } from '$lib/stores.js';
import { get } from 'svelte/store';
	import { page } from '$app/stores';
	import { getSkipLanding, isForceApp } from '$lib/utils/landingPrefs.js';
import { isExamPeriodRunning, findVivaOrPracticalExam, isUsableExamConfig } from '$lib/utils/exam-gate.js';
	import InterviewerCore from './InterviewerCore.svelte';

	const INTERVIEW_MODAL_KEYS = ['interview', 'viva', 'viva-box', 'viva-question-bank'];

	let isDismissed = $state(false);
	let prefVersion = $state(0);
	let hasVivaExam = $state(false);
	let activeVivaExam = $state(null);

	function checkIsLanding() {
		if (!browser) return false;
		if ($page.url.pathname === '/home') return false;
		if ($page.url.pathname === '/pricing' || $page.url.pathname.startsWith('/pricing/')) return true;
		if ($page.url.pathname === '/') {
			if (isForceApp()) return false;
			if (getSkipLanding()) return false;
			return true;
		}
		return false;
	}

	let isLanding = $derived.by(() => {
		const _v = prefVersion;
		return checkIsLanding();
	});

	let isAppHome = $derived(
		!isLanding && (
			$page.url.pathname === '/home' ||
			$page.url.pathname === '/'
		)
	);

	// Don't show this modal if ANY OTHER modal is currently open in activeModalStore
	let isOtherModalOpen = $derived(
		$activeModalStore !== null && !INTERVIEW_MODAL_KEYS.includes($activeModalStore)
	);

	// ...and stand down for any other overlay that owns the screen (a promo
	// card mid-animation, the PDF reader, search). This is the half that was
	// missing: the interviewer respected other modals, but nothing respected
	// the interviewer, so a promo could open on top of it.
	//
	// MUST ignore our own lock. isOpen reads this, and the effect below writes
	// overlayLockStore — so including our own value here created a cycle:
	// claim -> isOpen invalidates -> cleanup releases -> isOpen flips true ->
	// claim again, forever. That shipped as effect_update_depth_exceeded and
	// froze the whole page.
	let isOtherOverlayLocked = $derived($overlayLockStore !== null && $overlayLockStore !== 'interviewer');

	// Claim the screen while we are up. Kept out of activeModalStore because
	// that store drives URL-hash routing in +layout.svelte.
	$effect(() => {
		if (!isOpen) return;
		overlayLockStore.set('interviewer');
		return () => {
			if (get(overlayLockStore) === 'interviewer') overlayLockStore.set(null);
		};
	});

	// A ?interview= param or an interview hash is a deliberate, developer- or
	// user-authored trigger: open regardless of exam state.
	//
	// Read from $page.url, NOT window.location.hash. The hash was read raw off
	// `window`, which is not a reactive dependency, so this latched onto a
	// stale value and kept the box open after the hash was long gone.
	//
	// The match is exact rather than substring: `hash.includes('viva')` also
	// matched an unrelated hash that merely contained the word.
	let isUrlTriggered = $derived.by(() => {
		const params = $page.url.searchParams;
		if (params.get('interview') !== null && params.get('materio_interview_done') !== '1') return true;
		const hash = ($page.url.hash || '').replace(/^#/, '').trim();
		return !!hash && INTERVIEW_MODAL_KEYS.includes(hash);
	});

	// activeModalStore is NOT necessarily deliberate. AutoShowPopups sets it
	// from admin popup rules (activeModalStore.set(popup.id)), so lumping it in
	// with the URL check let an autoshow rule open the viva box with no
	// showBefore check and no practical/viva exam at all. It still bypasses
	// isDismissed, because clicking "Prepare" on a visible exam card should
	// reopen a box dismissed earlier in the session.
	let isStoreTriggered = $derived(INTERVIEW_MODAL_KEYS.includes($activeModalStore));

	const isVivaBoxForm = $derived(
		formId === 'viva-question-bank' ||
		INTERVIEW_MODAL_KEYS.includes(formId)
	);

	// Single source of truth for "may the viva box appear": a practical or
	// viva exam configured in Mongo whose exam period is inside its
	// showBeforeDaysViva window (or already running). Every path must clear
	// this — the card being hidden is not the same as the interview being off.
	let examGatePassed = $derived(isAppHome && hasVivaExam && isVivaBoxForm);

	// Shows only when no other modal is open, and only when a viva/practical
	// exam has started to show up (or explicitly opened).
	//
	// isDismissed gates the URL branch too. handleClose() clears the trigger
	// with history.replaceState, which SvelteKit's page store does not observe,
	// so $page.url can still report the old ?interview= for the rest of the
	// session — and isUrlTriggered would re-open the box with no exam gate at
	// all, every time. The store flag is the authoritative record.
	let isOpen = $derived(
		!isOtherModalOpen &&
		!isOtherOverlayLocked &&
		$page.url.pathname !== '/interviewer' &&
		!isLanding && (
			(isUrlTriggered && !isDismissed) ||
			(isStoreTriggered && examGatePassed) ||
			(!isDismissed && examGatePassed)
		)
	);

	let formId = $derived(
		$page.url.searchParams.get('form') ||
		($activeModalStore && !INTERVIEW_MODAL_KEYS.includes($activeModalStore) ? $activeModalStore : 'viva-question-bank')
	);

	let examCode = $derived(
		$page.url.searchParams.get('exam') || activeVivaExam?.code || ''
	);
	let examSubject = $derived(
		$page.url.searchParams.get('subject') || activeVivaExam?.subject || ''
	);

	function handleClose() {
		isDismissed = true;
		try {
			sessionStorage.setItem('materio_viva_box_dismissed', 'true');
		} catch {}
		if (INTERVIEW_MODAL_KEYS.includes($activeModalStore)) {
			activeModalStore.set(null);
		}
		// Clear the URL trigger, not just the hash. This used to rewrite to
		// `pathname + search`, which PRESERVED ?interview=… — so isUrlTriggered
		// stayed true, the box reopened on the next render, and the exam gate
		// was bypassed on every single load. A marker param records that the
		// deep link has already been consumed.
		if (typeof window !== 'undefined') {
			try {
				const url = new URL(window.location.href);
				let changed = false;
				if (INTERVIEW_MODAL_KEYS.some((k) => url.hash.replace(/^#/, '').trim() === k)) {
					url.hash = '';
					changed = true;
				}
				if (url.searchParams.has('interview') || url.searchParams.has('exam') || url.searchParams.has('subject')) {
					url.searchParams.delete('interview');
					url.searchParams.delete('exam');
					url.searchParams.delete('subject');
					url.searchParams.set('materio_interview_done', '1');
					changed = true;
				}
				if (changed) {
					window.history.replaceState(null, '', url.pathname + url.search + url.hash);
				}
			} catch {}
		}
	}

	async function checkExamForVivaOrPractical() {
		// NOTE: window.__materioExamHasVivaOrPractical is deliberately NOT
		// trusted as an answer here. ExamCard.svelte used to publish it, but
		// that component is no longer mounted (BlogPosts renders its own exam
		// card markup), and nothing ever reset the flag — so a single stale
		// `true` short-circuited every date check below and pinned the box open
		// regardless of exam type or show-before window. The date logic is now
		// the only thing that can turn this on.

		try {
			// Live admin config ONLY. There is deliberately no
			// /assets/data/examdata.json fallback: that committed snapshot still
			// carried a Practical/Viva period whose dates fell inside the
			// show-before window, so this box auto-opened with no Mongo config
			// saying so. The API answers { enabled:false, degraded:true } when
			// there is no live config — that means show nothing.
			hasVivaExam = false;
			activeVivaExam = null;
			let data = null;
			try {
				const res = await fetch('/api/v2/examdata', { cache: 'no-store' });
				if (res.ok) data = await res.json();
			} catch {}
			// An unreachable API or a non-authoritative answer means "unknown",
			// and unknown must render as nothing rather than as a stale guess.
			if (!isUsableExamConfig(data)) return;

			let savedSem = null;
			try {
				savedSem = localStorage.getItem('materio_selected_semester') || localStorage.getItem('selectedSemester');
			} catch {}

			// Scan every semester entry (not just saved/first): admin keeps
			// separate Mid/End/Practical-Viva periods and the viva entry is
			// rarely semesters[0]. Gate lives in exam-gate.js.
			const now = new Date();
			// Running-only gate below: the exam card teases the period a few days
			// early via showBeforeDaysViva, but the question box is for a
			// practical/viva period that is actually underway right now.
			// No saved semester means "consider them all" — restricting to the
			// saved one hid a genuinely active practical/viva period.
			const candidates = (data.semesters || []).filter(s =>
				!savedSem || String(s.semester) === String(savedSem)
			);
			for (const semester of candidates) {
				if (!semester || !Array.isArray(semester.exams) || !semester.examPeriod?.startDate) continue;
				const vivaOrPracticalExam = findVivaOrPracticalExam(semester);
				if (!vivaOrPracticalExam) continue;
				// The shared gate owns the date maths. The inline version this
				// replaced read `!endDate` as "ongoing forever", so a practical
				// period from a past semester with no endDate kept the box open
				// indefinitely — long outside the show-before window.
				if (isExamPeriodRunning(semester, now)) {
					hasVivaExam = true;
					activeVivaExam = vivaOrPracticalExam;
					break;
				}
			}
		} catch {}
	}

	onMount(() => {
		try {
			if (sessionStorage.getItem('materio_viva_box_dismissed') === 'true') {
				isDismissed = true;
			}
		} catch {}

		checkExamForVivaOrPractical();

		const onPrefChange = () => { prefVersion += 1; };
		const onExamVivaStatus = (e) => {
			// Must also clear. This only ever assigned true before, so once an
			// exam had qualified, switching it off in admin (or the window
			// closing) left hasVivaExam true for the rest of the session and the
			// box stayed open on stale state.
			const has = !!e.detail?.hasViva;
			hasVivaExam = has;
			activeVivaExam = has ? (e.detail?.exam || null) : null;
		};

		window.addEventListener('landingPrefsChanged', onPrefChange);
		window.addEventListener('materioForceAppChanged', onPrefChange);
		window.addEventListener('storage', onPrefChange);
		window.addEventListener('materioExamVivaStatus', onExamVivaStatus);

		return () => {
			window.removeEventListener('landingPrefsChanged', onPrefChange);
			window.removeEventListener('materioForceAppChanged', onPrefChange);
			window.removeEventListener('storage', onPrefChange);
			window.removeEventListener('materioExamVivaStatus', onExamVivaStatus);
		};
	});
</script>

{#if isOpen}
	<InterviewerCore
		initialMode="modal"
		{formId}
		{examCode}
		{examSubject}
		onClose={handleClose}
	/>
{/if}
