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
	<title>Materio Interviewer</title>
</svelte:head>

{#if formParam}
<InterviewerCore
	initialMode="fullscreen"
	{formId}
	{examCode}
	{examSubject}
/>
{/if}
