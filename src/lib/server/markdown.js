import { marked } from 'marked';

/**
 * Markdown pipeline for rendered posts and pages.
 *
 * `marked` only speaks CommonMark, but Materio content also relies on three
 * conventions the bare call never handled — which is why `[video: ...]` and
 * `[attachment: ...]` were coming through as literal text and ```mermaid fences
 * stayed as code blocks:
 *
 *   [video: /assets/media/demo.webm]           -> <figure class="post-video">
 *   [video: /assets/media/demo.webm: caption]  ->      + <figcaption>
 *   [attachment: /files/report.pdf]            -> styled download link
 *   [attachment: /files/report.pdf: Report]    ->      + display name
 *   ```mermaid ... ```                          -> <div class="mermaid-diagram mermaid">
 *
 * Ordering matters:
 *  - Fenced blocks and inline code are pulled aside FIRST, so an example like
 *    `[video: /path/to/video.mp4]` inside a code sample keeps rendering as
 *    text instead of turning into a real player.
 *  - The tags become raw HTML before marked runs; marked passes HTML through
 *    untouched, and doing it this way stops the `[...]` syntax from being
 *    re-read as a link/reference and mangled.
 *  - Fences go back before marked so code blocks (including mermaid) are
 *    parsed normally, then the mermaid one is re-shaped afterwards: it has to
 *    survive code-block escaping first, and asset-loader.js only initializes
 *    `.mermaid` / `.mermaid-diagram` elements — a `<pre><code
 *    class="language-mermaid">` would never reach mermaid at all.
 */

const VIDEO_TAG = /\[\s*video\s*:\s*([^\]]*?)\s*\]/g;
const ATTACH_TAG = /\[\s*attachment\s*:\s*([^\]]*?)\s*\]/g;

/**
 * Split a tag body into `{ url, label }`.
 *
 * The `:` separator is ambiguous — `https://…` contains one too — so:
 *  - an absolute URL is the first whitespace-delimited token (URLs cannot
 *    contain spaces), and anything after it is the label;
 *  - a relative path splits at the first colon, which keeps both
 *    `/clip.webm:cover` and `/clip.webm: shortcuts preview` working.
 */
function splitTag(inner) {
	const s = String(inner || '').trim();
	const absolute = s.match(/^(\w+:\/\/\S+)(?:\s+([\s\S]*))?$/);
	if (absolute) return { url: absolute[1], label: (absolute[2] || '').trim() };
	const i = s.indexOf(':');
	if (i === -1) return { url: s, label: '' };
	return { url: s.slice(0, i).trim(), label: s.slice(i + 1).trim() };
}

const FENCE_RE = /(^|\n)([ \t]*(?:```|~~~)[\s\S]*?[ \t]*(?:```|~~~)[ \t]*)(?=\n|$)/g;
const INLINE_CODE_RE = /(`+)(?:(?!\1)[\s\S])*\1/g;

// Nothing here is ever HTML, but attribute/text escaping is cheap insurance —
// these URLs come straight out of author-written markdown.
const escAttr = (v) =>
	String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escText = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function videoType(url) {
	const ext = String(url).split('?')[0].split('.').pop()?.toLowerCase();
	if (ext === 'webm') return 'video/webm';
	if (ext === 'mov') return 'video/quicktime';
	return 'video/mp4';
}

function videoHtml(inner) {
	const { url, label } = splitTag(inner);
	if (!url) return '';
	// `controls muted loop` keeps an inline clip readable (sound on demand) and
	// silent-by-default, matching how covers behave on the reading page.
	return (
		`<figure class="post-video"><video controls muted loop playsinline preload="metadata">` +
		`<source src="${escAttr(url)}" type="${videoType(url)}">` +
		`</video>` +
		(label ? `<figcaption class="post-video-caption">${escText(label)}</figcaption>` : '') +
		`</figure>`
	);
}

const CLIP_SVG =
	'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

function attachmentHtml(inner) {
	const split = splitTag(inner);
	if (!split.url) return '';
	const url = split.url;
	const label =
		split.label || decodeURIComponent(String(url).split('?')[0].split('/').pop() || 'Download');
	const external = /^https?:/i.test(url);
	return (
		`<a class="post-attachment" href="${escAttr(url)}"` +
		(external ? ` target="_blank" rel="noopener"` : '') +
		` download>${CLIP_SVG}<span>${escText(label)}</span></a>`
	);
}

/** Hide fenced blocks + inline code so the tag swap can't touch real code samples. */
function shieldCode(src) {
	const stash = [];
	const park = (block) => {
		stash.push(block);
		return `\u0000${stash.length - 1}\u0000`;
	};
	let out = src.replace(FENCE_RE, (m, lead, fence) => lead + park(fence));
	out = out.replace(INLINE_CODE_RE, (m) => park(m));
	return { source: out, stash };
}

const unshield = (source, stash) =>
	source.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)] ?? '');

export function renderMarkdown(source, { title } = {}) {
	let src = String(source ?? '');

	// The layout already prints the document title. When a page's body opens
	// with the very same H1 (privacy.md does), the name would show twice — so
	// legal pages all end up shaped the same way.
	const wanted = String(title || '').trim().toLowerCase();
	if (wanted) {
		// Require the newline (or end of input) after the heading — an all-optional
		// tail would let the lazy `.+?` stop after a single character.
		src = src.replace(/^\s*#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/, (match, heading) =>
			heading.replace(/[*_`]/g, '').trim().toLowerCase() === wanted ? '' : match
		);
	}

	const { source: shielded, stash } = shieldCode(src);
	const withTags = shielded
		.replace(VIDEO_TAG, (_, inner) => videoHtml(inner))
		.replace(ATTACH_TAG, (_, inner) => attachmentHtml(inner));

	return marked(unshield(withTags, stash)).replace(
		/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
		(_, body) => `<div class="mermaid-diagram mermaid">${body}</div>`
	);
}
