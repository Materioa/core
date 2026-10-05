import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';
import { POSTS_DIR, contentFiles, postUrl, coverUrl } from '$lib/server/content.js';

// Docs are authored with either the long or the short category name — both
// count, so a post filed under `docs:` still shows up in the grid.
const DOC_CATEGORIES = new Set(['documentation', 'docs']);

const isDocCategory = (value) => DOC_CATEGORIES.has(String(value || '').toLowerCase());

export async function load() {
    const docs = [];

    for (const filename of contentFiles(POSTS_DIR)) {
        const rawContent = fs.readFileSync(path.join(POSTS_DIR, filename), 'utf-8');

        const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
        let slug = slugMatch ? slugMatch[1] : filename.replace('.md', '');

        const { data: metadata, content } = matter(rawContent);

        const category = metadata.category || '';
        const categories = metadata.categories || [];
        const listed = isDocCategory(category) || categories.some(isDocCategory);

        if (listed && metadata.draft !== true && metadata.hidden !== true) {
            // Same URL rules as [...slug]/entries(), so a card can never link to
            // a path that was never prerendered.
            const url = `/${postUrl(metadata, slug)}`;

            // Strip HTML and get excerpt
            const rawText = content.replace(/<[^>]*>?/gm, '').trim();
            const excerpt = metadata.excerpt || (rawText.slice(0, 160) + '...');

            // Missing local covers are nulled here so the card renders its
            // placeholder instead of a broken <img>.
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

    // Sort by date descending
    docs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    return {
        docs
    };
}
