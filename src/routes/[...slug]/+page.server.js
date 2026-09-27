import { error } from '@sveltejs/kit';
import matter from 'gray-matter';
import { marked } from 'marked';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

export const prerender = true;

// Resolved from this file's location, not the process working directory,
// so content loads no matter where the dev server was launched from.
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function entries() {
    const slugs = [];
    const postsDir = path.join(SRC_DIR, 'posts');
    if (fs.existsSync(postsDir)) {
        const files = fs.readdirSync(postsDir).filter(file => file.endsWith('.md'));
        for (const filename of files) {
            const rawContent = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
            const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
            const extractedSlug = slugMatch ? slugMatch[1] : filename.replace('.md', '');
            const { data: metadata } = matter(rawContent);
            let url = metadata.permalink;
            if (!url) {
                if (metadata.category) {
                    url = `${metadata.category.toLowerCase()}/${extractedSlug}`;
                } else {
                    url = `${extractedSlug}`;
                }
            } else {
                url = url.replace(/^\//, '').replace(/\/$/, '');
            }
            slugs.push({ slug: url });
        }
    }
    const pagesDir = path.join(SRC_DIR, 'pages');
    if (fs.existsSync(pagesDir)) {
        const pageFiles = fs.readdirSync(pagesDir).filter(file => file.endsWith('.md'));
        for (const filename of pageFiles) {
            const rawContent = fs.readFileSync(path.join(pagesDir, filename), 'utf-8');
            const { data: metadata } = matter(rawContent);
            let url = metadata.permalink ? metadata.permalink.replace(/^\//, '').replace(/\/$/, '') : filename.replace('.md', '');
            slugs.push({ slug: url });
        }
    }
    return slugs;
}

export async function load({ params }) {
    const slug = params.slug.replace(/\/$/, ''); // Normalize trailing slash
    
    // First search in posts
    const postsDir = path.join(SRC_DIR, 'posts');
    if (fs.existsSync(postsDir)) {
        const files = fs.readdirSync(postsDir).filter(file => file.endsWith('.md'));
        const index = [];
        for (const filename of files) {
            const rawContent = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
            const slugMatch = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
            const extractedSlug = slugMatch ? slugMatch[1] : filename.replace('.md', '');
            const { data: metadata } = matter(rawContent);
            let url = metadata.permalink;
            if (!url) {
                if (metadata.category) {
                    url = `${metadata.category.toLowerCase()}/${extractedSlug}`;
                } else {
                    url = `${extractedSlug}`;
                }
            } else {
                url = url.replace(/^\//, '').replace(/\/$/, '');
            }
            index.push({ filename, extractedSlug, url, date: metadata.date ? new Date(metadata.date).getTime() : 0 });
        }
        index.sort((a, b) => b.date - a.date);
        const hit = index.find((entry) => entry.url === slug || entry.extractedSlug === slug);
        if (hit) {
            const rawContent = fs.readFileSync(path.join(postsDir, hit.filename), 'utf-8');
            const { data: metadata, content } = matter(rawContent);
            const html = marked(content);
            const at = index.indexOf(hit);
            return {
                metadata,
                html,
                type: 'post',
                layout: 'bare',
                previous_post: at < index.length - 1 ? `/${index[at + 1].url}` : null,
                next_post: at > 0 ? `/${index[at - 1].url}` : null
            };
        }
    }
    
    // Then search in standalone pages
    const pagesDir = path.join(SRC_DIR, 'pages');
    if (fs.existsSync(pagesDir)) {
        const pageFiles = fs.readdirSync(pagesDir).filter(file => file.endsWith('.md'));
        for (const filename of pageFiles) {
            const rawContent = fs.readFileSync(path.join(pagesDir, filename), 'utf-8');
            const { data: metadata, content } = matter(rawContent);
            
            let url = metadata.permalink ? metadata.permalink.replace(/^\//, '').replace(/\/$/, '') : filename.replace('.md', '');
            
            if (url === slug) {
                const html = marked(content);
                return {
                    metadata,
                    html,
                    type: 'page',
                    layout: 'bare'
                };
            }
        }
    }
    
    throw error(404, 'Post or page not found');
}
