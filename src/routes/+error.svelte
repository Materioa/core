<script>
    import { page } from '$app/stores';
    import Dithered404 from '$lib/components/ui/dithered-404.svelte';
</script>

<svelte:head>
    <title>{$page.status || 404} - Page Not Found</title>
</svelte:head>

<div class="dithered-404-container">
    <Dithered404
        pixelSize={5}
        interactive
    />
</div>

<style>
    .dithered-404-container {
        position: relative;
        width: 100%;
        height: calc(100vh - 80px);
        min-height: 500px;
        overflow: hidden;
    }
</style>
