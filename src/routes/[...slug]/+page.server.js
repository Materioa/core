import { error } from '@sveltejs/kit';
import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';
import { POSTS_DIR, PAGES_DIR, contentFiles, isStaticRoute, postUrl, pageUrl } from '$lib/server/content.js';
import { renderMarkdown } from '$lib/server/markdown.js';
import { getMongoDb, withMongoTimeout } from '$lib/server/mongodb.js';

export const prerender = false;

export async function entries() {
    return [];
}

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

function pickRelated(index, at) {
    const current = index[at];
    if (!current) return [];
    const candidates = index.filter((entry, i) => i !== at && entry.visibility !== 'private');
    const sameCategory = current.category
        ? candidates.filter((entry) => entry.category && entry.category.toLowerCase() === current.category.toLowerCase())
        : [];
    const chosen = [
        ...sameCategory,
        ...candidates.filter((entry) => !sameCategory.includes(entry))
    ].slice(0, 3);

    return chosen.map((entry) => ({
        url: `/${entry.url}`,
        title: entry.title,
        excerpt: entry.excerpt || ''
    }));
}

export async function load({ params, setHeaders }) {
    if (setHeaders) {
        setHeaders({ 'cache-control': 'public, max-age=0, must-revalidate' });
    }
    const rawSlug = String(params.slug || '').replace(/\/$/, '');
    const cleanSlug = rawSlug.replace(/^(posts|docs|documentation|changelog)\//, '');

    // 1. Try MongoDB first (dynamic and source of truth)
    try {
        const db = await withMongoTimeout(getMongoDb(), 4000, 'getMongoDb for slug');
        const doc = await withMongoTimeout(
            db.collection('exodus_posts').findOne({
                $or: [
                    { slug: rawSlug },
                    { slug: cleanSlug },
                    { url: `/${rawSlug}` },
                    { url: rawSlug },
                    { url: `/${cleanSlug}` },
                    { url: cleanSlug },
                    { filename: rawSlug },
                    { filename: `${cleanSlug}.md` }
                ]
            }),
            4000,
            'findOne exodus_post'
        );

        if (doc) {
            const isPage = doc.docType === 'legal';
            let renderedHtml = '';
            try {
                renderedHtml = renderMarkdown(doc.content || '', isPage ? { title: doc.title } : {});
            } catch (renderErr) {
                console.warn('[renderMarkdown error]:', renderErr);
                renderedHtml = String(doc.content || '');
            }

            return {
                metadata: {
                    title: doc.title,
                    date: doc.date,
                    category: doc.category,
                    categories: doc.categories || [],
                    image: doc.image,
                    cover: doc.image,
                    excerpt: doc.excerpt,
                    draft: doc.draft,
                    hidden: doc.hidden,
                    visibility: doc.visibility || 'public',
                    permalink: doc.url,
                    cover_home_only: Boolean(doc.cover_home_only ?? doc.metadata?.cover_home_only ?? doc.metadata?.hide_cover_in_post),
                    hide_cover_in_post: Boolean(doc.cover_home_only ?? doc.metadata?.cover_home_only ?? doc.metadata?.hide_cover_in_post),
                    ...(doc.metadata || {})
                },
                html: renderedHtml,
                type: isPage ? 'page' : 'post',
                layout: 'bare',
                related: []
            };
        }
    } catch (mongoErr) {
        console.warn('[Exodus Post Load] Mongo query fallback:', mongoErr?.message || mongoErr);
    }

    // 2. Safe local disk posts fallback (guarded against edge fs crashes)
    try {
        if (typeof fs !== 'undefined' && fs?.existsSync && fs.existsSync(POSTS_DIR)) {
            const files = contentFiles(POSTS_DIR);
            const index = [];
            for (const filename of files) {
                try {
                    const rawContent = fs.readFileSync(path.join(POSTS_DIR, filename), 'utf-8');
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
                } catch {}
            }
            index.sort((a, b) => b.date - a.date);
            const at = index.findIndex((entry) => 
                entry.url === rawSlug || 
                entry.extractedSlug === rawSlug || 
                entry.extractedSlug === cleanSlug ||
                entry.url === cleanSlug
            );
            const hit = at >= 0 ? index[at] : null;
            if (hit) {
                const rawContent = fs.readFileSync(path.join(POSTS_DIR, hit.filename), 'utf-8');
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
    } catch {}

    // 3. Safe local disk standalone pages fallback
    try {
        if (typeof fs !== 'undefined' && fs?.existsSync && fs.existsSync(PAGES_DIR)) {
            const pageFiles = contentFiles(PAGES_DIR);
            for (const filename of pageFiles) {
                try {
                    const rawContent = fs.readFileSync(path.join(PAGES_DIR, filename), 'utf-8');
                    const { data: metadata, content } = matter(rawContent);
                    const url = pageUrl(metadata, filename);
                    if (url === rawSlug || url === cleanSlug) {
                        return {
                            metadata,
                            html: renderMarkdown(content, { title: metadata.title }),
                            type: 'page',
                            layout: 'bare'
                        };
                    }
                } catch {}
            }
        }
    } catch {}

    throw error(404, 'Post or page not found');
}
