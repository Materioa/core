<script>
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import InterviewerCore from '$lib/components/InterviewerCore.svelte';

	const formParam = $page.url.searchParams.get('form');
	const examCode = $page.url.searchParams.get('exam') || '';
	const examSubject = $page.url.searchParams.get('subject') || '';

	if (browser && !formParam) {
		goto('/home', { replaceState: true });
	}

	const formId = formParam || 'viva-question-bank';
</script>

<svelte:head>
	<title>Materio Interviewer — Interactive Viva &amp; Exam Prep</title>
	<meta name="description" content="Prepare for viva and university technical examinations with Materio's interactive AI interviewer." />
	<link rel="canonical" href="https://getmaterio.app/interviewer" />
	<meta property="og:title" content="Materio Interviewer — Interactive Viva &amp; Exam Prep" />
	<meta property="og:description" content="Prepare for viva and university technical examinations with Materio's interactive AI interviewer." />
	<meta property="og:url" content="https://getmaterio.app/interviewer" />
	<meta name="twitter:title" content="Materio Interviewer — Interactive Viva &amp; Exam Prep" />
	<meta name="twitter:description" content="Prepare for viva and university technical examinations with Materio's interactive AI interviewer." />
</svelte:head>

{#if formParam}
<InterviewerCore
	initialMode="fullscreen"
	{formId}
	{examCode}
	{examSubject}
/>
{/if}
