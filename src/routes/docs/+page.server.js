import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';
import { POSTS_DIR, contentFiles, postUrl, coverUrl } from '$lib/server/content.js';
import { getMongoDb } from '$lib/server/mongodb.js';

const DOC_CATEGORIES = new Set(['documentation', 'docs']);
const isDocCategory = (value) => DOC_CATEGORIES.has(String(value || '').toLowerCase());

export async function load() {
    const docs = [];
    const seenSlugs = new Set();

    // 1. Load docs from MongoDB
    try {
        const db = await getMongoDb();
        const mongoDocs = await db.collection('exodus_posts')
            .find({ 
                docType: 'doc',
                draft: { $ne: true },
                hidden: { $ne: true }
            })
            .sort({ date: -1 })
            .toArray();

        for (const d of mongoDocs) {
            seenSlugs.add(d.slug);
            const rawText = (d.content || '').replace(/<[^>]*>?/gm, '').trim();
            const excerpt = d.excerpt || (rawText.slice(0, 160) + '...');
            docs.push({
                ...(d.metadata || {}),
                title: d.title,
                date: d.date,
                category: d.category || 'Documentation',
                cover: d.image || null,
                image: d.image || null,
                slug: d.slug,
                url: `/docs/${d.slug}`,
                excerpt
            });
        }
    } catch (e) {
        console.warn('[Docs Load] Mongo fetch failed, falling back to disk:', e.message);
    }

    // 2. Load from disk if not already in docs
    if (fs.existsSync(POSTS_DIR)) {
        for (const filename of contentFiles(POSTS_DIR)) {
            const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
            const slug = slugMatch ? slugMatch[1] : filename.replace('.md', '');
            if (seenSlugs.has(slug)) continue;

            const rawContent = fs.readFileSync(path.join(POSTS_DIR, filename), 'utf-8');
            const { data: metadata, content } = matter(rawContent);

            const category = metadata.category || '';
            const categories = metadata.categories || [];
            const listed = isDocCategory(category) || categories.some(isDocCategory);

            if (listed && metadata.draft !== true && metadata.hidden !== true) {
                const url = `/${postUrl(metadata, slug)}`;
                const rawText = content.replace(/<[^>]*>?/gm, '').trim();
                const excerpt = metadata.excerpt || (rawText.slice(0, 160) + '...');
                const cover = coverUrl(metadata);

                docs.push({
                    ...metadata,
                    cover,
                    image: cover,
                    slug,
                    url,
                    excerpt
                });
            }
        }
    }

    docs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return { docs };
}
