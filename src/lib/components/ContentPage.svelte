<script>
  export let title = '';
  export let showBackButton = true;
</script>

<svelte:head>
  <title>{title}</title>
  <link rel="stylesheet" href="/assets/style/fonts-new.css" />
  <link rel="stylesheet" href="/assets/style/page.css" />
</svelte:head>

<main class="page-content">
  {#if showBackButton}
    <a href="/" class="back-link" aria-label="Go back to home" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none; opacity: 0.7; margin-bottom: 1.5rem;">
      
      <span>Back</span>
    </a>
  {/if}

  {#if title}
    <h1 class="page-title">{title}</h1>
  {/if}
  <article class="markdown-body">
    <slot />
  </article>
</main>
