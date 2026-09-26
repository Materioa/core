<script>
    import { onMount } from 'svelte';
    import { loadNotebookAssets, renderFormulasAndCode } from '$lib/utils/asset-loader.js';

    export let data;

    const { metadata, html, type } = data;
    const previousPost = data.previous_post || metadata.previous_post || null;
    const nextPost = data.next_post || metadata.next_post || null;

    let isPrivate = metadata?.visibility === 'private';
    let authorName = metadata?.author || 'Materio Team';
    let authorAvatar = '/assets/img/default-avatar.svg';
    let isCopied = false;
    let scrollProgress = 0;

    // AI Summary State
    let isSummarizing = false;
    let aiSummaryText = '';

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

    function copyShareLink() {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(window.location.href);
            isCopied = true;
            setTimeout(() => isCopied = false, 2000);
        }
    }

    function triggerPrint() {
        if (typeof window !== 'undefined') window.print();
    }

    async function generateAiSummary() {
        if (isSummarizing || aiSummaryText) return;
        isSummarizing = true;

        try {
            const cleanText = html.replace(/<[^>]*>?/gm, '').substring(0, 3000);
            const res = await fetch('/api/v2/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'user', content: `Summarize the following article in 3 bullet points:\n\n${cleanText}` }
                    ]
                })
            });

            if (res.ok) {
                const data = await res.json();
                aiSummaryText = data.choices?.[0]?.message?.content || 'Summary unavailable.';
            }
        } catch (e) {
            console.error('Failed to generate summary:', e);
            aiSummaryText = 'Failed to load AI summary.';
        } finally {
            isSummarizing = false;
        }
    }

    $: readingTime = Math.max(1, Math.ceil((html || '').length / 1000));
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
      style="font-family: 'PP Mori', sans-serif;"
      data-visibility={isPrivate ? 'private' : ''}
      data-category={metadata.category || ''}
      data-no-ads={metadata['no-ads'] ? 'true' : ''}>

    <article class="post" style="max-width: 700px; margin: 0 auto;">

        {#if type === 'post'}
        <div style="text-align: center;">
            <div style="display: flex; justify-content: center; align-items: center; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap;">
                <div class="post-date-pill" style="border-radius: 20px; padding: 0.4rem 0.8rem; font-size: 12px;">
                    {new Date(metadata.date || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    {#if metadata.category}
                        • {metadata.category}
                    {/if}
                    <span class="reading-time">• {readingTime} min read</span>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: center; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                        {#if previousPost}
                            <a href={previousPost} class="post-nav-button" style="border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; text-decoration: none;" title="Previous Post">‹</a>
                        {/if}
                        {#if nextPost}
                            <a href={nextPost} class="post-nav-button" style="border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; text-decoration: none;" title="Next Post">›</a>
                        {/if}
                    </div>

            <p class="post-title" style="font-size: 32px; font-weight: bold;">
                {metadata.title}
                {#if isPrivate}
                    <span class="private-badge"><i class="fa-solid fa-lock"></i> Private</span>
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

            <!-- Author & Action Row -->
            {#if !metadata.hide_author_share_row}
                <div class="author-share-row"
                    style="display: flex; justify-content: space-between; align-items: center; margin: 0.5rem auto; max-width: 700px; padding: 0 1rem;">

                    <div style="display: flex; align-items: center; gap: 0.8rem;">
                        {#if !metadata.hide_author}
                            <div class="author-avatar" style="width: 35px; height: 35px; border-radius: 50%; overflow: hidden; border: 2px solid rgba(0,0,0,0.1);">
                                <img src="{authorAvatar}" alt="{authorName}" style="width: 100%; height: 100%; object-fit: cover;">
                            </div>
                            <div class="author-info">
                                <div class="author-name" style="font-size: 14px; font-weight: 600; color: var(--text); line-height: 1.2;">{authorName}</div>
                            </div>
                        {/if}
                    </div>

                    <!-- Actions -->
                    <div style="display: flex; justify-content: center; align-items: center; gap: 1rem;">
                        {#if !metadata.hide_share}
                            <button class="site-button" on:click={copyShareLink} title="Share Link" style="position: relative;">
                                <i class="fa-regular fa-link-simple" style="transform: rotate(-45deg); font-size: 14px;"></i>
                                {#if isCopied}<span style="position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: #ff8200; color: #fff; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">Copied!</span>{/if}
                            </button>
                        {/if}
                        {#if !metadata.hide_print}
                            <button class="site-button" on:click={triggerPrint} title="Print Article / PDF">
                                <i class="fa-regular fa-print" style="font-size: 14px;"></i>
                            </button>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>

        {#if metadata.summarize}
            <div id="ai-summary-section" class="ai-summary-section" style="border-radius: 12px; padding: 1.5rem; margin: 2rem auto;">
                <div id="summary-header" on:click={generateAiSummary} style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                    <div style="display: flex; align-items: center;">
                        <i class="fa-solid fa-wand-magic-sparkles" style="margin-right: 0.5rem; font-size: 18px; color: #ff8200;"></i>
                        <h3 style="margin: 0; font-size: 18px; font-weight: 600;">
                            {isSummarizing ? 'Generating AI Summary...' : 'AI Summary'}
                        </h3>
                    </div>
                </div>

                {#if aiSummaryText}
                    <div class="summary-body" style="margin-top: 1rem; line-height: 1.6; font-size: 0.95rem; white-space: pre-wrap;">
                        {aiSummaryText}
                    </div>
                {/if}
            </div>
        {/if}
        {/if}

        {#if type === 'page' && metadata.title}
             <h1 style="text-align: center; margin-bottom: 2rem;">{metadata.title}</h1>
        {/if}

        <div class="post-layout">
            <div class="post-body">
                {@html html}
            </div>
        </div>
    </article>
</main>
