import { error } from '@sveltejs/kit';
import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';
import { POSTS_DIR, PAGES_DIR, contentFiles, isStaticRoute, postUrl, pageUrl } from '$lib/server/content.js';
import { renderMarkdown } from '$lib/server/markdown.js';
import { getMongoDb } from '$lib/server/mongodb.js';

export const prerender = 'auto';

export async function entries() {
    const slugs = [];
    const seen = new Set();

    const push = (url) => {
        if (!url) return;
        const withoutHash = String(url).split('#')[0].split('?')[0];
        const clean = withoutHash.replace(/^\/+/, '').replace(/\/+$/, '');
        if (!clean || seen.has(clean)) return;
        if (clean === 'changelog' || clean.startsWith('changelog/') || clean === 'docs' || isStaticRoute(clean)) return;
        seen.add(clean);
        slugs.push({ slug: clean });
    };

    // 1. Slugs from MongoDB
    try {
        const db = await getMongoDb();
        const docs = await db.collection('exodus_posts').find({}).toArray();
        for (const doc of docs) {
            if (doc.url) push(doc.url);
            if (doc.slug) push(doc.slug);
            if (doc.category) push(`${String(doc.category).toLowerCase()}/${doc.slug}`);
        }
    } catch (e) {
        // Fallback to local files
    }

    // 2. Slugs from disk files
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

    return slugs.filter((entry) => !isStaticRoute(entry.slug));
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

export async function load({ params }) {
    const rawSlug = params.slug.replace(/\/$/, '');
    const cleanSlug = rawSlug.replace(/^(posts|docs|documentation|changelog)\//, '');

    // 1. Try MongoDB first (dynamic and source of truth)
    try {
        const db = await getMongoDb();
        const doc = await db.collection('exodus_posts').findOne({
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
        });

        if (doc) {
            const isPage = doc.docType === 'legal';
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
                    ...(doc.metadata || {})
                },
                html: renderMarkdown(doc.content || '', isPage ? { title: doc.title } : {}),
                type: isPage ? 'page' : 'post',
                layout: 'bare',
                related: []
            };
        }
    } catch (mongoErr) {
        console.warn('[Exodus Post Load] Mongo query fallback:', mongoErr.message);
    }

    // 2. Search local disk posts (legacy fallback)
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
        const at = index.findIndex((entry) => 
            entry.url === rawSlug || 
            entry.extractedSlug === rawSlug || 
            entry.extractedSlug === cleanSlug ||
            entry.url === cleanSlug
        );
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

    // 3. Search local disk standalone pages
    const pagesDir = PAGES_DIR;
    if (fs.existsSync(pagesDir)) {
        const pageFiles = contentFiles(pagesDir);
        for (const filename of pageFiles) {
            const rawContent = fs.readFileSync(path.join(pagesDir, filename), 'utf-8');
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
        }
    }

    throw error(404, 'Post or page not found');
}
