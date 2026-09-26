<script>
    import { onMount } from 'svelte';
    import { searchTerm } from '$lib/stores.js';
    export let data;

    let { posts } = data;

    // Derived states
    $: postsWithImages = posts.filter(p => p.image);
    $: quickReads = posts.filter(p => !p.image).slice(0, 10);
    $: visiblePosts = postsWithImages.filter(p => p.visibility !== 'private');
    
    // Extract unique categories from visible posts
    $: categories = [...new Set(visiblePosts.map(p => p.category).filter(Boolean))].sort();

    // State variables
    let selectedCategory = 'all';
    let hasPrivateAccess = false; // We can integrate the auth check here later

    // Derived filtered posts based on category and search
    $: filteredGridPosts = postsWithImages.slice(1).filter(post => {
        if (post.visibility === 'private' && !hasPrivateAccess) return false;
        if (selectedCategory !== 'all' && post.category !== selectedCategory && 
           !(selectedCategory === 'uncategorized' && !post.category)) return false;
        return true;
    });

    $: isSearching = $searchTerm.trim().length > 0;
    
    // Search results calculation
    $: searchResults = isSearching ? posts.filter(post => {
        if (post.visibility === 'private' && !hasPrivateAccess) return false;
        const titleMatch = (post.title || '').toLowerCase().includes($searchTerm.toLowerCase());
        const categoryMatch = (post.category || '').toLowerCase().includes($searchTerm.toLowerCase());
        return titleMatch || categoryMatch;
    }) : [];

    // Helper to determine if media is video
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

    onMount(() => {
        const token = localStorage.getItem('materio_auth_token');
        if (token) {
            // Placeholder: Check real privileges via API
        }
    });
</script>

<svelte:head>
    <title>InsightRoom</title>
</svelte:head>

<main class="home-container">
    <!-- Search state handling -->
    {#if !isSearching}
        <!-- Hero Section with Uncategorized Posts -->
        <div class="hero-section">
            {#if postsWithImages.length > 0}
                {@const firstPost = postsWithImages[0]}
                {#if firstPost.visibility !== 'private' || hasPrivateAccess}
                <div class="hero-content">
                    <a class="hero-post" href="{firstPost.url}" data-visibility="{firstPost.visibility === 'private' ? 'private' : ''}">
                        {#if firstPost.image}
                            {#if isVideo(firstPost.image)}
                                <div class="hero-video">
                                    <video muted loop autoplay>
                                        <source src="{firstPost.image}" type="{getVideoType(firstPost.image)}">
                                    </video>
                                </div>
                            {:else}
                                <img src="{firstPost.image}" class="hero-image" alt="{firstPost.title} thumbnail">
                            {/if}
                        {/if}
                        <div class="hero-meta">
                            <p class="post-date">{new Date(firstPost.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                            <h2 class="post-title">
                                {firstPost.title}
                                {#if firstPost.visibility === 'private'}
                                    <span class="private-badge"><i class="fa-solid fa-lock"></i> Private</span>
                                {/if}
                            </h2>
                        </div>
                    </a>
                </div>
                {/if}
            {/if}

            <!-- Quick Reads -->
            <div class="uncategorized-posts">
                <h3 class="uncategorized-title">Quick Reads</h3>
                <div class="uncategorized-list">
                    {#each quickReads as post}
                        {#if post.visibility !== 'private' || hasPrivateAccess}
                        <a class="uncategorized-item" href="{post.url}" data-visibility="{post.visibility === 'private' ? 'private' : ''}">
                            <h4 class="uncategorized-item-title">
                                {post.title}
                                {#if post.visibility === 'private'} <i class="fa-solid fa-lock"></i> {/if}
                            </h4>
                            <p class="uncategorized-item-date">{new Date(post.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                        </a>
                        {/if}
                    {/each}
                </div>
            </div>
        </div>

        <!-- Category Selection -->
        <div class="category-selector">
            {#if categories.length > 0}
                <button class="category-pill {selectedCategory === 'all' ? 'active' : ''}" on:click={() => selectedCategory = 'all'}>All Posts</button>
                {#each categories as category}
                    <button class="category-pill {selectedCategory === category ? 'active' : ''}" on:click={() => selectedCategory = category}>{category}</button>
                {/each}
            {/if}
        </div>

        <!-- Post Grid -->
        <div class="post-grid">
            {#each filteredGridPosts as post}
                <a class="post-card no-border" href="{post.url}" data-visibility="{post.visibility === 'private' ? 'private' : ''}" data-category="{post.category || 'uncategorized'}">
                    {#if post.image}
                        {#if isVideo(post.image)}
                            <div class="video-thumbnail">
                                <video muted loop autoplay>
                                    <source src="{post.image}" type="{getVideoType(post.image)}">
                                </video>
                            </div>
                        {:else}
                            <img src="{post.image}" class="post-image rounded" alt="{post.title} thumbnail">
                        {/if}
                    {/if}
                    <div class="post-meta">
                        <h2 class="post-title">
                            {post.title}
                            {#if post.visibility === 'private'} <span class="private-badge"><i class="fa-solid fa-lock"></i> Private</span> {/if}
                        </h2>
                        {#if post.category}
                            <p class="post-category">{post.category}</p>
                        {/if}
                        <p class="post-date">{new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                    </div>
                </a>
            {/each}
        </div>

    {:else}
        <!-- Search Results -->
        <div class="search-results-hero">
            <h2 class="search-results-title">Search Results</h2>
            <div class="search-results-grid">
                {#each searchResults as post}
                    <a class="search-result-card" href="{post.url}">
                        {#if post.image}
                            {#if isVideo(post.image)}
                                <div class="video-thumbnail">
                                    <video muted loop autoplay>
                                        <source src="{post.image}" type="{getVideoType(post.image)}">
                                    </video>
                                </div>
                            {:else}
                                <img src="{post.image}" class="post-image" alt="{post.title} thumbnail">
                            {/if}
                        {/if}
                        <div class="post-meta">
                            <h3 class="post-title">
                                {post.title}
                                {#if post.visibility === 'private'} <span class="private-badge"><i class="fa-solid fa-lock"></i> Private</span> {/if}
                            </h3>
                            {#if post.category}
                                <p class="post-category">{post.category}</p>
                            {:else if !post.image}
                                <p class="post-category">Quick Reads</p>
                            {/if}
                            <p class="post-date">{new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                        </div>
                    </a>
                {/each}
            </div>
            {#if searchResults.length === 0}
                <div class="no-results">
                    <p>No posts found matching your search.</p>
                </div>
            {/if}
        </div>
    {/if}
</main>
