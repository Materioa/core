import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

// Resolved from this file's location, not the process working directory,
// so content loads no matter where the dev server was launched from.
const POSTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../posts');

export async function load() {
    const postsDir = POSTS_DIR;
    let docs = [];
    
    if (fs.existsSync(postsDir)) {
        const files = fs.readdirSync(postsDir).filter(file => file.endsWith('.md'));
        
        for (const filename of files) {
            const rawContent = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
            
            const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
            let slug = slugMatch ? slugMatch[1] : filename.replace('.md', '');
            
            const { data: metadata, content } = matter(rawContent);
            
            const category = metadata.category || '';
            const categories = metadata.categories || [];
            const isDoc = category === 'Documentation' || categories.includes('Documentation');
            
            if (isDoc && metadata.draft !== true && metadata.hidden !== true) {
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

                // Strip HTML and get excerpt
                const rawText = content.replace(/<[^>]*>?/gm, '').trim();
                const excerpt = metadata.excerpt || (rawText.slice(0, 160) + '...');
                
                docs.push({
                    ...metadata,
                    slug,
                    url,
                    excerpt
                });
            }
        }
    }
    
    // Sort by date descending
    docs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    
    return {
        docs
    };
}
