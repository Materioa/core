import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';

export async function load() {
    const postsDir = path.resolve('src/posts');
    let posts = [];
    
    if (fs.existsSync(postsDir)) {
        const files = fs.readdirSync(postsDir).filter(file => file.endsWith('.md'));
        
        for (const filename of files) {
            const rawContent = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
            
            // Jekyll filenames typically have date prefix: YYYY-MM-DD-title
            const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
            let slug = slugMatch ? slugMatch[1] : filename.replace('.md', '');
            
            const { data: metadata } = matter(rawContent);
            
            if (metadata.draft !== true && metadata.hidden !== true) {
                // Determine URL
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
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return {
        posts
    };
}
