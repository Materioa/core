<script>
	import { onMount, tick } from 'svelte';
	import { page } from '$app/stores';
	import { actualThemeStore } from '$lib/stores.js';
	import { getUserData, isUserLoggedIn } from '$lib/utils/profile-image.js';
	import { trackModalView, trackModalEvent, runMagicJs } from '$lib/utils/promoMagic.js';
	import Bud from './Bud.svelte';
	import BudDoesThings from './BudDoesThings.svelte';

	let magicCleanup = null;

	function fireInterviewMagic(stage) {
		if (!form) return;
		try {
			const id = form.id || formId;
			const title = form.title || formId;
			const trackingId = form.trackingId || form.gaId || form.gtmId || '';
			const trackViews = form.trackViews ?? true;
			const root = chatContainer || (typeof document !== 'undefined' ? document.body : null);
			const code = form.magicJs || form.magic?.js || '';
			const enabled = form.magicEnabled ?? form.magic?.enabled ?? !!String(code).trim();
			if (stage === 'load') {
				trackModalView({ id, title, kind: 'interview', trackingId, trackViews });
				if (!code || !enabled) return;
				const snapshot = form;
				tick().then(() => {
					if (!snapshot) return; // navigated away before first paint
					try { if (typeof magicCleanup === 'function') magicCleanup(); } catch {}
					magicCleanup = runMagicJs(code, {
						root: chatContainer || root, data: snapshot, id, title, kind: 'interview', stage,
						trackingId, formData: values,
						close: () => handleClose()
					}, { enabled: true });
				});
			} else if (stage === 'submit') {
				if (trackingId) trackModalEvent({ id, title, kind: 'interview', trackingId, action: 'interview_complete' });
				if (!code || !enabled) return;
				runMagicJs(code, {
					root, data: form, id, title, kind: 'interview', stage,
					trackingId, formData: values,
					close: () => handleClose()
				}, { enabled: true });
			} else if (stage === 'close') {
				if (trackingId) trackModalEvent({ id, title, kind: 'interview', trackingId, action: 'interview_close' });
				try { if (typeof magicCleanup === 'function') magicCleanup(); } catch {}
				magicCleanup = null;
			}
		} catch (err) {
			console.warn('[magic] interview hook failed:', err?.message || err);
		}
	}

	let {
		initialMode = 'fullscreen', // 'modal' | 'fullscreen'
		formId = 'viva-question-bank',
		examCode = '',
		examSubject = '',
		onClose = null
	} = $props();

	let form = $state(null);
	let sessionId = $state(crypto.randomUUID());
	let answer = $state('');
	let isSending = $state(false);
	let values = $state({});
	let skipped = $state([]);
	let messages = $state([]);
	let isComplete = $state(false);
	let examTag = $state('');
	let loadError = $state('');
	let showCapturedDrawer = $state(false);
	let chatContainer = $state(null);
	let textareaEl = $state(null);
	let budStreamRef = $state(null);
	let user = $state(null);
	let isLoggedIn = $state(false);

	let isMorphed = $state(false);
	let isMorphing = $state(false);
	let currentMode = $derived(isMorphed ? 'fullscreen' : initialMode);

	let activeTab = $state('contribute'); // 'contribute' | 'responses'
	let responsesData = $state(null);
	let isLoadingResponses = $state(false);
	let responsesError = $state('');
	let selectedCategory = $state('All');
	let selectedSemester = $state('All');
	let searchQuery = $state('');

	async function loadResponses(force = false) {
		if (responsesData && !force) return;
		isLoadingResponses = true;
		responsesError = '';
		try {
			const res = await fetch(`/api/interviewer?form=${encodeURIComponent(formId)}&action=responses`);
			if (!res.ok) throw new Error('Could not load responses');
			responsesData = await res.json();
		} catch (err) {
			responsesError = err.message || 'Failed to load community responses';
		} finally {
			isLoadingResponses = false;
		}
	}

	let filteredResponses = $derived.by(() => {
		if (!responsesData?.items) return [];
		let list = responsesData.items;
		if (selectedCategory !== 'All') {
			list = list.filter((r) => r.subject?.toLowerCase() === selectedCategory.toLowerCase());
		}
		if (selectedSemester !== 'All') {
			list = list.filter((r) => r.semester?.toLowerCase() === selectedSemester.toLowerCase());
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			list = list.filter((r) =>
				r.subject?.toLowerCase().includes(q) ||
				r.semester?.toLowerCase().includes(q) ||
				r.enhancedQuestions?.some((eq) => eq.toLowerCase().includes(q))
			);
		}
		return list;
	});

	let isLightTheme = $derived($actualThemeStore === 'light' || $actualThemeStore === 'coffee');

	let themeClass = $derived(
		$actualThemeStore === 'light' ? 'theme-light' :
		$actualThemeStore === 'coffee' ? 'theme-coffee' :
		$actualThemeStore === 'coffee-dark' ? 'theme-coffee-dark' :
		'theme-dark'
	);

	function authHeaders() {
		try {
			const token = localStorage.getItem('token') || localStorage.getItem('materio_auth_token') || localStorage.getItem('materio_token');
			return token ? { Authorization: `Bearer ${token}` } : {};
		} catch {
			return {};
		}
	}

	let allFields = $derived(form?.fields || []);
	let requiredFields = $derived(allFields.filter((f) => f.required));
	function hasValue(v) {
		return String(v ?? '').trim().length > 0;
	}
	function mergeExtracted(obj) {
		if (!obj || typeof obj !== 'object') return;
		const clean = Object.fromEntries(
			Object.entries(obj).filter(([, v]) => hasValue(v))
		);
		if (Object.keys(clean).length > 0) values = { ...values, ...clean };
	}
	let requiredDone = $derived(requiredFields.filter((f) => hasValue(values[f.name])).length);
	let nextField = $derived(
		requiredFields.find((f) => !values[f.name] && !skipped.includes(f.name)) ||
		allFields.find((f) => !values[f.name] && !skipped.includes(f.name)) ||
		null
	);
	let capturedEntries = $derived(Object.entries(values).filter(([, v]) => hasValue(v)));
	let isHeroState = $derived(messages.length <= 1 && !isComplete && currentMode === 'fullscreen');

	// Dynamic, friendly greeting derived from form configs in database
	let formGreeting = $derived.by(() => {
		if (!form) return { title: 'Materio Interviewer', intro: '', prompt: '' };
		const title = form.title || 'Materio Interviewer';
		const desc = form.description || '';
		const sys = form.interview?.systemPrompt || '';
		const prompt = form.interview?.openingQuestion || 'What would you like to share today?';

		let intro = desc;
		if (!intro && sys) {
			intro = sys.replace(/^You\s+(collect|triage|recruit|gather)\s+/i, "I'm here to help collect ");
		}
		if (!intro) {
			intro = "Tell me in your own words — I'll organize and save your answers as we talk.";
		}

		return { title, intro, prompt };
	});

	// Context-aware, appropriate placeholder derived dynamically from form and active field
	let appropriatePlaceholder = $derived.by(() => {
		if (nextField?.placeholder) return nextField.placeholder;
		if (nextField?.label) {
			const raw = nextField.label.trim();
			if (/^(what|which|where|when|who|how|why)\b/i.test(raw) || raw.endsWith('?')) {
				return raw.endsWith('?') ? raw : `${raw}...`;
			}
			return `Your ${raw.toLowerCase()}...`;
		}
		const fId = (formId || form?.id || '').toLowerCase();
		if (fId.includes('viva')) return 'Share a viva question, topic, or concept...';
		if (fId.includes('bug')) return 'Describe what happened or steps to reproduce...';
		if (fId.includes('feedback') || fId.includes('review')) return 'Write your thoughts or feedback...';
		if (form?.fields?.[0]?.placeholder) return form.fields[0].placeholder;
		return 'Type your response here...';
	});

	async function scrollToBottom() {
		await tick();
		if (chatContainer) {
			chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
		}
	}

	function autoResizeTextarea() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 160) + 'px';
	}

	onMount(async () => {
		try {
			isLoggedIn = isUserLoggedIn();
			user = getUserData();
		} catch {}

		if (examCode || examSubject) {
			examTag = [examSubject, examCode].filter(Boolean).join(' · ');
		}

		loadResponses();

		try {
			const response = await fetch(`/api/interviewer?form=${encodeURIComponent(formId)}`);
			if (!response.ok) throw new Error('Could not load the interview form');
			const data = await response.json();
			form = data.form;

			const opening = form?.interview?.openingQuestion || form?.description || 'What would you like to share today?';
			messages = [{ role: 'assistant', content: opening }];
			fireInterviewMagic('load');
		} catch (err) {
			loadError = err.message || 'Failed to load questions';
		}
	});

	async function submitAnswer() {
		const text = answer.trim();
		if (!text || isSending || isComplete) return;

		// Morph from modal into fullscreen overlay on first send
		if (currentMode === 'modal') {
			isMorphing = true;
			setTimeout(() => {
				isMorphed = true;
				isMorphing = false;

				// Push interviewer URL so the address bar reflects the interview page
				if (typeof window !== 'undefined') {
					const params = new URLSearchParams();
					params.set('form', formId || 'viva-question-bank');
					if (examCode) params.set('exam', examCode);
					if (examSubject) params.set('subject', examSubject);
					const qs = params.toString();
					const url = '/interviewer?' + qs;
					window.history.pushState({ interviewer: true }, '', url);
				}
			}, 240);
		}

		answer = '';
		if (textareaEl) {
			textareaEl.style.height = 'auto';
		}
		messages = [...messages, { role: 'user', content: text }];
		isSending = true;
		await scrollToBottom();

		try {
			const response = await fetch('/api/interviewer', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...authHeaders() },
				body: JSON.stringify({
					sessionId,
					form: { id: form.id },
					text,
					examContext: { code: examCode, subject: examSubject }
				})
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Server error');

			if (data.extracted) {
				mergeExtracted(data.extracted);
			}

			const replyMessage = data.message || data.reply || 'Thank you.';
			messages = [...messages, { role: 'assistant', content: replyMessage }];

			if (data.complete) {
				isComplete = true;
				fireInterviewMagic('submit');
				await fetch('/api/interviewer', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', ...authHeaders() },
					body: JSON.stringify({
						sessionId,
						action: 'complete',
						examContext: { code: examCode, subject: examSubject }
					})
				}).catch(() => {});
			}
		} catch (error) {
			messages = [
				...messages,
				{ role: 'assistant', content: error.message || 'That could not be saved right now. Please try again.' }
			];
		} finally {
			isSending = false;
			await scrollToBottom();
		}
	}

	async function skip() {
		if (isSending || isComplete) return;
		const target = nextField?.name;
		if (target) skipped = [...skipped, target];

		messages = [
			...messages,
			{ role: 'assistant', content: target ? `Skipped "${nextField.label}".` : 'Question skipped.' }
		];
		isSending = true;
		await scrollToBottom();

		try {
			const response = await fetch('/api/interviewer', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', ...authHeaders() },
				body: JSON.stringify({ sessionId, action: 'skip', field: target })
			});
			const data = await response.json();
		if (data.skipped) skipped = data.skipped;
		if (data.extracted) mergeExtracted(data.extracted);
		if (data.message || data.reply) {
				messages = [...messages, { role: 'assistant', content: data.message || data.reply }];
			}
			if (data.complete) isComplete = true;
		} catch {} finally {
			isSending = false;
			await scrollToBottom();
		}
	}

	function restart() {
		sessionId = crypto.randomUUID();
		values = {};
		skipped = [];
		isComplete = false;
		answer = '';
		showCapturedDrawer = false;
		const opening = form?.interview?.openingQuestion || form?.description || 'What would you like to share today?';
		messages = [{ role: 'assistant', content: opening }];
	}

	function handleKeydown(event) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submitAnswer();
		}
	}

	let touchStartY = $state(0);
	function onTouchStart(e) {
		if (e.touches && e.touches[0]) {
			touchStartY = e.touches[0].clientY;
		}
	}
	function onTouchEnd(e) {
		if (e.changedTouches && e.changedTouches[0]) {
			const deltaY = e.changedTouches[0].clientY - touchStartY;
			if (deltaY > 70) {
				handleClose();
			}
		}
	}

	function handleClose() {
		fireInterviewMagic('close');
		if (onClose) onClose();
		else if (typeof window !== 'undefined') {
			if (window.history.length > 1) window.history.back();
			else window.location.href = '/home';
		}
	}
</script>

<div class="interviewer-root {themeClass}" class:as-modal={currentMode === 'modal'} class:as-fullscreen={currentMode === 'fullscreen'}>
	{#if currentMode === 'modal'}
		<!-- Modal Backdrop and Card (Bottomsheet on mobile) -->
		<div class="modal-backdrop" onclick={handleClose}>
			<div
				class="modal-card"
				class:morphing-out={isMorphing}
				class:responses-tab-active={activeTab === 'responses'}
				onclick={(e) => e.stopPropagation()}
				ontouchstart={onTouchStart}
				ontouchend={onTouchEnd}
			>
				<!-- Mobile drag handle -->
				<div class="modal-mobile-handle-wrap" onclick={handleClose}>
					<div class="modal-mobile-handle"></div>
				</div>

				<!-- Modal Header with Tabs (Admin Style, No Logo) & Close Button -->
				<div class="modal-header">
					<nav class="header-tab-nav" aria-label="Interviewer modes">
						<button
							type="button"
							class="tab-pill-btn"
							class:active={activeTab === 'contribute'}
							onclick={() => (activeTab = 'contribute')}
						>
							Contribute
						</button>
						<button
							type="button"
							class="tab-pill-btn"
							class:active={activeTab === 'responses'}
							onclick={() => {
								activeTab = 'responses';
								loadResponses();
							}}
						>
							Responses
							{#if responsesData?.total}
								<span class="tab-badge">{responsesData.total}</span>
							{/if}
						</button>
					</nav>
					<button type="button" class="modal-close-btn" onclick={handleClose} aria-label="Close modal">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					</button>
				</div>

				{#if activeTab === 'contribute'}
					<!-- Modal Body (Contribute) -->
					<div class="modal-body">
						<!-- Interactive Living Bud Face -->
						<div class="modal-bud-wrapper">
							<Bud size={52} />
						</div>

						<div class="modal-text-content">
							<h2 class="modal-greeting-title">Hello!</h2>
							<p class="modal-intro">{formGreeting.intro}</p>
							<p class="modal-prompt">{formGreeting.prompt}</p>
						</div>
					</div>

					<!-- Modal Composer (Squircle Prompt Box) -->
					<form class="modal-composer" onsubmit={(e) => { e.preventDefault(); submitAnswer(); }}>
						<input
							type="text"
							bind:value={answer}
							placeholder={appropriatePlaceholder}
							aria-label="Your response"
							onkeydown={handleKeydown}
							autofocus
						/>
						<button type="submit" class="modal-send-btn" disabled={!answer.trim()} aria-label="Send">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
								<line x1="12" y1="19" x2="12" y2="5"></line>
								<polyline points="5 12 12 5 19 12"></polyline>
							</svg>
						</button>
					</form>
				{:else}
					<!-- Minimal Responses View (NO cards inside cards) -->
					<div class="modal-responses-view">
						<!-- Category & Semester Filters -->
						<div class="responses-filters-header">
							<div class="pills-scroll-row">
								{#each (responsesData?.categories || ['All']) as cat}
									<button
										type="button"
										class="filter-pill-chip"
										class:active={selectedCategory === cat}
										onclick={() => (selectedCategory = cat)}
									>
										{cat}
									</button>
								{/each}
							</div>

							{#if (responsesData?.semesters || []).length > 2}
								<div class="pills-scroll-row sem-scroll-row">
									{#each responsesData.semesters as sem}
										<button
											type="button"
											class="filter-pill-chip sem-chip"
											class:active={selectedSemester === sem}
											onclick={() => (selectedSemester = sem)}
										>
											{sem}
										</button>
									{/each}
								</div>
							{/if}
						</div>

						<!-- Flat list of community questions -->
						<div class="modal-responses-list">
							{#if isLoadingResponses}
								<div class="responses-loading-state">
									<span class="dot"></span>
									<span>Loading community questions…</span>
								</div>
							{:else if filteredResponses.length === 0}
								<div class="responses-empty-state">
									<Bud size={40} />
									<p class="empty-text">No questions found for this subject yet.</p>
									<button type="button" class="empty-action-btn" onclick={() => (activeTab = 'contribute')}>
										Be the first to share one →
									</button>
								</div>
							{:else}
								<div class="responses-flat-feed">
									{#each filteredResponses as item}
										<div class="response-flat-row">
											<div class="row-meta-strip">
												<span class="meta-tag sem-tag">{item.semester}</span>
												<span class="meta-tag subj-tag">{item.subject}</span>
												{#if item.difficulty && item.difficulty !== 'General'}
													<span class="meta-tag diff-tag">{item.difficulty}</span>
												{/if}
											</div>

											<div class="questions-flow">
												{#each item.enhancedQuestions as q, idx}
													<div class="q-entry">
														<span class="q-marker">Q{idx + 1}</span>
														<span class="q-body">{q}</span>
													</div>
												{/each}
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>

						<!-- Quick switch button at bottom -->
						<div class="responses-bottom-action">
							<button type="button" class="contribute-quick-link" onclick={() => (activeTab = 'contribute')}>
								+ Share your own questions
							</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<!-- Fullscreen Overlay View -->
		<div class="overlay-fullscreen">
			<!-- Topbar with Official Materio SVG Logo & Tabs -->
		<div class="topbar" role="banner">
			<div class="topbar-left">
				<button type="button" class="iv-hamburger" onclick={() => showCapturedDrawer = !showCapturedDrawer} title="Captured data" aria-label="Open captured data">
					<span></span><span></span><span></span>
				</button>
				<button type="button" class="logo-btn" onclick={handleClose} title="Back to Materio">
						<img
							src={isLightTheme ? '/assets/img/materio_new_bk.svg' : '/assets/img/materio_new_wh.svg'}
							alt="Materio"
							class="materio-brand-logo-topbar"
						/>
					</button>

					<span class="topbar-divider">/</span>
					<span class="topbar-title">{formGreeting.title}</span>

					{#if examTag}
						<span class="exam-tag">{examTag}</span>
					{/if}

					<nav class="header-tab-nav" aria-label="Interviewer modes">
						<button
							type="button"
							class="tab-pill-btn"
							class:active={activeTab === 'contribute'}
							onclick={() => (activeTab = 'contribute')}
						>
							Interview
						</button>
						<button
							type="button"
							class="tab-pill-btn"
							class:active={activeTab === 'responses'}
							onclick={() => {
								activeTab = 'responses';
								loadResponses();
							}}
						>
							Responses
							{#if responsesData?.total}
								<span class="tab-badge">{responsesData.total}</span>
							{/if}
						</button>
					</nav>
				</div>

				<div class="topbar-right">
					{#if requiredFields.length > 0 && !isComplete}
						<button
							type="button"
							class="captured-indicator-btn"
							onclick={() => showCapturedDrawer = !showCapturedDrawer}
							title="View captured fields"
						>
							<span class="dot-indicator" class:has-data={requiredDone > 0}></span>
							<span>{requiredDone} of {requiredFields.length}</span>
						</button>
					{/if}

					<button type="button" class="restart-btn" onclick={restart} title="Restart interview">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
							<path d="M3 3v5h5"></path>
						</svg>
					</button>

					<!-- Real user profile image or anonymous avatar -->
					<div class="user-avatar-wrap" title={isLoggedIn ? (user?.displayName || user?.username || 'User Profile') : 'Anonymous'}>
						{#if isLoggedIn && user?.profilePicture}
							<img src={user.profilePicture} alt="User Avatar" class="user-avatar-img" />
						{:else if isLoggedIn && (user?.displayName || user?.username)}
							<div class="user-avatar-initial">
								{(user.displayName || user.username).charAt(0).toUpperCase()}
							</div>
						{:else}
							<div class="user-avatar-anon">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
									<circle cx="12" cy="7" r="4"></circle>
								</svg>
							</div>
						{/if}
					</div>

				<button type="button" class="close-overlay-btn" onclick={handleClose} title="Close overlay">✕</button>
			</div>
		</div>

		<!-- Mobile back action (left chevron + Back) below the topbar -->
		<div class="mobile-back-row">
			<button type="button" class="mobile-back-btn" onclick={handleClose} aria-label="Go back">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="15 18 9 12 15 6"></polyline>
				</svg>
				<span>Back</span>
			</button>
		</div>

			<!-- Live Structured Extraction Drawer -->
			{#if showCapturedDrawer}
				<div class="drawer-backdrop" onclick={() => showCapturedDrawer = false}>
					<div class="drawer-card" onclick={(e) => e.stopPropagation()}>
						<div class="drawer-header">
							<div>
								<h3>Captured Data</h3>
								<p>Real-time form values collected so far</p>
							</div>
							<button type="button" class="drawer-close" onclick={() => showCapturedDrawer = false}>✕</button>
						</div>

						<div class="drawer-fields">
							{#each (form?.fields || []) as field}
								<div class="drawer-field-row" class:filled={values[field.name]}>
									<div class="field-meta">
										<span class="field-label">{field.label}</span>
										{#if field.required}<span class="req-tag">Required</span>{/if}
									</div>
									<div class="field-val">
										{#if values[field.name]}
											<span class="val-text">{values[field.name]}</span>
										{:else}
											<span class="val-empty">Awaiting response...</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
			{/if}

			<!-- Canvas Body -->
			{#if activeTab === 'responses'}
				<!-- Fullscreen Minimal Responses View -->
				<main class="fullscreen-responses-view">
					<div class="responses-inner-container">
						<div class="responses-hero-header">
							<h1 class="responses-headline">Community Viva Questions</h1>
							<p class="responses-subhead">
								Questions contributed by peers and organized by subject. Each question is split and formatted for study.
							</p>

							<!-- Search Bar -->
							<div class="responses-search-wrap">
								<svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<circle cx="11" cy="11" r="8"></circle>
									<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
								</svg>
								<input
									type="search"
									bind:value={searchQuery}
									placeholder="Search questions, topics, or subjects..."
									aria-label="Search questions"
								/>
								{#if searchQuery}
									<button type="button" class="clear-search-btn" onclick={() => (searchQuery = '')}>✕</button>
								{/if}
							</div>

							<!-- Category & Semester Filter Pills -->
							<div class="responses-filter-bar">
								<div class="pills-scroll-row">
									{#each (responsesData?.categories || ['All']) as cat}
										<button
											type="button"
											class="filter-pill-chip"
											class:active={selectedCategory === cat}
											onclick={() => (selectedCategory = cat)}
										>
											{cat}
										</button>
									{/each}
								</div>

								{#if (responsesData?.semesters || []).length > 2}
									<div class="pills-scroll-row sem-scroll-row">
										{#each responsesData.semesters as sem}
											<button
												type="button"
												class="filter-pill-chip sem-chip"
												class:active={selectedSemester === sem}
												onclick={() => (selectedSemester = sem)}
											>
												{sem}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						</div>

						<!-- Flat list of community questions (NO nested cards) -->
						<div class="fullscreen-responses-list">
							{#if isLoadingResponses}
								<div class="responses-loading-state">
									<span class="dot"></span>
									<span>Loading community questions…</span>
								</div>
							{:else if filteredResponses.length === 0}
								<div class="responses-empty-state">
									<Bud size={56} />
									<p class="empty-text">No questions matched your search or filter.</p>
									<button type="button" class="empty-action-btn" onclick={() => { activeTab = 'contribute'; }}>
										Contribute your questions →
									</button>
								</div>
							{:else}
								{#each filteredResponses as item}
									<div class="response-flat-row">
										<div class="row-meta-strip">
											<span class="meta-tag sem-tag">{item.semester}</span>
											<span class="meta-tag subj-tag">{item.subject}</span>
											{#if item.difficulty && item.difficulty !== 'General'}
												<span class="meta-tag diff-tag">{item.difficulty}</span>
											{/if}
											<span class="meta-date">{new Date(item.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
										</div>

										<div class="questions-flow">
											{#each item.enhancedQuestions as q, idx}
												<div class="q-entry">
													<span class="q-marker">Q{idx + 1}</span>
													<span class="q-body">{q}</span>
												</div>
											{/each}
										</div>
									</div>
								{/each}
							{/if}
						</div>
					</div>
				</main>
			{:else if loadError}
				<main class="center-content">
					<div class="error-panel">
						<h2>Unable to load interview</h2>
						<p>{loadError}</p>
						<button class="primary-action-btn" onclick={handleClose}>Back to Materio</button>
					</div>
				</main>
			{:else if isComplete}
				<!-- Thank You Screen with Living Bud -->
				<main class="complete-view">
					<div class="complete-card">
						<div class="complete-bud">
							<Bud size={72} />
						</div>

						<h1 class="complete-title">{form.interview?.completeMessage || 'Response recorded'}</h1>
						<p class="complete-desc">
							Thank you for contributing. Your response has been securely saved to the database.
						</p>

						{#if capturedEntries.length > 0}
							<div class="summary-card">
								<div class="summary-title">Collected Values</div>
								<div class="summary-list">
									{#each capturedEntries as [k, v]}
										<div class="summary-row">
											<span class="summary-key">{k}</span>
											<span class="summary-val">{v}</span>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<div class="complete-actions">
							<button type="button" class="primary-action-btn" onclick={restart}>
								Submit another response
							</button>
							<button type="button" class="secondary-action-btn" onclick={handleClose}>
								Return to Materio
							</button>
						</div>
					</div>
				</main>
			{:else}
				<!-- Conversation Stream -->
				<main class="chat-stream" bind:this={chatContainer}>
					<div class="chat-inner">
						{#if isHeroState}
							<!-- Hero Welcome with Living Bud -->
							<div class="hero-box">
								<div class="hero-bud">
									<Bud size={68} />
								</div>
								<h1 class="hero-heading">{formGreeting.title}</h1>
								<p class="hero-sub">{formGreeting.intro}</p>
								<p class="hero-question">{formGreeting.prompt}</p>
							</div>
						{:else}
							<div class="messages-list">
								{#each messages as m}
									{#if m.role === 'user'}
										<div class="message-item user">
											<div class="message-bubble">
												<p>{m.content}</p>
											</div>
										</div>
									{:else}
										<div class="message-item assistant">
											<div class="assistant-response">
												<p>{m.content}</p>
											</div>
										</div>
									{/if}
								{/each}

								{#if isSending}
									<div class="message-item assistant streaming-indicator">
										<div class="bud-streaming-wrap">
											<BudDoesThings
												bind:this={budStreamRef}
												class="bud-streaming-anim"
												activity="reading"
												interactive={false}
												autoCycle={false}
												showDesk={false}
											/>
										</div>
										<span class="streaming-text">Recording your response…</span>
									</div>
								{/if}

								<!-- Static Bud sits below the last assistant response -->
								{#if !isSending && messages.length > 1}
									<div class="bud-resting-wrap">
										<Bud size={36} />
									</div>
								{/if}
							</div>
						{/if}
					</div>
				</main>

				<!-- Clean Bottom Composer (No +, No Mic) -->
				<footer class="composer-area">
					<div class="composer-box">
						<form
							class="composer-form"
							onsubmit={(e) => { e.preventDefault(); submitAnswer(); }}
						>
							<textarea
								bind:this={textareaEl}
								bind:value={answer}
								rows="1"
								placeholder="{appropriatePlaceholder} (Enter to send)"
								aria-label="Your response"
								oninput={autoResizeTextarea}
								onkeydown={handleKeydown}
							></textarea>

							<div class="composer-controls">
								{#if form?.interview?.skipAllowed !== false && nextField}
									<button type="button" class="skip-btn" onclick={skip}>
										Skip
									</button>
								{/if}

								<button
									type="submit"
									class="send-btn"
									class:can-send={answer.trim().length > 0 && !isSending}
									disabled={isSending || !answer.trim()}
									title="Send response (Enter)"
								>
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
										<line x1="12" y1="19" x2="12" y2="5"></line>
										<polyline points="5 12 12 5 19 12"></polyline>
									</svg>
								</button>
							</div>
						</form>
					</div>
				</footer>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* -------------------------------------------------------------
	   PREDEFINED MATERIO TYPOGRAPHY: Quadrant (Headings) & OpenRunde (Body)
	   ------------------------------------------------------------- */
	.interviewer-root {
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		box-sizing: border-box;
	}

	.interviewer-root button,
	.interviewer-root input,
	.interviewer-root textarea,
	.interviewer-root p,
	.interviewer-root span,
	.interviewer-root label,
	.interviewer-root div {
		font-family: 'OpenRunde', 'Open Runde', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	/* Headings strictly in Quadrant */
	.interviewer-root h1,
	.interviewer-root h2,
	.interviewer-root h3,
	.interviewer-root .hero-heading,
	.interviewer-root .modal-greeting-title,
	.interviewer-root .modal-heading-title,
	.interviewer-root .complete-title,
	.interviewer-root .topbar-title,
	.interviewer-root .font-quadrant {
		font-family: 'Quadrant', 'Quadrant Notepad', 'Playfair Display', 'Lora', Georgia, serif !important;
		font-weight: 400 !important;
		letter-spacing: -0.015em;
	}

	/* Dark Theme */
	.theme-dark {
		--iv-bg: #121310;
		--iv-fg: #f4f4ee;
		--iv-muted: #8e9087;
		--iv-card: #1a1b17;
		--iv-card-border: #272923;
		--iv-input-bg: #232520;
		--iv-input-border: #34362e;
		--iv-bubble-user: #272923;
		--iv-bubble-user-border: #34362e;
		--iv-accent: #e95d3d;
		--iv-accent-border: #bd4a30;
		--iv-accent-cta: #c05a1e;
		--iv-accent-tint: rgba(233, 93, 61, 0.15);
		--iv-accent-ring: rgba(192, 90, 30, 0.25);
		--iv-topbar-bg: rgba(18, 19, 16, 0.92);
		--iv-backdrop: rgba(0, 0, 0, 0.8);
		--iv-btn-primary-bg: #c05a1e;
		--iv-btn-primary-fg: #ffffff;
	}

	/* Light Theme (Granola Parchment Canvas + Pure Surface + Ember/Forest CTA) */
	.theme-light {
		--iv-bg: #f7f7f2;
		--iv-fg: #0e0f0c;
		--iv-muted: #72726e;
		--iv-card: #ffffff;
		--iv-card-border: #e3e3e3;
		--iv-input-bg: #ffffff;
		--iv-input-border: #d5d5d2;
		--iv-bubble-user: #eaebe5;
		--iv-bubble-user-border: #d5d5d2;
		--iv-accent: #e95d3d;
		--iv-accent-border: #bd4a30;
		--iv-accent-cta: #a34914;
		--iv-accent-tint: #f3d9ca;
		--iv-accent-ring: rgba(163, 73, 20, 0.18);
		--iv-topbar-bg: rgba(247, 247, 242, 0.92);
		--iv-backdrop: rgba(0, 0, 0, 0.6);
		--iv-btn-primary-bg: #a34914;
		--iv-btn-primary-fg: #ffffff;
	}

	/* Coffee Theme */
	.theme-coffee {
		--iv-bg: #fdf6e3;
		--iv-fg: #433422;
		--iv-muted: #8a7b68;
		--iv-card: #ffffff;
		--iv-card-border: rgba(67, 52, 34, 0.12);
		--iv-input-bg: #f9f1de;
		--iv-input-border: rgba(67, 52, 34, 0.16);
		--iv-bubble-user: #ede0c7;
		--iv-bubble-user-border: rgba(67, 52, 34, 0.12);
		--iv-accent: #e95d3d;
		--iv-accent-border: #bd4a30;
		--iv-accent-cta: #a34914;
		--iv-accent-tint: #f3d9ca;
		--iv-accent-ring: rgba(163, 73, 20, 0.18);
		--iv-topbar-bg: rgba(253, 246, 227, 0.92);
		--iv-backdrop: rgba(40, 30, 20, 0.6);
		--iv-btn-primary-bg: #a34914;
		--iv-btn-primary-fg: #ffffff;
	}

	/* Coffee Dark Theme */
	.theme-coffee-dark {
		--iv-bg: #1c1510;
		--iv-fg: #f5ebd7;
		--iv-muted: #a69582;
		--iv-card: #271e17;
		--iv-card-border: rgba(245, 235, 215, 0.1);
		--iv-input-bg: #221a14;
		--iv-input-border: rgba(245, 235, 215, 0.14);
		--iv-bubble-user: #2e231b;
		--iv-bubble-user-border: rgba(245, 235, 215, 0.08);
		--iv-accent: #e95d3d;
		--iv-accent-border: #bd4a30;
		--iv-accent-cta: #c05a1e;
		--iv-accent-tint: rgba(233, 93, 61, 0.15);
		--iv-accent-ring: rgba(192, 90, 30, 0.25);
		--iv-topbar-bg: rgba(28, 21, 16, 0.92);
		--iv-backdrop: rgba(0, 0, 0, 0.8);
		--iv-btn-primary-bg: #c05a1e;
		--iv-btn-primary-fg: #ffffff;
	}

	/* -------------------------------------------------------------
	   MODAL MODE (Full Parity with apps/admin Modal.svelte)
	   ------------------------------------------------------------- */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: var(--iv-backdrop);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		z-index: 99999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		animation: fadeIn 0.2s ease;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.modal-card {
		position: relative;
		width: 100%;
		max-width: 520px;
		background: var(--iv-card);
		color: var(--iv-fg);
		border: 1px solid var(--iv-card-border);
		border-radius: 28px;
		corner-shape: squircle;
		box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.4);
		display: flex;
		flex-direction: column;
		max-height: 90vh;
		overflow: hidden;
		animation: popUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
		box-sizing: border-box;
		transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.24s ease, filter 0.24s ease;
	}

	.modal-card.responses-tab-active {
		max-width: 600px;
	}

	.modal-card.morphing-out {
		transform: scale(1.08) translateY(-10px);
		opacity: 0.15;
		filter: blur(4px);
		pointer-events: none;
	}

	@keyframes popUp {
		from { transform: scale(0.94) translateY(12px); opacity: 0; }
		to { transform: scale(1) translateY(0); opacity: 1; }
	}

	/* Mobile Bottom Sheet (True bottomsheet docking on mobile) */
	@media (max-width: 640px) {
		.modal-backdrop {
			padding: 0 !important;
			align-items: flex-end !important;
			justify-content: center !important;
			background: rgba(0, 0, 0, 0.65) !important;
		}

		.modal-card {
			width: 100% !important;
			max-width: 100% !important;
			margin: 0 !important;
			border-radius: 28px 28px 0 0 !important;
			corner-shape: squircle !important;
			max-height: 88vh !important;
			border-bottom: none !important;
			border-left: none !important;
			border-right: none !important;
			box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.35) !important;
			animation: slideUpSheet 0.28s cubic-bezier(0.16, 1, 0.3, 1) !important;
			padding-bottom: max(env(safe-area-inset-bottom, 16px), 16px);
		}

		@keyframes slideUpSheet {
			from {
				transform: translateY(100%);
			}
			to {
				transform: translateY(0);
			}
		}

		.modal-mobile-handle-wrap {
			display: flex !important;
			padding: 12px 0 6px !important;
			cursor: grab;
		}

		.modal-mobile-handle {
			width: 44px !important;
			height: 5px !important;
			border-radius: 999px;
			background: var(--iv-muted);
			opacity: 0.45;
		}

		.modal-header {
			padding: 10px 18px 12px !important;
		}

		.modal-body {
			padding: 14px 18px 14px !important;
		}

		.modal-composer {
			margin: 0 16px 12px !important;
			padding: 6px 8px 6px 14px !important;
		}

		.modal-composer input {
			font-size: 16px !important; /* Prevents auto-zoom in mobile browsers */
		}

		.modal-responses-view {
			padding: 12px 18px 16px !important;
			max-height: calc(88vh - 70px) !important;
		}
	}

	.modal-mobile-handle-wrap {
		display: none;
		justify-content: center;
		padding: 10px 0 2px;
		width: 100%;
		cursor: pointer;
	}

	.modal-mobile-handle {
		width: 48px;
		height: 5px;
		border-radius: 999px;
		background: var(--iv-muted);
		opacity: 0.35;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 24px 14px;
		border-bottom: 1px solid var(--iv-card-border);
		gap: 12px;
	}

	/* Header Tab Navigation (Styled like admin tabs with squircle corners) */
	.header-tab-nav {
		display: inline-flex;
		align-items: center;
		background: var(--iv-input-bg);
		border: 1px solid var(--iv-input-border);
		border-radius: 12px;
		corner-shape: squircle;
		padding: 3px;
		gap: 3px;
	}

	.tab-pill-btn {
		background: transparent;
		border: none;
		border-radius: 9px;
		corner-shape: squircle;
		padding: 5px 14px;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--iv-muted);
		cursor: pointer;
		transition: all 0.15s ease;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		line-height: 1.2;
	}

	.tab-pill-btn:hover {
		color: var(--iv-fg);
	}

	.tab-pill-btn.active {
		background: var(--iv-card);
		color: var(--iv-fg);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		font-weight: 600;
	}

	.tab-badge {
		font-size: 10px;
		font-weight: 700;
		background: var(--iv-input-bg);
		color: var(--iv-muted);
		border: 1px solid var(--iv-input-border);
		padding: 1px 6px;
		border-radius: 6px;
		corner-shape: squircle;
		line-height: 1.2;
	}

	/* Modal Responses View */
	.modal-responses-view {
		display: flex;
		flex-direction: column;
		max-height: calc(88vh - 80px);
		overflow: hidden;
		padding: 16px 24px 20px;
	}

	.responses-filters-header {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 12px;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--iv-card-border);
	}

	.pills-scroll-row {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}

	.pills-scroll-row::-webkit-scrollbar {
		display: none;
	}

	.filter-pill-chip {
		background: var(--iv-input-bg);
		border: 1px solid var(--iv-input-border);
		border-radius: 10px;
		corner-shape: squircle;
		padding: 4px 12px;
		font-size: 12px;
		color: var(--iv-muted);
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.filter-pill-chip:hover {
		color: var(--iv-fg);
		border-color: var(--iv-muted);
	}

	.filter-pill-chip.active {
		background: var(--iv-accent-cta);
		color: #ffffff;
		border-color: var(--iv-accent-cta);
		font-weight: 600;
	}

	.filter-pill-chip.sem-chip {
		font-size: 11px;
		padding: 3px 9px;
	}

	.modal-responses-list {
		flex: 1 1 auto;
		overflow-y: auto;
		padding-right: 4px;
	}

	/* Minimal Flat Row - NO CARDS INSIDE CARDS */
	.responses-flat-feed,
	.fullscreen-responses-list {
		display: flex;
		flex-direction: column;
	}

	.response-flat-row {
		padding: 16px 0;
		border-bottom: 1px solid var(--iv-card-border);
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: transparent;
	}

	.response-flat-row:last-child {
		border-bottom: none;
	}

	.row-meta-strip {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.meta-tag {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 8px;
		corner-shape: squircle;
		line-height: 1.2;
		letter-spacing: 0.02em;
	}

	.meta-tag.sem-tag {
		background: var(--iv-accent-tint);
		color: var(--iv-accent-cta);
		border: 1px solid var(--iv-accent-border);
	}

	.meta-tag.subj-tag {
		background: var(--iv-input-bg);
		color: var(--iv-fg);
		border: 1px solid var(--iv-card-border);
	}

	.meta-tag.diff-tag {
		background: transparent;
		color: var(--iv-muted);
		border: 1px solid var(--iv-card-border);
	}

	.questions-flow {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 2px;
	}

	.q-entry {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 14px;
		line-height: 1.55;
		color: var(--iv-fg);
	}

	.q-marker {
		font-size: 11px;
		font-weight: 700;
		color: var(--iv-accent);
		min-width: 22px;
		flex-shrink: 0;
		user-select: none;
	}

	.q-body {
		flex: 1;
		word-break: break-word;
	}

	.responses-bottom-action {
		padding-top: 12px;
		border-top: 1px solid var(--iv-card-border);
		text-align: center;
		margin-top: 6px;
	}

	.contribute-quick-link {
		background: none;
		border: none;
		color: var(--iv-accent-cta);
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
		padding: 4px 8px;
		transition: opacity 0.15s;
	}

	.contribute-quick-link:hover {
		opacity: 0.8;
	}

	/* Loading & Empty States */
	.responses-loading-state,
	.responses-empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 32px 16px;
		gap: 10px;
		text-align: center;
		color: var(--iv-muted);
		font-size: 13.5px;
	}

	.empty-text {
		margin: 0;
		color: var(--iv-muted);
		font-size: 13.5px;
	}

	.empty-action-btn {
		background: none;
		border: none;
		color: var(--iv-accent-cta);
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		padding: 0;
	}

	/* Fullscreen Responses View */
	.fullscreen-responses-view {
		flex: 1 1 auto;
		overflow-y: auto;
		padding: 32px 20px 60px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.responses-inner-container {
		width: 100%;
		max-width: 680px;
		display: flex;
		flex-direction: column;
	}

	.responses-hero-header {
		margin-bottom: 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.responses-headline {
		font-size: clamp(26px, 3.5vw, 34px);
		color: var(--iv-fg);
		margin: 0;
		line-height: 1.2;
	}

	.responses-subhead {
		font-size: 14.5px;
		line-height: 1.55;
		color: var(--iv-muted);
		margin: 0;
	}

	.responses-search-wrap {
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--iv-input-bg);
		border: 1px solid var(--iv-input-border);
		border-radius: 12px;
		padding: 8px 14px;
		transition: border-color 0.2s;
	}

	.responses-search-wrap:focus-within {
		border-color: var(--iv-accent-border);
		box-shadow: 0 0 0 3px var(--iv-accent-ring);
	}

	.search-icon {
		color: var(--iv-muted);
		flex-shrink: 0;
	}

	.responses-search-wrap input,
	.responses-search-wrap input:focus,
	.responses-search-wrap input:focus-visible {
		flex: 1;
		background: transparent !important;
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
		font-size: 14px;
		color: var(--iv-fg);
		-webkit-appearance: none;
		-moz-appearance: none;
		appearance: none;
	}

	.clear-search-btn {
		background: none;
		border: none;
		color: var(--iv-muted);
		cursor: pointer;
		font-size: 13px;
		padding: 2px 4px;
	}

	.modal-close-btn {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		border: none;
		background: transparent;
		color: var(--iv-muted);
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
		padding: 0;
	}

	.modal-close-btn:hover {
		background: var(--iv-input-bg);
		color: var(--iv-fg);
	}

	.modal-close-btn:active {
		transform: scale(0.95);
	}

	.modal-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 20px 24px;
		overflow-y: auto;
	}

	.modal-bud-wrapper {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		color: var(--iv-fg);
	}

	.modal-text-content {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.modal-greeting-title {
		font-size: 22px;
		font-weight: 700;
		margin: 0;
		color: var(--iv-fg);
	}

	.modal-intro {
		font-size: 14px;
		line-height: 1.6;
		color: var(--iv-muted);
		margin: 0;
	}

	.modal-prompt {
		font-size: 14px;
		line-height: 1.5;
		font-weight: 600;
		color: var(--iv-fg);
		margin: 0;
	}

	.modal-composer {
		display: flex;
		align-items: center;
		margin: 0 24px 20px;
		background: var(--iv-input-bg);
		border: 1px solid var(--iv-input-border);
		border-radius: 16px;
		corner-shape: squircle;
		padding: 7px 10px 7px 16px;
		gap: 10px;
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.modal-composer:focus-within {
		border-color: var(--iv-accent-border);
		box-shadow: 0 0 0 3px var(--iv-accent-ring);
	}

	.modal-composer input,
	.modal-composer input:focus,
	.modal-composer input:focus-visible {
		flex: 1;
		background: transparent !important;
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
		font-size: 14px;
		color: var(--iv-fg);
		-webkit-appearance: none;
		-moz-appearance: none;
		appearance: none;
	}

	.modal-send-btn {
		width: 32px;
		height: 32px;
		border-radius: 10px;
		corner-shape: squircle;
		border: none;
		background: var(--iv-accent-cta);
		color: #ffffff;
		display: grid;
		place-items: center;
		cursor: pointer;
		transition: transform 0.15s, opacity 0.15s, background-color 0.15s;
		flex-shrink: 0;
	}

	.modal-send-btn:hover:not(:disabled) {
		background: var(--iv-accent);
		transform: scale(1.04);
	}

	.modal-send-btn:active:not(:disabled) {
		transform: scale(0.96);
	}

	.modal-send-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* -------------------------------------------------------------
	   FULLSCREEN OVERLAY MODE
	   ------------------------------------------------------------- */
	.overlay-fullscreen {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		height: 100dvh;
		background: var(--iv-bg);
		color: var(--iv-fg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		z-index: 99999;
		animation: morphFullscreenIn 0.36s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes morphFullscreenIn {
		0% {
			opacity: 0;
			transform: scale(0.95);
			border-radius: 28px;
		}
		100% {
			opacity: 1;
			transform: scale(1);
			border-radius: 0;
		}
	}

	/* Hide app frame corners/strips that bleed through the fullscreen overlay */
	:global(.interviewer-root.as-fullscreen ~ .container::before),
	:global(.interviewer-root.as-fullscreen ~ .container::after),
	:global(body:has(.interviewer-root.as-fullscreen)::before),
	:global(body:has(.interviewer-root.as-fullscreen)::after),
	:global(body:has(.interviewer-root.as-fullscreen) header::after),
	:global(body:has(.interviewer-root.as-fullscreen) .navbar::after) {
		display: none !important;
	}

	/* Topbar */
	.topbar {
		position: static !important;
		height: auto !important;
		min-height: 0 !important;
		max-height: none !important;
		background-image: none !important;
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 24px !important;
		box-sizing: border-box;
		background-color: var(--iv-topbar-bg) !important;
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--iv-card-border);
		z-index: 30;
	}

	.topbar-left, .topbar-right {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	/* Hamburger (mobile only): opens the Captured Data drawer */
	.iv-hamburger {
		display: none;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		background: none;
		border: none;
		cursor: pointer;
		padding: 6px 4px;
		flex-shrink: 0;
	}

	.iv-hamburger span {
		display: block;
		width: 18px;
		height: 2px;
		border-radius: 2px;
		background: var(--iv-fg);
	}

	/* Back action row (mobile only): left chevron + Back, page left */
	.mobile-back-row {
		display: none;
		flex: 0 0 auto;
		padding: 6px 12px 0;
		box-sizing: border-box;
	}

	.mobile-back-btn {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		background: none;
		border: none;
		color: var(--iv-muted);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		padding: 4px 2px;
	}

	.logo-btn {
		background: none;
		border: none;
		display: flex;
		align-items: center;
		cursor: pointer;
		padding: 0;
	}

	.materio-brand-logo-topbar {
		height: 24px;
		width: auto;
		max-width: 120px;
		display: block;
		object-fit: contain;
		flex-shrink: 0;
	}

	.topbar-divider {
		color: var(--iv-muted);
		opacity: 0.5;
		font-size: 14px;
	}

	.topbar-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--iv-muted);
	}

	.exam-tag {
		font-size: 11px;
		font-weight: 600;
		color: var(--iv-accent-cta);
		background: var(--iv-accent-tint);
		border: 1px solid var(--iv-accent-border);
		padding: 2px 9px;
		border-radius: 8px;
		corner-shape: squircle;
	}

	.captured-indicator-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--iv-card);
		border: 1px solid var(--iv-card-border);
		border-radius: 10px;
		corner-shape: squircle;
		padding: 4px 10px;
		font-size: 11px;
		color: var(--iv-muted);
		cursor: pointer;
		transition: all 0.2s;
	}

	.dot-indicator {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--iv-muted);
	}

	.dot-indicator.has-data {
		background: var(--iv-accent);
	}

	.restart-btn {
		background: none;
		border: none;
		color: var(--iv-muted);
		cursor: pointer;
		padding: 6px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		transition: all 0.15s ease;
	}

	.restart-btn:hover {
		background: var(--iv-input-bg);
		color: var(--iv-fg);
	}

	.close-overlay-btn {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: none;
		background: transparent;
		color: var(--iv-muted);
		cursor: pointer;
		display: grid;
		place-items: center;
		transition: all 0.15s ease;
		padding: 0;
	}

	.close-overlay-btn:hover {
		background: var(--iv-input-bg);
		color: var(--iv-fg);
	}

	.close-overlay-btn:active {
		transform: scale(0.95);
	}

	.user-avatar-wrap {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		overflow: hidden;
		display: grid;
		place-items: center;
		background: var(--iv-card);
		border: 1px solid var(--iv-card-border);
	}

	.user-avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.user-avatar-initial {
		font-size: 12px;
		font-weight: 700;
		color: var(--iv-fg);
	}

	.user-avatar-anon {
		color: var(--iv-muted);
		display: grid;
		place-items: center;
	}

	/* Chat Stream */
	.chat-stream {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		padding: 24px 20px;
		box-sizing: border-box;
	}

	.chat-inner {
		width: 100%;
		max-width: 680px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		flex: 1;
	}

	/* Hero Box with Living Bud */
	.hero-box {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		min-height: calc(100vh - 220px);
		min-height: calc(100dvh - 220px);
		padding: 20px 0;
	}

	.hero-bud {
		color: var(--iv-fg);
		margin-bottom: 24px;
	}

	.hero-heading {
		font-size: clamp(32px, 4.5vw, 44px);
		font-weight: 700;
		color: var(--iv-fg);
		margin: 0 0 14px 0;
		line-height: 1.15;
		letter-spacing: -0.02em;
	}

	.hero-sub {
		font-size: clamp(15px, 1.8vw, 17px);
		line-height: 1.6;
		color: var(--iv-muted);
		margin: 0 0 16px 0;
		max-width: 580px;
	}

	.hero-question {
		font-size: clamp(15px, 1.8vw, 17px);
		line-height: 1.5;
		font-weight: 600;
		color: var(--iv-fg);
		margin: 0;
	}

	/* Messages List */
	.messages-list {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding-bottom: 24px;
	}

	.message-item {
		display: flex;
		width: 100%;
	}

	.message-item.assistant {
		justify-content: flex-start;
	}

	.message-item.user {
		justify-content: flex-end;
	}

	/* User messages: clean rounded rectangle bubbles */
	.message-bubble {
		max-width: 580px;
		font-size: 15px;
		line-height: 1.6;
		color: var(--iv-fg);
		border-radius: 14px;
		corner-shape: squircle;
		padding: 12px 18px;
		box-sizing: border-box;
		background: var(--iv-bubble-user);
		border: 1px solid var(--iv-bubble-user-border);
	}

	.message-bubble p {
		margin: 0;
		white-space: pre-wrap;
	}

	/* Assistant responses: direct text, no bubble */
	.assistant-response {
		max-width: 580px;
		font-size: 15px;
		line-height: 1.7;
		color: var(--iv-fg);
		padding: 4px 0;
	}

	.assistant-response p {
		margin: 0;
		white-space: pre-wrap;
	}

	/* BudDoesThings streaming indicator */
	.streaming-indicator {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}

	.bud-streaming-wrap {
		width: 56px;
		height: 56px;
		color: var(--iv-fg);
	}

	:global(.bud-streaming-anim) {
		width: 56px !important;
		height: 56px !important;
	}

	.streaming-text {
		font-size: 12px;
		color: var(--iv-muted);
		padding-left: 2px;
	}

	/* Static Bud resting below the conversation */
	.bud-resting-wrap {
		padding: 8px 0 0;
		color: var(--iv-fg);
		opacity: 0.7;
		transition: opacity 0.3s;
	}

	.bud-resting-wrap:hover {
		opacity: 1;
	}

	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--iv-accent);
		animation: typingPulse 1.2s infinite ease-in-out;
	}

	.dot:nth-child(2) { animation-delay: 0.2s; }
	.dot:nth-child(3) { animation-delay: 0.4s; }

	@keyframes typingPulse {
		0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
		40% { opacity: 1; transform: scale(1.15); }
	}

	/* Clean Bottom Composer (Squircle Prompt Box) */
	.composer-area {
		flex: 0 0 auto;
		width: 100%;
		padding: 0 20px 18px;
		box-sizing: border-box;
	}

	.composer-box {
		width: 100%;
		max-width: 680px;
		margin: 0 auto;
		background: var(--iv-input-bg);
		border: 1px solid var(--iv-input-border);
		border-radius: 18px;
		corner-shape: squircle;
		box-shadow: 0 4px 18px rgba(0, 0, 0, 0.06);
		padding: 4px 6px 4px 16px;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.composer-box:focus-within {
		border-color: var(--iv-accent-border);
		box-shadow: 0 0 0 3px var(--iv-accent-ring);
	}

	.composer-form {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		width: 100%;
	}

	textarea,
	textarea:focus,
	textarea:focus-visible {
		flex: 1;
		width: 100%;
		background: transparent !important;
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
		resize: none;
		color: var(--iv-fg);
		font-size: 14.5px;
		line-height: 1.4;
		max-height: 140px;
		min-height: 20px;
		box-sizing: border-box;
		padding: 6px 0;
		margin: 0;
		-webkit-appearance: none;
		-moz-appearance: none;
		appearance: none;
	}

	textarea::placeholder {
		color: var(--iv-muted);
		opacity: 0.8;
	}

	.composer-controls {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
		margin: 0;
		padding-bottom: 2px;
	}

	.skip-btn {
		background: none;
		border: none;
		color: var(--iv-muted);
		font-size: 12px;
		cursor: pointer;
		padding: 4px 6px;
		text-decoration: underline;
		text-underline-offset: 3px;
		transition: color 0.15s;
		white-space: nowrap;
	}

	.skip-btn:hover {
		color: var(--iv-fg);
	}

	.send-btn {
		width: 32px;
		height: 32px;
		border-radius: 10px;
		corner-shape: squircle;
		border: none;
		background: var(--iv-card-border);
		color: var(--iv-muted);
		display: grid;
		place-items: center;
		cursor: pointer;
		transition: all 0.2s;
	}

	.send-btn.can-send {
		background: var(--iv-accent-cta);
		color: #ffffff;
		box-shadow: 0 2px 8px rgba(189, 74, 48, 0.35);
	}

	.send-btn.can-send:hover {
		background: var(--iv-accent);
		transform: scale(1.05);
	}

	.send-btn.can-send:active {
		transform: scale(0.95);
	}

	.send-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* Drawer */
	.drawer-backdrop {
		position: fixed;
		inset: 0;
		background: var(--iv-backdrop);
		backdrop-filter: blur(4px);
		z-index: 50;
		display: flex;
		justify-content: flex-end;
	}

	.drawer-card {
		width: 100%;
		max-width: 360px;
		height: 100%;
		background: var(--iv-card);
		border-left: 1px solid var(--iv-card-border);
		padding: 24px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		animation: slideLeft 0.2s ease;
	}

	@keyframes slideLeft {
		from { transform: translateX(100%); }
		to { transform: translateX(0); }
	}

	.drawer-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		border-bottom: 1px solid var(--iv-card-border);
		padding-bottom: 14px;
		margin-bottom: 18px;
	}

	.drawer-header h3 {
		margin: 0 0 4px 0;
		font-size: 16px;
		color: var(--iv-fg);
	}

	.drawer-header p {
		margin: 0;
		font-size: 12px;
		color: var(--iv-muted);
	}

	.drawer-close {
		background: none;
		border: none;
		color: var(--iv-muted);
		font-size: 16px;
		cursor: pointer;
	}

	.drawer-fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
		overflow-y: auto;
	}

	.drawer-field-row {
		background: var(--iv-input-bg);
		border: 1px solid var(--iv-card-border);
		border-radius: 8px;
		padding: 10px 12px;
	}

	.drawer-field-row.filled {
		border-color: var(--iv-accent);
	}

	.field-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 4px;
	}

	.field-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--iv-fg);
	}

	.req-tag {
		font-size: 9px;
		text-transform: uppercase;
		color: var(--iv-accent);
	}

	.field-val {
		font-size: 13px;
	}

	.val-text {
		color: var(--iv-fg);
	}

	.val-empty {
		color: var(--iv-muted);
		font-style: italic;
	}

	/* Complete View */
	.complete-view {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
	}

	.complete-card {
		width: 100%;
		max-width: 480px;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.complete-bud {
		color: var(--iv-fg);
		margin-bottom: 20px;
	}

	.complete-title {
		font-size: clamp(28px, 4vw, 36px);
		font-weight: 700;
		color: var(--iv-fg);
		margin: 0 0 10px 0;
	}

	.complete-desc {
		font-size: 14px;
		line-height: 1.6;
		color: var(--iv-muted);
		margin: 0 0 24px 0;
	}

	.summary-card {
		width: 100%;
		background: var(--iv-card);
		border: 1px solid var(--iv-card-border);
		border-radius: 12px;
		padding: 14px 18px;
		margin-bottom: 24px;
		text-align: left;
		box-sizing: border-box;
	}

	.summary-title {
		font-size: 11px;
		text-transform: uppercase;
		font-weight: 700;
		color: var(--iv-muted);
		margin-bottom: 10px;
	}

	.summary-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.summary-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.summary-key {
		font-size: 11px;
		color: var(--iv-accent);
		text-transform: capitalize;
		font-weight: 600;
	}

	.summary-val {
		font-size: 13px;
		color: var(--iv-fg);
	}

	.complete-actions {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.primary-action-btn {
		background: var(--iv-btn-primary-bg);
		color: var(--iv-btn-primary-fg);
		font-size: 13px;
		font-weight: 600;
		padding: 10px 20px;
		border-radius: 12px;
		corner-shape: squircle;
		border: none;
		cursor: pointer;
		transition: opacity 0.2s;
	}

	.primary-action-btn:hover {
		opacity: 0.9;
	}

	.secondary-action-btn {
		background: var(--iv-card);
		color: var(--iv-fg);
		font-size: 13px;
		padding: 10px 18px;
		border-radius: 12px;
		corner-shape: squircle;
		border: 1px solid var(--iv-card-border);
		cursor: pointer;
		transition: background 0.2s;
	}

	.secondary-action-btn:hover {
		background: var(--iv-input-bg);
	}

	.center-content {
		flex: 1;
		display: grid;
		place-items: center;
		padding: 24px;
	}

	.error-panel {
		text-align: center;
		max-width: 360px;
	}

	/* -------------------------------------------------------------
	   FULLSCREEN INTERVIEWER PAGE MOBILE RESPONSIVENESS
	   ------------------------------------------------------------- */
	@media (max-width: 640px) {
		/* Topbar Compact on Mobile */
		.topbar {
			padding: 8px 12px !important;
			gap: 8px;
		}

		.topbar-left {
			gap: 8px;
			min-width: 0;
			flex: 1;
		}

		.materio-brand-logo-topbar {
			height: 20px;
			max-width: 90px;
		}

		.topbar-divider {
			display: none;
		}

		.topbar-title {
			display: none; /* Hide long greeting title in mobile topbar to prioritize tabs */
		}

		.exam-tag {
			max-width: 75px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: 10px;
			padding: 2px 6px;
		}

		.header-tab-nav {
			padding: 2px;
			gap: 2px;
		}

		.tab-pill-btn {
			padding: 4px 9px;
			font-size: 11.5px;
		}

		.topbar-right {
			gap: 6px;
			flex-shrink: 0;
		}

		/* Mobile header: hamburger (left) opens Captured Data; the pill and
			the close button are hidden to stop tabs overlapping the pill. */
		.iv-hamburger {
			display: inline-flex;
		}

		.captured-indicator-btn {
			display: none;
		}

		.close-overlay-btn {
			display: none;
		}

		.mobile-back-row {
			display: flex;
		}

		/* Mobile Chat Stream */
		.chat-stream {
			padding: 12px 14px 10px !important;
		}

		.bubble {
			max-width: 92% !important;
			font-size: 14px;
		}

		.bubble-assistant {
			font-size: 14.5px;
			line-height: 1.45;
		}

		.streaming-indicator {
			font-size: 13px;
		}

		/* Mobile Bottom Composer */
		.composer-area {
			padding: 0 10px max(env(safe-area-inset-bottom, 10px), 10px) !important;
		}

		.composer-box {
			border-radius: 16px !important;
			padding: 4px 6px 4px 12px !important;
		}

		textarea,
		textarea:focus,
		textarea:focus-visible {
			font-size: 16px !important; /* Prevents auto-zoom in mobile Safari */
			max-height: 110px;
		}

		.composer-controls {
			gap: 6px;
		}

		.skip-btn {
			font-size: 11.5px;
			padding: 3px 5px;
		}

		.send-btn {
			width: 30px;
			height: 30px;
		}

		/* Mobile Responses View */
		.fullscreen-responses-wrapper {
			padding: 12px 12px 20px !important;
		}

		.responses-hero-section {
			margin-bottom: 12px;
		}

		.hero-heading {
			font-size: 20px !important;
		}

		.filters-toolbar {
			gap: 8px;
		}

		.search-glass-field {
			width: 100%;
			max-width: 100%;
		}

		.pills-scroll-row {
			-webkit-overflow-scrolling: touch;
		}

		.response-flat-row {
			padding: 12px 12px;
		}

		.row-meta-strip {
			gap: 5px;
			flex-wrap: wrap;
		}

		/* Mobile Drawer */
		.drawer-card {
			max-width: 100% !important;
			width: 100% !important;
		}

		/* Mobile Complete Card */
		.complete-view {
			padding: 16px;
		}

		.complete-card {
			padding: 0;
		}

		.complete-title {
			font-size: 24px !important;
		}
	}
</style>
