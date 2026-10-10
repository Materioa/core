import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

function findSrcDir(start) {
	if (!start) return null;
	try {
		let dir = path.resolve(start);
		for (let i = 0; i < 24; i++) {
			const src = path.join(dir, 'src');
			if (fs?.existsSync && (fs.existsSync(path.join(src, 'posts')) || fs.existsSync(path.join(src, 'pages')))) {
				return src;
			}
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	} catch (e) {
		return null;
	}
	return null;
}

const metaUrl = typeof import.meta !== 'undefined' && import.meta?.url ? import.meta.url : null;
let selfDir = null;
try {
	if (metaUrl) selfDir = path.dirname(fileURLToPath(metaUrl));
} catch (e) {
	selfDir = null;
}
const cwd = typeof process !== 'undefined' && process?.cwd ? process.cwd() : '';
const SRC_DIR = (selfDir && findSrcDir(selfDir)) || (cwd && findSrcDir(cwd)) || (cwd ? path.join(cwd, 'src') : 'src');

export const SRC_ROOT = SRC_DIR;
export const POSTS_DIR = path.join(SRC_DIR, 'posts');
export const PAGES_DIR = path.join(SRC_DIR, 'pages');
export const ROUTES_DIR = path.join(SRC_DIR, 'routes');
export const STATIC_DIR = path.resolve(SRC_DIR, '..', 'static');

export function coverUrl(metadata) {
    const url = metadata?.cover || metadata?.image || null;
    if (!url || !String(url).startsWith('/assets/')) return url;
    try {
        if (typeof fs !== 'undefined' && fs?.existsSync) {
            const onDisk = path.join(STATIC_DIR, String(url).replace(/^\//, ''));
            return fs.existsSync(onDisk) ? url : url;
        }
    } catch (e) {
        return url;
    }
    return url;
}

function cleanUrl(url) {
    return String(url)
        .replace(/^\//, '')
        .replace(/\/$/, '')
        .split('/')
        .map((seg) => seg.replace(/[<>:"|?*#%]+/g, '-'))
        .join('/');
}

export function postUrl(metadata, slug) {
    if (metadata?.permalink) {
        return cleanUrl(metadata.permalink.replace(/:title\b/g, slug));
    }
    return metadata?.category ? `${String(metadata.category).toLowerCase()}/${slug}` : slug;
}

export function pageUrl(metadata, filename) {
    return metadata?.permalink
        ? cleanUrl(metadata.permalink)
        : cleanUrl(filename.replace(/\.md$/, ''));
}

export function contentFiles(dir) {
	try {
		if (!fs?.existsSync || !fs.existsSync(dir)) return [];
		return fs
			.readdirSync(dir)
			.filter((file) => file.endsWith('.md'))
			.sort();
	} catch (e) {
		return [];
	}
}

export function isStaticRoute(slug) {
	try {
		const segments = String(slug).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
		if (segments.length === 0) return true;
		const dir = path.join(ROUTES_DIR, ...segments);
		if (!fs?.existsSync) return false;
		return ['+page.svelte', '+page.js', '+page.server.js'].some((file) =>
			fs.existsSync(path.join(dir, file))
		);
	} catch (e) {
		return false;
	}
}
