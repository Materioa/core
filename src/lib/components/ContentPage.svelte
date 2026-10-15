<script>
  export let title = '';
  export let description = '';
  export let canonicalPath = '';
  export let showBackButton = true;

  $: pageTitle = title ? `${title} · Materio` : 'Materio';
  $: pageDesc = description || "Official materials you trust, in a way you love — Find organized, official study materials and notes on Materio.";
  $: pageUrl = `https://getmaterio.app${canonicalPath || ''}`;
</script>

<svelte:head>
  <title>{pageTitle}</title>
  <meta name="description" content={pageDesc} />
  {#if canonicalPath}
    <link rel="canonical" href={pageUrl} />
  {/if}
  <meta property="og:title" content={pageTitle} />
  <meta property="og:description" content={pageDesc} />
  <meta property="og:url" content={pageUrl} />
  <meta property="og:type" content="article" />
  <meta name="twitter:title" content={pageTitle} />
  <meta name="twitter:description" content={pageDesc} />
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
