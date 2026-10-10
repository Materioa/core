import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';
import { POSTS_DIR, contentFiles, postUrl, coverUrl } from '$lib/server/content.js';
import { getMongoDb } from '$lib/server/mongodb.js';

export async function load() {
    const changelogs = [];
    const seenSlugs = new Set();

    // 1. Load changelogs from MongoDB
    try {
        const db = await getMongoDb();
        const mongoLogs = await db.collection('exodus_posts')
            .find({
                docType: 'changelog',
                draft: { $ne: true },
                hidden: { $ne: true },
                visibility: { $ne: 'private' }
            })
            .sort({ date: -1 })
            .toArray();

        for (const l of mongoLogs) {
            seenSlugs.add(l.slug);
            const rawText = (l.content || '').replace(/<[^>]*>?/gm, '').trim();
            changelogs.push({
                title: l.title || l.slug,
                date: l.date || null,
                image: l.image || null,
                excerpt: l.excerpt || (rawText.slice(0, 320) + '...'),
                url: `/changelog#${l.slug}`
            });
        }
    } catch (e) {
        console.warn('[Changelog Load] Mongo fetch failed, falling back to disk:', e.message);
    }

    // 2. Load from disk
    if (fs.existsSync(POSTS_DIR)) {
        for (const filename of contentFiles(POSTS_DIR)) {
            const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
            const slug = slugMatch ? slugMatch[1] : filename.replace('.md', '');
            if (seenSlugs.has(slug)) continue;

            const rawContent = fs.readFileSync(path.join(POSTS_DIR, filename), 'utf-8');
            const { data: metadata, content } = matter(rawContent);

            const category = metadata.category || '';
            const categories = metadata.categories || [];
            const isLog = category === 'whats-new' || categories.includes('whats-new');
            if (!isLog || metadata.draft === true || metadata.hidden === true || metadata.visibility === 'private') continue;

            const url = `/${postUrl(metadata, slug)}`;
            const rawText = content.replace(/<[^>]*>?/gm, '').trim();
            changelogs.push({
                title: metadata.title || slug,
                date: metadata.date || null,
                image: coverUrl(metadata),
                excerpt: metadata.excerpt || (rawText.slice(0, 320) + '...'),
                url
            });
        }
    }

    changelogs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return { changelogs };
}
