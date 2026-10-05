import { error } from '@sveltejs/kit';
import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';
import { POSTS_DIR, PAGES_DIR, contentFiles, isStaticRoute, postUrl, pageUrl } from '$lib/server/content.js';
import { renderMarkdown } from '$lib/server/markdown.js';

export const prerender = true;

export async function entries() {
    const slugs = [];
    const seen = new Set();

    const push = (url) => {
        const clean = String(url || '').replace(/^\/+/, '').replace(/\/+$/, '');
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        slugs.push({ slug: clean });
    };

    for (const filename of contentFiles(POSTS_DIR)) {
        const rawContent = fs.readFileSync(path.join(POSTS_DIR, filename), 'utf-8');
        const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
        const extractedSlug = slugMatch ? slugMatch[1] : filename.replace('.md', '');
        const { data: metadata } = matter(rawContent);
        push(postUrl(metadata, extractedSlug));
    }

    for (const filename of contentFiles(PAGES_DIR)) {
        const rawContent = fs.readFileSync(path.join(PAGES_DIR, filename), 'utf-8');
        const { data: metadata } = matter(rawContent);
        push(pageUrl(metadata, filename));
    }

    // Routes with a page of their own (/privacy, /terms, /docs, ...) render that
    // page — prerendering the catch-all at the same path would only fight them
    // for one output file.
    return slugs.filter((entry) => !isStaticRoute(entry.slug));
}

/**
 * Card summary for a related story: frontmatter excerpt when the post has one,
 * otherwise the opening of the body with markdown syntax stripped back out.
 */
function excerptOf(rawContent, excerpt) {
    if (excerpt) return String(excerpt).trim();
    const { content } = matter(rawContent);
    const text = content
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}[#>*+-]+\s+/gm, '')
        .replace(/[*_~`#>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return '';
    return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}

/**
 * Three stories to show under an article instead of the old prev/next arrows:
 * same category first (that is what "related" means here), then the newest
 * remaining posts to fill up. Private posts are never linked.
 */
function pickRelated(index, at) {
    const current = index[at];
    const candidates = index.filter((entry, i) => i !== at && entry.visibility !== 'private');
    const sameCategory = current.category
        ? candidates.filter((entry) => entry.category.toLowerCase() === current.category.toLowerCase())
        : [];
    const chosen = [
        ...sameCategory,
        ...candidates.filter((entry) => !sameCategory.includes(entry))
    ].slice(0, 3);

    return chosen.map((entry) => ({
        url: `/${entry.url}`,
        title: entry.title,
        excerpt: excerptOf(
            fs.readFileSync(path.join(POSTS_DIR, entry.filename), 'utf-8'),
            entry.excerpt
        )
    }));
}

export async function load({ params }) {
    const slug = params.slug.replace(/\/$/, ''); // Normalize trailing slash
    
    // First search in posts
    const postsDir = POSTS_DIR;
    if (fs.existsSync(postsDir)) {
        const files = contentFiles(postsDir);
        const index = [];
        for (const filename of files) {
            const rawContent = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
            const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
            const extractedSlug = slugMatch ? slugMatch[1] : filename.replace('.md', '');
            const { data: metadata } = matter(rawContent);
            index.push({
                filename,
                extractedSlug,
                url: postUrl(metadata, extractedSlug),
                date: metadata.date ? new Date(metadata.date).getTime() : 0,
                title: metadata.title || extractedSlug,
                category: metadata.category || '',
                excerpt: metadata.excerpt || '',
                visibility: metadata.visibility || ''
            });
        }
        index.sort((a, b) => b.date - a.date);
        const at = index.findIndex((entry) => entry.url === slug || entry.extractedSlug === slug);
        const hit = at >= 0 ? index[at] : null;
        if (hit) {
            const rawContent = fs.readFileSync(path.join(postsDir, hit.filename), 'utf-8');
            const { data: metadata, content } = matter(rawContent);
            return {
                metadata,
                html: renderMarkdown(content),
                type: 'post',
                layout: 'bare',
                related: pickRelated(index, at)
            };
        }
    }
    
    // Then search in standalone pages
    const pagesDir = PAGES_DIR;
    if (fs.existsSync(pagesDir)) {
        const pageFiles = contentFiles(pagesDir);
        for (const filename of pageFiles) {
            const rawContent = fs.readFileSync(path.join(pagesDir, filename), 'utf-8');
            const { data: metadata, content } = matter(rawContent);
            
            const url = pageUrl(metadata, filename);
            
            if (url === slug) {
                return {
                    metadata,
                    // Pages are titled by the layout, so a body H1 repeating the
                    // same title is dropped — that is what keeps the legal pages
                    // (privacy, terms, cookies) on one identical shape.
                    html: renderMarkdown(content, { title: metadata.title }),
                    type: 'page',
                    layout: 'bare'
                };
            }
        }
    }
    
    throw error(404, 'Post or page not found');
}
