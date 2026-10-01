// Free dictionary lookups for the PDF reader's selection tooltip.
//
// The viewer itself does NOT talk to any dictionary provider directly. It calls
// /api/v2/dictionary?word=… and this handler owns provider selection, response
// shaping and caching. Two reasons that split matters:
//
//   1. Reliability. Both upstreams are free and keyless, and both are flaky in
//      different ways: measured from this codebase dictionaryapi.dev answers in
//      ~26s when healthy and returns Cloudflare 522 (origin unreachable) often,
//      while Wiktionary's public REST endpoint consistently returned in ~4-5s.
//      The two are raced (see lookup()) so a slow or down provider cannot leave
//      the tooltip hanging or empty. No upstream failure is allowed to reach the
//      reader UI — the handler degrades to a plain "no definition found".
//
//   2. Edge cost. Every lookup is a public, immutable fact about a word, so
//      results are cached for a week through edge-cache (per-isolate map +
//      CDN s-maxage). Repeat lookups of common academic vocabulary never touch
//      an upstream again, which also keeps us well clear of both providers'
//      rate limits.
//
// Provider payloads are normalised to ONE shape here so the client never has to
// know which upstream answered:
//
//   { word, phonetic, phonetics: [{ text, audio }], sourceUrl,
//     meanings: [{ partOfSpeech, definitions: [{ definition, example,
//     synonyms: [], antonyms: [] }], synonyms: [], antonyms: [] }] }

import { cachedResponse, isCacheableRequest } from './edge-cache.js';

// A headword never changes meaning on any timescale that matters here.
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;

// Both providers are free-tier hosts that occasionally sit on a bad edge, and
// they race (see lookup()), so each budget must cover a SLOW-but-successful
// response rather than just a fast one. Measured from here: Wiktionary
// ~4-5s, dictionaryapi.dev ~26s when healthy. Anything under the real latency
// would discard perfectly good answers and always land on the other provider,
// so these are deliberately generous — a tooltip is a foreground interaction,
// but a cached week-long answer beats a fast failure that needs a refetch.
const PRIMARY_TIMEOUT_MS = 12000;
const FALLBACK_TIMEOUT_MS = 12000;

// Guardrail against abusing this endpoint as an open proxy for scraping.
const MAX_WORD_LENGTH = 64;
const MAX_DEFINITIONS_PER_POS = 6;
const MAX_POS_GROUPS = 5;
const MAX_SYNONYMS = 8;

// Guard against a Wiktionary entry that is a full treatise on an obscure word.
const MAX_DEFINITION_CHARS = 400;

// Wiktionary marks regional/usage qualifiers with <span class="usage-label-*">.
// Those spans are empty in the REST payload, so stripping tags leaves a leading
// space that would otherwise read as " Lasting for a short…".
const HTML_ENTITIES = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

export function normalizeWord(raw) {
	if (typeof raw !== 'string') return '';
	const cleaned = decodeURIComponentSafe(raw)
		.toLowerCase()
		.replace(/[‘’ʼ`]/g, "'")
		.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

	if (!cleaned || cleaned.length > MAX_WORD_LENGTH) return '';

	// A headword is a single token of letters, digits, apostrophes and
	// hyphens. Anything else (a path, a query, a space) is not a lookup — and
	// refusing it here means the upstream URL is built from a character set we
	// chose, not from whatever a caller sent.
	if (!/^[a-z0-9][a-z0-9'-]*$/.test(cleaned)) return '';

	return cleaned;
}

function decodeURIComponentSafe(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		// A stray '%' is not a reason to drop the whole word.
		return value;
	}
}

/**
 * Flattens provider HTML (Wiktionary) into plain text. Definitions arrive as
 * small fragments of MediaWiki markup — wiki links, italics, the odd
 * superscript footnote — which must never be injected as HTML into the
 * tooltip, so tags are removed and entities decoded instead.
 */
export function htmlToText(html) {
	if (typeof html !== 'string') return '';
	return html
		.replace(/<[^>]*>/g, '')
		.replace(/&#(\d+);/g, (_, code) => {
			const num = Number(code);
			return Number.isFinite(num) && num > 0 ? String.fromCodePoint(num) : '';
		})
		.replace(/&#x([0-9a-f]+);/gi, (_, code) => {
			const num = parseInt(code, 16);
			return Number.isFinite(num) && num > 0 ? String.fromCodePoint(num) : '';
		})
		.replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITIES[String(name).toLowerCase()] ?? match)
		.replace(/\s+/g, ' ')
		.trim();
}

function clampString(value, max) {
	if (typeof value !== 'string') return '';
	return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function uniqueStrings(values, limit) {
	const seen = new Set();
	const out = [];
	for (const value of Array.isArray(values) ? values : []) {
		const text = htmlToText(value);
		if (!text || seen.has(text)) continue;
		seen.add(text);
		out.push(text);
		if (out.length >= limit) break;
	}
	return out;
}

function finiteUrl(value) {
	if (typeof value !== 'string') return '';
	try {
		const url = new URL(value);
		// Only ever hand the client http(s) links it could follow.
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
	} catch {
		return '';
	}
}

// A truncated last definition reads worse than dropping it, but a page of
// etymology labelled "definition" is worse still — cap the text either way.
function tidyDefinition(text) {
	const trimmed = clampString(htmlToText(text), MAX_DEFINITION_CHARS);
	return trimmed;
}

async function fetchJson(url, timeoutMs, externalController) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	// The caller aborts the loser of the provider race; that has to reach the
	// in-flight request, so bridge the two signals.
	const onExternalAbort = () => controller.abort();
	if (externalController) {
		if (externalController.signal.aborted) controller.abort();
		else externalController.signal.addEventListener('abort', onExternalAbort);
	}

	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				accept: 'application/json',
				// Both hosts are Cloudflare-fronted; an explicit UA avoids
				// their default bot challenge on some edges.
				'user-agent': 'MaterioDictionary/1.0 (+https://getmaterio.app)'
			}
		});
		if (!response.ok) return null;
		return await response.json();
	} catch {
		// Timeout, abort, DNS, TLS, 5xx from the upstream — all equivalent here:
		// this provider did not answer, so the other one carries the lookup.
		return null;
	} finally {
		clearTimeout(timer);
		if (externalController) {
			try {
				externalController.signal.removeEventListener('abort', onExternalAbort);
			} catch {}
		}
	}
}

/** dictionaryapi.dev → the app's own normalised shape. */
function fromDictionaryApi(payload, word) {
	if (!Array.isArray(payload) || !payload.length) return null;

	let phonetic = '';
	const phonetics = [];

	for (const entry of payload) {
		if (!entry || typeof entry !== 'object') continue;
		if (!phonetic && typeof entry.phonetic === 'string') phonetic = entry.phonetic;
		for (const item of Array.isArray(entry.phonetics) ? entry.phonetics : []) {
			if (!item || typeof item !== 'object') continue;
			const text = typeof item.text === 'string' ? item.text : '';
			const audio = finiteUrl(item.audio);
			if (!text && !audio) continue;
			if (phonetics.some(p => p.text === text && p.audio === audio)) continue;
			phonetics.push({ text, audio });
			if (phonetics.length >= 4) break;
		}
		if (phonetics.length >= 4) break;
	}

	// Prefer the IPA that actually has audio so the pronounce button is not
	// a dead control; a bare "/" + audio-less variant is still better than none.
	if (!phonetic) {
		phonetic = phonetics.find(p => p.text)?.text || '';
	}
	if (!phonetic) {
		phonetic = phonetics.find(p => p.audio)?.text || '';
	}

	const meanings = [];
	for (const entry of payload) {
		for (const meaning of Array.isArray(entry?.meanings) ? entry.meanings : []) {
			if (!meaning || typeof meaning !== 'object') continue;
			const partOfSpeech = typeof meaning.partOfSpeech === 'string' ? meaning.partOfSpeech : '';
			if (!partOfSpeech) continue;
			const definitions = [];
			for (const def of Array.isArray(meaning.definitions) ? meaning.definitions : []) {
				const text = tidyDefinition(def?.definition);
				if (!text) continue;
				definitions.push({
					definition: text,
					example: clampString(htmlToText(def?.example), 200),
					synonyms: uniqueStrings(def?.synonyms, MAX_SYNONYMS),
					antonyms: uniqueStrings(def?.antonyms, MAX_SYNONYMS)
				});
				if (definitions.length >= MAX_DEFINITIONS_PER_POS) break;
			}
			if (!definitions.length) continue;
			meanings.push({
				partOfSpeech,
				definitions,
				synonyms: uniqueStrings(meaning.synonyms, MAX_SYNONYMS),
				antonyms: uniqueStrings(meaning.antonyms, MAX_SYNONYMS)
			});
			if (meanings.length >= MAX_POS_GROUPS) break;
		}
		if (meanings.length >= MAX_POS_GROUPS) break;
	}

	if (!meanings.length) return null;

	const sourceUrl = payload.find(entry => Array.isArray(entry?.sourceUrls) && entry.sourceUrls.length)?.sourceUrls?.[0] || '';

	return {
		word: typeof payload[0]?.word === 'string' ? payload[0].word : word,
		phonetic,
		phonetics,
		sourceUrl: finiteUrl(sourceUrl),
		meanings
	};
}

/** en.wiktionary.org REST → the app's own normalised shape. */
function fromWiktionary(payload, word) {
	const entries = Array.isArray(payload?.en) ? payload.en : [];
	if (!entries.length) return null;

	const meanings = [];
	for (const entry of entries) {
		const partOfSpeech = typeof entry?.partOfSpeech === 'string' ? entry.partOfSpeech : '';
		if (!partOfSpeech) continue;
		const definitions = [];
		for (const def of Array.isArray(entry.definitions) ? entry.definitions : []) {
			const text = tidyDefinition(def?.definition);
			if (!text) continue;
			definitions.push({ definition: text, example: '', synonyms: [], antonyms: [] });
			if (definitions.length >= MAX_DEFINITIONS_PER_POS) break;
		}
		if (!definitions.length) continue;
		meanings.push({ partOfSpeech, definitions, synonyms: [], antononyms: [] });
		if (meanings.length >= MAX_POS_GROUPS) break;
	}

	if (!meanings.length) return null;

	return {
		word,
		phonetic: '',
		phonetics: [],
		sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
		meanings
	};
}

/**
 * Queries both providers concurrently and keeps the first usable answer.
 *
 * A sequential primary -> fallback chain was tried first and is wrong for these
 * two upstreams: measured from here, dictionaryapi.dev takes ~26s when healthy
 * and Cloudflare 522s when not, while Wiktionary answers in ~4-5s. Serial order
 * therefore meant every cold lookup waited out a primary timeout, then used the
 * fallback anyway — paying the full penalty to end up in the same place.
 *
 * Racing instead means Wiktionary usually wins the race on speed while
 * dictionaryapi.dev still supplies the richer payload (phonetics, audio,
 * synonyms) whenever it happens to be fast. Both are aborted once one wins, so
 * at most one outbound socket stays open per provider and the 6-connection
 * Worker ceiling is never approached.
 *
 * A word missing from BOTH must not resolve early on the first rejection, so
 * the race waits for every source to settle before concluding "not found".
 */
async function lookup(word) {
	const sources = [
		{
			provider: 'dictionaryapi.dev',
			url: `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
			timeoutMs: PRIMARY_TIMEOUT_MS,
			parse: fromDictionaryApi
		},
		{
			provider: 'wiktionary',
			url: `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,
			timeoutMs: FALLBACK_TIMEOUT_MS,
			parse: fromWiktionary
		}
	];

	const controllers = sources.map(() =>
		typeof AbortController === 'function' ? new AbortController() : null
	);

	let winner = null;
	let settleWinner;
	const won = new Promise(resolve => {
		settleWinner = resolve;
	});

	const attempts = sources.map(async (source, index) => {
		const payload = await fetchJson(source.url, source.timeoutMs, controllers[index]);
		const data = source.parse(payload, word);
		if (data && !winner) {
			winner = { data, provider: source.provider };
			// Release the losing request's socket now that we have an answer.
			for (const controller of controllers) {
				try {
					controller?.abort();
				} catch {}
			}
			settleWinner(winner);
		}
	});

	// Return the instant ANY provider answers, not when the slowest one gives
	// up: awaiting all of them made every lookup take the full timeout of the
	// slow provider even though a good answer was already in hand.
	const allSettled = Promise.allSettled(attempts).then(() => {
		if (!winner) settleWinner(null);
	});

	return Promise.race([won, allSettled]);
}

function jsonResponse(body, status, extraHeaders = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			...extraHeaders
		}
	});
}

export async function handleDictionaryGet(event) {
	const url = new URL(event.request.url);
	const word = normalizeWord(url.searchParams.get('word') || '');

	if (!word) {
		return jsonResponse(
			{ ok: false, error: 'invalid_word', message: 'Provide a single word via ?word=' },
			400
		);
	}

	if (!isCacheableRequest(event.request, event.request.url)) {
		// Only reachable for an authenticated caller; skip the shared cache
		// rather than risk serving one user's answer from another's cache slot.
		const result = await lookup(word);
		if (!result) {
			return jsonResponse({ ok: false, error: 'not_found', word }, 404);
		}
		return jsonResponse({ ok: true, word, ...result.data, provider: result.provider });
	}

	const cached = await cachedResponse(event.request, CACHE_TTL_SECONDS, async () => {
		const result = await lookup(word);
		if (!result) {
			// 404 deliberately left uncached by cachedResponse, so a word that
			// gains an entry later is not pinned as missing for a week.
			return jsonResponse({ ok: false, error: 'not_found', word }, 404);
		}
		return jsonResponse({ ok: true, word, ...result.data, provider: result.provider });
	});

	return cached;
}

export async function handleDictionaryOptions(event) {
	return new Response(null, {
		status: 204,
		headers: {
			'access-control-allow-methods': 'GET, OPTIONS',
			'access-control-max-age': '86400'
		}
	});
}