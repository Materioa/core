<script>
    export let data;

    const changelogs = data.changelogs || [];

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${dd}.${mm}.${d.getFullYear()}`;
    }
</script>

<svelte:head>
    <title>What's New?</title>
    <meta name="description" content="Latest changes and release notes." />
    <link rel="stylesheet" href="/assets/style/fonts-new.css" />
</svelte:head>

<main class="changelogs-page" style="font-family: 'OpenRunde', sans-serif; padding: 3rem 1rem;">
    <header class="changelogs-header" style="text-align:center; margin-bottom:2rem;">
        <h1 style="font-size:2.25rem; font-weight:400; font-family: 'QuadrantNotepad', 'OpenRunde', sans-serif;">What's New?</h1>
    </header>

    <section class="changelogs-list" style="display:flex; justify-content:center;">
        <div class="changelogs-container" style="width:100%; max-width:600px; display:flex; flex-direction:column; gap:2rem;">
            {#if changelogs.length === 0}
                <p style="text-align:center; color:#666; margin:3rem 0;">No changelogs yet.</p>
            {:else}
                <div class="changelog-rows" style="display:flex; flex-direction:column; gap:2rem;">
                    {#each changelogs as post}
                        <div class="changelog-row" style="display:grid; grid-template-columns:100px 1fr; gap:5rem; align-items:start;">
                            <div class="date-cell" style="padding-top:1rem; display:block;">
                                <a class="date-link" href={post.url} aria-label="Open {post.title}"><span class="date-pill" aria-hidden="true" style="font-size:0.8rem; padding:0.35rem 0.6rem; border-radius:6px; display:inline-block; min-width:80px; text-align:center;">{formatDate(post.date)}</span></a>
                            </div>

                            <div class="post-cell">
                                <article class="changelog-item" style="display:block; padding:1rem; border-radius:8px;">
                                    <h2 style="margin:0; font-size:1.125rem;"><a href={post.url} style="color:inherit; text-decoration:none;">{post.title}</a></h2>

                                    <div class="changelog-body" style="margin-top:0.75rem;">
                                        <a class="excerpt-link" href={post.url} style="text-decoration:none; color:inherit; display:block;"><p class="changelog-excerpt" style="margin:0 0 0.75rem; color:var(--muted,#61616a); font-size:0.95rem; line-height:1.45;">{post.excerpt}</p></a>
                                        <div style="display:flex; align-items:center; gap:0.75rem;">
                                            <a class="read-more" href={post.url} style="font-weight:600; color:inherit; text-decoration:none; display:inline-flex; align-items:center; gap:0.5rem;">
                                                <span>Show changes</span>
                                                <span class="read-arrow" aria-hidden="true" style="display:inline-block;">
                                                    <span class="short-arrow"></span>
                                                </span>
                                            </a>
                                        </div>
                                    </div>

                                    <div class="changelog-cover" style="margin-top:1rem;">
                                        {#if post.image}
                                            <a href={post.url}><img src={post.image} alt="{post.title} cover" style="width:100%; max-width:432px; height:175px; object-fit:cover; border-radius:6px; display:block;" /></a>
                                        {:else}
                                            <a href={post.url}><div style="width:100%; max-width:432px; height:175px; background:#f2f2f4; border-radius:6px; display:flex; align-items:center; justify-content:center; color:#999;">No image</div></a>
                                        {/if}
                                    </div>
                                </article>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </section>
</main>

<style>
    .read-more .short-arrow { display: inline-block; transition: all 0.18s ease; }
    .read-arrow .short-arrow::after { content: '>'; display: inline-block; }
    .changelog-item:hover .read-arrow .short-arrow::after { content: '->'; margin-left: 6px; }
    .changelog-item:hover { box-shadow: none; }
    .date-pill { background: #e8e8e4; color: #3a3a3a; }
    @media (max-width: 640px) {
        .changelog-row { grid-template-columns: 1fr !important; gap: 0.5rem !important; }
        .date-cell { padding-top: 0 !important; }
    }
</style>
