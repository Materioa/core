import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

// Content readers (docs, changelog, the catch-all post route) all need
// <repo>/src. They run in three very different places:
//
//   - `vite dev`   -> module sits at src/routes/<route>/+page.server.js
//   - `vite build` -> module is emitted to .svelte-kit/output/server/entries/
//                     pages/<route>/ (or into chunks/), so `../../posts`
//                     resolves inside .svelte-kit/output and misses the content
//   - worker bundle-> bundled output again, path unrelated to src/
//
// Resolving off `import.meta.url` therefore only worked in dev: at build time
// existsSync() returned false, every reader silently reported "no content",
// /docs and /changelog came back with empty lists and [...slug]/entries()
// emitted nothing — so no post page was prerendered and they all 404'd.
// Walk up the tree until the src/ holding posts/pages turns up instead.
function findSrcDir(start) {
	let dir = path.resolve(start);
	for (let i = 0; i < 24; i++) {
		const src = path.join(dir, 'src');
		if (fs.existsSync(path.join(src, 'posts')) || fs.existsSync(path.join(src, 'pages'))) {
			return src;
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = findSrcDir(selfDir) || findSrcDir(process.cwd()) || path.join(process.cwd(), 'src');

export const SRC_ROOT = SRC_DIR;
export const POSTS_DIR = path.join(SRC_DIR, 'posts');
export const PAGES_DIR = path.join(SRC_DIR, 'pages');
export const ROUTES_DIR = path.join(SRC_DIR, 'routes');
export const STATIC_DIR = path.resolve(SRC_DIR, '..', 'static');

/**
 * Cover image for a content file, or null when it can't be shown.
 *
 * Covers are referenced by hand (`/assets/img/covers/…`), so a renamed or
 * deleted file rendered as a broken-image icon in the docs and changelog
 * grids. Local `/assets/…` paths are checked against static/ and dropped when
 * they're gone — the grids then fall back to their own placeholder. External
 * (https) URLs and other paths pass through untouched.
 */
export function coverUrl(metadata) {
    const url = metadata.cover || metadata.image || null;
    if (!url || !String(url).startsWith('/assets/')) return url;
    const onDisk = path.join(STATIC_DIR, String(url).replace(/^\//, ''));
    return fs.existsSync(onDisk) ? url : null;
}

/**
 * Canonical URL for a content file, without leading/trailing slashes.
 *
 * entries() and load() must agree byte-for-byte — a page emitted under a path
 * load() can't match comes back as a 404 — so both sides go through here.
 *
 * It also flattens leftovers from the old Jekyll site: `/code-craftsmanship/:title`
 * has to resolve to a real path (`:title` is the slug), because a literal `:` is
 * not a legal filename character on Windows and the prerenderer writes one file
 * per entry.
 */
function cleanUrl(url) {
    return String(url)
        .replace(/^\//, '')
        .replace(/\/$/, '')
        .split('/')
        .map((seg) => seg.replace(/[<>:"|?*#%]+/g, '-'))
        .join('/');
}

/** URL for a post: permalink, else `category/slug`, else `slug`. */
export function postUrl(metadata, slug) {
    if (metadata.permalink) {
        return cleanUrl(metadata.permalink.replace(/:title\b/g, slug));
    }
    return metadata.category ? `${String(metadata.category).toLowerCase()}/${slug}` : slug;
}

/** URL for a standalone page: permalink, else the filename stem. */
export function pageUrl(metadata, filename) {
    return metadata.permalink
        ? cleanUrl(metadata.permalink)
        : cleanUrl(filename.replace(/\.md$/, ''));
}

/** Markdown filenames in `dir`, deterministic order, [] when the dir is absent. */
export function contentFiles(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((file) => file.endsWith('.md'))
		.sort();
}

/**
 * True when `slug` is served by a real route of its own (src/routes/<slug>/+page.*).
 * Those win over the catch-all, so listing them as catch-all entries would only
 * fight them for the same output path.
 */
export function isStaticRoute(slug) {
	const segments = String(slug).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
	if (segments.length === 0) return true;
	const dir = path.join(ROUTES_DIR, ...segments);
	return ['+page.svelte', '+page.js', '+page.server.js'].some((file) =>
		fs.existsSync(path.join(dir, file))
	);
}
