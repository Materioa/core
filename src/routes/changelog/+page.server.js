import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';
import { POSTS_DIR, contentFiles, postUrl, coverUrl } from '$lib/server/content.js';

export async function load() {
    const changelogs = [];

    for (const filename of contentFiles(POSTS_DIR)) {
        const rawContent = fs.readFileSync(path.join(POSTS_DIR, filename), 'utf-8');
        const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
        const slug = slugMatch ? slugMatch[1] : filename.replace('.md', '');
        const { data: metadata, content } = matter(rawContent);

        const category = metadata.category || '';
        const categories = metadata.categories || [];
        const isLog = category === 'whats-new' || categories.includes('whats-new');
        // `hidden` means the same thing here as it does in the docs grid: written,
        // but not listed.
        if (!isLog || metadata.draft === true || metadata.hidden === true) continue;

        // Same URL rules as [...slug]/entries(), so a row can never point at a
        // path that was never prerendered (permalinks included).
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

    changelogs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    return { changelogs };
}
