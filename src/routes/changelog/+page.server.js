import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

// Resolved from this file's location, not the process working directory,
// so content loads no matter where the dev server was launched from.
const POSTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../posts');

export async function load() {
    const postsDir = POSTS_DIR;
    let changelogs = [];

    if (fs.existsSync(postsDir)) {
        const files = fs.readdirSync(postsDir).filter((file) => file.endsWith('.md'));

        for (const filename of files) {
            const rawContent = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
            const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
            const slug = slugMatch ? slugMatch[1] : filename.replace('.md', '');
            const { data: metadata, content } = matter(rawContent);

            const category = metadata.category || '';
            const categories = metadata.categories || [];
            const isLog = category === 'whats-new' || categories.includes('whats-new');
            if (!isLog || metadata.draft === true) continue;

            const rawText = content.replace(/<[^>]*>?/gm, '').trim();
            changelogs.push({
                title: metadata.title || slug,
                date: metadata.date || null,
                image: metadata.cover || metadata.image || null,
                excerpt: metadata.excerpt || (rawText.slice(0, 320) + '...'),
                url: `/${(metadata.category || '').toLowerCase() || 'whats-new'}/${slug}`
            });
        }
    }

    changelogs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    return { changelogs };
}
