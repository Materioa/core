<script>
    import { page } from '$app/stores';
    import MainApp from '$lib/components/MainApp.svelte';
</script>

<MainApp initialTab={$page.params.tab} />
