<script>
    import { HugeiconsIcon } from '@hugeicons/svelte';
    import { LoaderIcon } from '@hugeicons/core-free-icons';
    export let size = '1em';
    let className = '';
    export { className as class };
    export let style = '';
</script>

<HugeiconsIcon icon={LoaderIcon} size={size} class="hgi spin {className}" {style} />
