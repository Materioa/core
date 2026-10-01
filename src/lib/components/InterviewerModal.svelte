<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { activeModalStore, overlayLockStore } from '$lib/stores.js';
	import { page } from '$app/stores';
	import { getSkipLanding, isForceApp } from '$lib/utils/landingPrefs.js';
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
	let isOverlayLocked = $derived($overlayLockStore !== null);

	// Claim the screen while we are up. Kept out of activeModalStore because
	// that store drives URL-hash routing in +layout.svelte.
	$effect(() => {
		if (!isOpen) return;
		overlayLockStore.set('interviewer');
		return () => {
			if ($overlayLockStore === 'interviewer') overlayLockStore.set(null);
		};
	});

	let isExplicitlyTriggered = $derived(
		INTERVIEW_MODAL_KEYS.includes($activeModalStore) ||
		($page.url.searchParams.get('interview') !== null) ||
		(typeof window !== 'undefined' && INTERVIEW_MODAL_KEYS.some(k => window.location.hash.includes(k)))
	);

	const isVivaBoxForm = $derived(
		formId === 'viva-question-bank' ||
		INTERVIEW_MODAL_KEYS.includes(formId)
	);

	// Shows only when no other modal is open, and only when a viva/practical exam has started to show up (or explicitly opened)
	let isOpen = $derived(
		!isOtherModalOpen &&
		!isOverlayLocked &&
		$page.url.pathname !== '/interviewer' &&
		!isLanding && (
			isExplicitlyTriggered ||
			(!isDismissed && isAppHome && hasVivaExam && isVivaBoxForm)
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
		if (typeof window !== 'undefined' && window.location.hash && INTERVIEW_MODAL_KEYS.some(k => window.location.hash.includes(k))) {
			window.history.replaceState(null, '', window.location.pathname + window.location.search);
		}
	}

	async function checkExamForVivaOrPractical() {
		if (typeof window !== 'undefined' && window.__materioExamHasVivaOrPractical) {
			hasVivaExam = true;
			activeVivaExam = window.__materioActiveVivaExam || null;
			return;
		}

		try {
			// Live admin-managed examdata first (same source the exam card
			// uses), static file only as fallback — the static copy goes
			// stale and used to permanently suppress the viva auto-show.
			let data = null;
			for (const url of ['/api/v2/examdata', '/assets/data/examdata.json']) {
				try {
					const res = await fetch(url);
					if (!res.ok) continue;
					const j = await res.json();
					if (j && j.enabled !== false && Array.isArray(j.semesters)) {
						data = j;
						break;
					}
				} catch {}
			}
			if (!data) return;

			let savedSem = null;
			try {
				savedSem = localStorage.getItem('materio_selected_semester') || localStorage.getItem('selectedSemester');
			} catch {}

			// Scan every semester entry (not just saved/first): admin keeps
			// separate Mid/End/Practical-Viva periods and the viva entry is
			// rarely semesters[0]. Same threshold logic as the exam card.
			const now = new Date();
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const showBefore = data.showBeforeDaysViva || 3;
			const candidates = (data.semesters || []).filter(s =>
				savedSem == null || String(s.semester) === String(savedSem)
			);
			for (const semester of candidates) {
				if (!semester || !Array.isArray(semester.exams) || !semester.examPeriod?.startDate) continue;
				const vivaOrPracticalExam = semester.exams.find(e => e.type === 'viva' || e.type === 'practical');
				if (!vivaOrPracticalExam) continue;
				const startDate = new Date(semester.examPeriod.startDate);
				const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
				const endDate = semester.examPeriod.endDate ? new Date(semester.examPeriod.endDate) : null;
				const daysUntilExam = Math.ceil((startDateOnly - today) / (1000 * 60 * 60 * 24));

				// Active within showBeforeDaysViva before start OR ongoing once the period starts
				const isVivaCardActive = (daysUntilExam <= showBefore && daysUntilExam >= 0) ||
					(today >= startDateOnly && (!endDate || now <= endDate));

				if (isVivaCardActive) {
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
			if (e.detail?.hasViva) {
				hasVivaExam = true;
				activeVivaExam = e.detail?.exam || null;
			}
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
