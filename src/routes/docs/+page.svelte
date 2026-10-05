<script>
    export let data;

    let { docs } = data;
</script>

<svelte:head>
    <title>Documentation</title>
    <meta name="description" content="Developer references for integrating systems." />
    <link rel="stylesheet" href="/assets/style/fonts-new.css" />
</svelte:head>

<div class="doc-page">
    <!-- Chromeless reading page: no app header and no rail navbar — the only
         way back is the same Back link privacy/terms use. -->
    <a href="/" class="back-link" aria-label="Go back to home" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none; opacity: 0.7; margin-bottom: 1.5rem;">
        <span>Back</span>
    </a>

    <main class="doc-main">
        <!-- <div>, not <header>: main.css styles bare `header` elements as the
             fixed app bar (60px, pinned to top, logo background), which grabbed
             this title block and pinned it over the grid. -->
        <div class="docs-intro" style="text-align:center; margin-bottom:3rem;">
            <h1 style="font-size:2.5rem; font-weight:400; font-family: 'QuadrantNotepad', 'OpenRunde', sans-serif; margin: 0; letter-spacing: -0.01em;">Documentation</h1>
            <p style="color:var(--muted,#61616a); font-size:1.1rem; margin: 0.5rem 0 0 0; font-family: 'OpenRunde', sans-serif; line-height: 1.45;">Developer references for integrating systems.</p>
        </div>

    <section class="docs-grid-section" style="max-width: 1100px; margin: 0 auto; width: 100%;">
        {#if docs.length === 0}
            <p style="text-align:center; color:var(--muted,#666); margin:3rem 0; font-family: 'OpenRunde', sans-serif;">No documentation guides found.</p>
        {:else}
            <div class="docs-grid">
                {#each docs as post}
                    <div class="doc-grid-cell">
                        <article class="doc-item" style="display:flex; flex-direction:column; height:100%;">
                            {#if post.cover || post.image}
                                <div class="doc-cover-container" style="margin-bottom:1.25rem; position:relative;">
                                    <a href={post.url}><img src={post.cover || post.image} alt="{post.title} cover" style="width:100%; height:180px; object-fit:cover; border-radius:8px; display:block;" /></a>
                                </div>
                            {/if}

                            <h2 style="margin:0 0 0.75rem 0; font-size:1.4rem; font-family: 'OpenRunde', sans-serif; font-weight: 600; line-height: 1.35;">
                                <a href={post.url} style="color:inherit; text-decoration:none;">{post.title}</a>
                            </h2>

                            <div class="doc-body" style="display:flex; flex-direction:column; flex-grow:1; justify-content:space-between;">
                                <a class="excerpt-link" href={post.url} style="text-decoration:none; color:inherit; display:block; margin-bottom:1.25rem;">
                                    <p class="doc-excerpt" style="margin:0; color:var(--muted,#61616a); font-size:0.95rem; line-height:1.55; font-family: 'OpenRunde', sans-serif; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">{post.excerpt}</p>
                                </a>

                                <div style="display:flex; align-items:center; gap:0.75rem;">
                                    <a class="read-more" href={post.url} style="font-weight:600; color:inherit; text-decoration:none; display:inline-flex; align-items:center; gap:0.5rem; font-size: 0.95rem; font-family: 'OpenRunde', sans-serif;">
                                        <span>Read guide</span>
                                        <span class="read-arrow" aria-hidden="true" style="display:inline-block;">
                                            <span class="short-arrow"></span>
                                        </span>
                                    </a>
                                </div>
                            </div>
                        </article>
                    </div>
                {/each}
            </div>
        {/if}
    </section>
    </main>
</div>

<style>
    .doc-page { font-family: 'OpenRunde', sans-serif; padding: 3rem 1rem; }
    .doc-main { max-width: 100%; margin: 0 auto; }
    .docs-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 3.5rem 2.5rem;
    }
    .read-more .short-arrow { display: inline-block; transition: all 0.18s ease; }
    .read-arrow .short-arrow::after { content: '>'; display: inline-block; }
    .doc-item:hover .read-arrow .short-arrow::after { content: '->'; margin-left: 6px; }
</style>
