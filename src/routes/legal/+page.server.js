import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';
import { PAGES_DIR, contentFiles, coverUrl } from '$lib/server/content.js';
import { getMongoDb, withMongoTimeout } from '$lib/server/mongodb.js';

export const prerender = false;

export async function load({ setHeaders }) {
    if (setHeaders) {
        setHeaders({ 'cache-control': 'public, max-age=0, must-revalidate' });
    }
    const legalPages = [];
    const seenSlugs = new Set();

    // 1. MongoDB legal posts
    try {
        const db = await withMongoTimeout(getMongoDb(), 4000, 'getMongoDb for legal');
        const mongoDocs = await withMongoTimeout(
            db.collection('exodus_posts')
                .find({
                    docType: 'legal',
                    draft: { $ne: true },
                    hidden: { $ne: true },
                    visibility: { $ne: 'private' }
                })
                .sort({ date: -1 })
                .toArray(),
            4000,
            'find legal docs'
        );

        for (const doc of mongoDocs) {
            seenSlugs.add(doc.slug);
            const rawText = (doc.content || '').replace(/<[^>]*>?/gm, '').trim();
            legalPages.push({
                title: doc.title || doc.slug,
                slug: doc.slug,
                date: doc.date || null,
                cover: doc.image || null,
                image: doc.image || null,
                excerpt: doc.excerpt || (rawText.slice(0, 280) + '...'),
                url: doc.url || `/${doc.slug}`
            });
        }
    } catch (e) {
        console.warn('[Legal Load] Mongo fetch failed, falling back to disk:', e?.message || e);
    }

    // 2. Disk fallback (src/pages/*.md: privacy, terms, cookie-policy, about)
    try {
        if (typeof fs !== 'undefined' && fs?.existsSync && fs.existsSync(PAGES_DIR)) {
            for (const filename of contentFiles(PAGES_DIR)) {
                try {
                    const slug = filename.replace(/\.md$/, '');
                    if (seenSlugs.has(slug)) continue;

                    const rawContent = fs.readFileSync(path.join(PAGES_DIR, filename), 'utf-8');
                    const { data: metadata, content } = matter(rawContent);
                    if (metadata.draft === true || metadata.hidden === true || metadata.visibility === 'private') continue;

                    const rawText = content.replace(/<[^>]*>?/gm, '').trim();
                    legalPages.push({
                        title: metadata.title || slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
                        slug,
                        date: metadata.date || null,
                        cover: coverUrl(metadata),
                        image: coverUrl(metadata),
                        excerpt: metadata.excerpt || (rawText.slice(0, 280) + '...'),
                        url: metadata.permalink || `/${slug}`
                    });
                } catch {}
            }
        }
    } catch {}

    return { legalPages };
}
