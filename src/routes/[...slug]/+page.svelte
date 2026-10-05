<script>
    import { onMount } from 'svelte';
    import { loadNotebookAssets, renderFormulasAndCode } from '$lib/utils/asset-loader.js';

    export let data;

    const { metadata, html, type } = data;
    // Three related stories (title + excerpt) take the place of the old
    // prev/next arrows, which only ever pointed at one neighbour each.
    const related = data.related || [];

    let isPrivate = metadata?.visibility === 'private';
    let authorName = metadata?.author || 'Materio Team';
    let authorAvatar = '/assets/img/default-avatar.svg';
    let scrollProgress = 0;

    // The old top author row is gone — byline and category now live in one
    // card under the article. `hide_author_share_row` keeps its meaning (no
    // byline) while the category pill still shows.
    const hideRow = !!metadata?.hide_author_share_row;
    $: showAuthor = type === 'post' && !hideRow && !metadata?.hide_author;
    $: showCategory = type === 'post' && !!metadata?.category;
    $: showAuthorCard = type === 'post' && (showAuthor || showCategory);

    onMount(() => {
        loadNotebookAssets().then(() => {
            renderFormulasAndCode(document.querySelector('.post-container'));
        });

        const handleScroll = () => {
            const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
            if (totalHeight > 0) {
                scrollProgress = Math.min(100, Math.max(0, (window.scrollY / totalHeight) * 100));
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    });

    function isVideo(url) {
        if (!url) return false;
        return url.includes('.mp4') || url.includes('.webm') || url.includes('.mov');
    }

    function getVideoType(url) {
        if (!url) return 'video/mp4';
        const ext = url.split('.').pop().toLowerCase();
        if (ext === 'webm') return 'video/webm';
        if (ext === 'mov') return 'video/quicktime';
        return 'video/mp4';
    }
</script>

<svelte:head>
  <link rel="stylesheet" href="/assets/style/fonts-new.css" />
  <link rel="stylesheet" href="/assets/style/style.css" />
  <link rel="stylesheet" href="/assets/style/post.css" />
  <link rel="stylesheet" href="/assets/style/notebook.css" />
  <title>{metadata.title || 'Materio'}</title>
</svelte:head>

<!-- Reading Progress Bar -->
<div style="position: fixed; top: 0; left: 0; height: 3px; background: #ff8200; z-index: 10000; transition: width 0.1s ease-out; width: {scrollProgress}%;"></div>

<main class="post-container"
      style="font-family: var(--font-primary, 'OpenRunde', 'Open Runde', sans-serif);"
      data-visibility={isPrivate ? 'private' : ''}
      data-category={metadata.category || ''}
      data-no-ads={metadata['no-ads'] ? 'true' : ''}>

    <article class="post" style="max-width: 700px; margin: 0 auto;">

        <!-- Chromeless reading page: no app header, so the way back is explicit.
             Kept inside the article column — the container is a flexbox, which
             shrink-wraps (and re-centers) anything outside of it. -->
        <div style="padding: 1.5rem 0 0; text-align: left;">
            <a href="/" class="back-link" aria-label="Go back to home" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none; opacity: 0.7;">
                <span>Back</span>
            </a>
        </div>

        {#if type === 'post'}
        <div style="text-align: center;">
            <p class="post-title" style="font-size: 32px; font-weight: bold; margin-top: 1.5rem;">
                {metadata.title}
                {#if isPrivate}
                    <span class="private-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align: -1px; margin-right: 3px;"><path d="M17 9V7a5 5 0 0 0-10 0v2H5.8A1.8 1.8 0 0 0 4 10.8v8.4A1.8 1.8 0 0 0 5.8 21h12.4a1.8 1.8 0 0 0 1.8-1.8v-8.4A1.8 1.8 0 0 0 18.2 9H17zm-2 0H9V7a3 3 0 0 1 6 0v2z"/></svg>Private</span>
                {/if}
            </p>

            {#if metadata.excerpt}
                <p class="post-description" style="font-size: 14px; margin-top: 0.5rem; color: var(--gray);">
                    {metadata.excerpt}
                </p>
            {/if}

            {#if metadata.image}
                <div style="display: block; position: relative; margin: 1.5rem auto; max-width: 700px;">
                    <div class="post-image-frame" style="padding: 5px; border-radius: 17px;">
                        {#if isVideo(metadata.image)}
                            <div class="video-cover" style="margin: 0;">
                                <video id="cover-video" muted loop style="border-radius: 12px; width: 100%;">
                                    <source src="{metadata.image}" type="{getVideoType(metadata.image)}">
                                </video>
                            </div>
                        {:else}
                            <img src="{metadata.image}" alt="Cover" class="post-cover"
                                style="border-radius: 12px; display: block; width: 100%; height: auto; object-fit: cover;" />
                        {/if}
                    </div>
                </div>
            {/if}
        </div>

        {/if}

        {#if type === 'page' && metadata.title}
             <h1 style="text-align: center; margin-bottom: 2rem;">{metadata.title}</h1>
        {/if}

        <div class="post-layout">
            <div class="post-body">
                {@html html}
            </div>
        </div>

        {#if type === 'post' && related.length}
            <!-- Related stories replace the prev/next circles: three titles with
                 an excerpt each, so there is something to read rather than a
                 single blind arrow. -->
            <section class="post-related" aria-label="Related articles">
                <h2 class="post-related-heading">Related articles</h2>
                <div class="post-related-list">
                    {#each related as item}
                        <a class="post-related-item" href={item.url}>
                            <span class="post-related-title">{item.title}</span>
                            {#if item.excerpt}
                                <span class="post-related-excerpt">{item.excerpt}</span>
                            {/if}
                        </a>
                    {/each}
                </div>
            </section>
        {/if}

        {#if showAuthorCard}
            <!-- Byline card: author first, the category as a pill underneath. -->
            <aside class="post-author-card" aria-label="Post details">
                {#if showAuthor}
                    <div class="post-author-card-head">
                        <div class="author-avatar" style="width: 44px; height: 44px; border-radius: 50%; overflow: hidden; border: 2px solid var(--border, rgba(0,0,0,0.1)); flex: 0 0 auto;">
                            <img src="{authorAvatar}" alt="{authorName}" style="width: 100%; height: 100%; object-fit: cover;">
                        </div>
                        <div class="author-info">
                            <div class="author-name" style="font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.2;">{authorName}</div>
                        </div>
                    </div>
                {/if}

                {#if showCategory}
                    <div class="post-author-card-category" class:with-head={showAuthor}>
                        <span class="post-category-pill">{metadata.category}</span>
                    </div>
                {/if}
            </aside>
        {/if}
    </article>
</main>

<style>
    /* The card sits directly on the reading page's background, so in dark mode
       it now takes the theme's own surface (--card-bg: #1e1e1e over the
       #121212 page) instead of the old 4%-white wash, which all but vanished
       against the near-black background. */
    .post-author-card {
        max-width: 700px;
        margin: 2rem auto 0;
        padding: 1.15rem 1.35rem;
        box-sizing: border-box;
        text-align: left;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.025);
    }

    .post-author-card-head {
        display: flex;
        align-items: center;
        gap: 0.85rem;
    }

    .post-author-card-category {
        display: flex;
        align-items: center;
        gap: 0.55rem;
    }

    /* The divider only makes sense when a byline sits above it; a lone pill
       (posts that hide the author) should not open with a stray rule. */
    .post-author-card-category.with-head {
        margin-top: 0.95rem;
        padding-top: 0.85rem;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
    }

    .post-category-pill {
        display: inline-flex;
        align-items: center;
        padding: 4px 12px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.4;
        color: #ff8200;
        background: rgba(255, 130, 0, 0.12);
        border: 1px solid rgba(255, 130, 0, 0.28);
    }

    /* Related stories — the three title + excerpt cards that replaced the
       prev/next arrows. */
    .post-related {
        max-width: 700px;
        margin: 2.75rem auto 0;
        text-align: left;
    }

    .post-related-heading {
        font-family: var(--font-heading, 'Quadrant', 'Quadrant Notepad', serif);
        font-size: 19px;
        font-weight: 700;
        margin: 0 0 0.85rem;
        color: var(--text, #111);
    }

    .post-related-list {
        display: grid;
        gap: 0.6rem;
    }

    .post-related-item {
        display: block;
        padding: 0.9rem 1.05rem;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.02);
        text-decoration: none;
        transition: border-color 0.15s ease, transform 0.15s ease;
    }

    .post-related-item:hover {
        border-color: rgba(255, 130, 0, 0.5);
        transform: translateY(-1px);
    }

    .post-related-title {
        display: block;
        font-size: 15px;
        font-weight: 600;
        line-height: 1.35;
        color: var(--text, #111);
    }

    .post-related-excerpt {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin-top: 0.3rem;
        font-size: 13.5px;
        line-height: 1.5;
        color: var(--gray, #6b7280);
    }

    /*
     * Dark-mode overrides. The prefix MUST be wrapped in :global() — `body`/`html`
     * are outside this component, so bare `body.dark-mode .post-author-card` was
     * pruned by the Svelte compiler and never shipped (which is exactly why the
     * card stayed on its light tint over the near-black page).
     */
    :global(body.dark-mode) .post-author-card,
    :global(html.dark-mode) .post-author-card {
        background: var(--card-bg, #1e1e1e);
        border-color: rgba(255, 255, 255, 0.14);
    }

    :global(body.dark-mode) .post-author-card-category.with-head,
    :global(html.dark-mode) .post-author-card-category.with-head {
        border-top-color: rgba(255, 255, 255, 0.12);
    }

    :global(body.dark-mode) .post-category-pill,
    :global(html.dark-mode) .post-category-pill {
        background: rgba(255, 130, 0, 0.16);
        border-color: rgba(255, 130, 0, 0.4);
        color: #ff9a33;
    }

    :global(body.dark-mode) .post-related-item,
    :global(html.dark-mode) .post-related-item {
        background: var(--card-bg, #1e1e1e);
        border-color: rgba(255, 255, 255, 0.12);
    }

    :global(body.dark-mode) .post-related-item:hover,
    :global(html.dark-mode) .post-related-item:hover {
        border-color: rgba(255, 130, 0, 0.5);
    }

    @media (max-width: 640px) {
        .post-author-card {
            padding: 1rem;
        }

        .post-related {
            margin-top: 2rem;
        }
    }
</style>
