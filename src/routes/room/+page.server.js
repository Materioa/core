import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';
import { getMongoDb } from '$lib/server/mongodb.js';

export async function load() {
    let posts = [];
    const seenSlugs = new Set();

    // 1. Load from MongoDB
    try {
        const db = await getMongoDb();
        const mongoPosts = await db.collection('exodus_posts')
            .find({
                draft: { $ne: true },
                hidden: { $ne: true },
                visibility: { $ne: 'private' }
            })
            .sort({ date: -1 })
            .toArray();

        for (const p of mongoPosts) {
            seenSlugs.add(p.slug);
            let url = p.url;
            if (!url) {
                if (p.category) {
                    url = `/${String(p.category).toLowerCase()}/${p.slug}`;
                } else {
                    url = `/${p.slug}`;
                }
            } else {
                url = '/' + String(url).replace(/^\/+/, '').replace(/\/+$/, '');
            }

            posts.push({
                ...(p.metadata || {}),
                title: p.title,
                slug: p.slug,
                date: p.date,
                category: p.category,
                image: p.image || null,
                cover: p.image || null,
                excerpt: p.excerpt || '',
                visibility: p.visibility || 'public',
                url
            });
        }
    } catch (e) {
        console.warn('[Room Load] Mongo fetch failed, falling back to disk:', e.message);
    }

    // 2. Fallback / Merge with disk files
    const postsDir = path.resolve('src/posts');
    if (fs.existsSync(postsDir)) {
        const files = fs.readdirSync(postsDir).filter(file => file.endsWith('.md'));
        
        for (const filename of files) {
            const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
            let slug = slugMatch ? slugMatch[1] : filename.replace('.md', '');
            if (seenSlugs.has(slug)) continue;
            
            const rawContent = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
            const { data: metadata } = matter(rawContent);
            
            if (metadata.draft !== true && metadata.hidden !== true && metadata.visibility !== 'private') {
                let url = metadata.permalink;
                if (!url) {
                    if (metadata.category) {
                        url = `/${metadata.category.toLowerCase()}/${slug}`;
                    } else {
                        url = `/${slug}`;
                    }
                } else {
                    url = url.replace(/^\//, '').replace(/\/$/, '');
                    url = `/${url}`;
                }
                
                posts.push({
                    ...metadata,
                    slug,
                    url
                });
            }
        }
    }
    
    // Sort by date descending
    posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    
    return {
        posts
    };
}
