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

// ---- Google Dictionary extension endpoint ----------------------------------
// A THIRD provider, enabled only when GOOGLE_DICT_KEY is present in the server
// env. It is the richest source available here (Oxford entries: IPA, etymology,
// thesaurus, native-speaker audio) and the fastest, but it is an UNDOCUMENTED
// Google endpoint whose credential belongs to another product, so it stays
// opt-in and never required: leave the env var unset and behaviour is exactly as
// before, and the keyless providers remain in the race so a revocation degrades
// quality rather than breaking lookups.
//
// Two constraints are load-bearing and easy to rediscover the hard way:
//
//   1. The key is referrer-restricted, enforced through a bespoke `x-referer`
//      header (NOT the HTTP Referer). Missing it returns 403
//      API_KEY_HTTP_REFERRER_BLOCKED; so does any other extension's ID. There is
//      no proof-of-possession — the value is simply asserted.
//
//   2. The endpoint rejects any request carrying an `Origin` header with
//      400 "Origin doesn't match Host for XD3". That is the entire reason this
//      lookup lives in the Worker and never in the client: the desktop WebView
//      (tauri://) and the browser both attach Origin unconditionally, and
//      neither can be talked out of it.
//
// The default below is Google's published Chrome-extension ID; override with
// GOOGLE_DICT_X_REFERER if Google rotates it.
const GOOGLE_DICT_ENDPOINT =
	'https://dictionaryextension-pa.googleapis.com/v2/dictionaryExtensionData';
const GOOGLE_DICT_DEFAULT_X_REFERER = 'chrome-extension://mgijmajocgfcbeboacabfgobmjgjcoja';
const GOOGLE_DICT_TIMEOUT_MS = 8000;
const GOOGLE_DICT_DEFAULT_CORPUS = 'en-US';

/**
 * Resolves a server-side secret.
 *
 * Read lazily through a getter rather than captured at module load: capture
 * freezes the value at import time, which is wrong for a secret that rotates
 * between deploys inside a warm isolate. It also keeps this module free of the
 * `$env/dynamic/private` import — a SvelteKit virtual module that the plain-Node
 * test scripts in scripts/ cannot resolve, and they import this handler directly.
 *
 * Wrangler populates `process.env` from vars AND secrets because the worker
 * enables `nodejs_compat` (see wrangler.jsonc), so the deployed path and a local
 * `.env` both land here. `globalThis.env` covers harnesses that inject bindings
 * without nodejs_compat.
 */
function secret(name) {
	try {
		const v = process?.env?.[name] || globalThis?.env?.[name] || '';
		return typeof v === 'string' ? v.trim() : v;
	} catch {
		return '';
	}
}

/**
 * True when GOOGLE_DICT_KEY is present AND shaped like the browser key this
 * endpoint wants.
 *
 * This guard exists because a key pasted with a stray newline or surrounding
 * quotes makes Google answer `400 API_KEY_INVALID` rather than `403` — the same
 * shape as a revoked credential. Requiring the exact 39-char shape means such a
 * value disables the provider cleanly instead of adding a silent 400 to every
 * lookup.
 */
function googleDictKey() {
	const raw = secret('GOOGLE_DICT_KEY');
	if (!raw) return '';
	// A Google API key is exactly 39 base64url characters. Anything else earns a
	// 400 API_KEY_INVALID — including one carrying a stray newline or quote from
	// shell-quoting, which is easy to mistake for a revoked key. Strip
	// quotes/whitespace, then require the exact length and alphabet.
	//
	// Deliberately prefix-agnostic: the purpose is to catch copy-paste artefacts,
	// not to second-guess Google's key format, so this stays right if they ever
	// change it.
	const cleaned = raw.replace(/^["'\s]+|["'\s]+$/g, '');
	return /^[0-9A-Za-z_-]{39}$/.test(cleaned) ? cleaned : '';
}

function googleDictEnabled() {
	return !!googleDictKey();
}

/** Whether the optional Google provider is configured at all. */
export function isGoogleDictEnabled() {
	return googleDictEnabled();
}

function googleDictXReferer() {
	return secret('GOOGLE_DICT_X_REFERER') || GOOGLE_DICT_DEFAULT_X_REFERER;
}

/** Corpus values known to work, plus the country hint each implies. */
const GOOGLE_DICT_CORPUS = { 'en-US': 'US', en: 'UK' };

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

/**
 * The upstream returns protocol-relative audio URLs (`//ssl.gstatic.com/…`).
 * `new URL()` rejects those — no scheme — so passing one straight to finiteUrl()
 * silently drops the recording. Normalise to https first, then validate.
 */
function httpsUrl(value) {
	if (typeof value !== 'string' || !value) return '';
	return value.startsWith('//') ? `https:${value}` : value;
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

async function fetchJson(url, timeoutMs, externalController, extraHeaders = null) {
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
				'user-agent': 'MaterioDictionary/1.0 (+https://getmaterio.app)',
				...(extraHeaders || {})
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

/**
 * Builds the Google endpoint URL.
 *
 * `corpus` reads like an optional extra but is NOT: omitting it returns the
 * 20-byte { "status": 404 } miss envelope (verified live), so it is always sent.
 * `language` only matters for translation mode. `strategy` must be 0, 1 or 2 —
 * any other value is a 400 enum error — and all three return identical data.
 */
function googleDictUrl(word, options = {}) {
	const language = options.language || 'en';
	const corpus = options.corpus || GOOGLE_DICT_DEFAULT_CORPUS;
	const url = new URL(GOOGLE_DICT_ENDPOINT);
	url.searchParams.set('term', word);
	url.searchParams.set('language', language);
	url.searchParams.set('corpus', corpus);
	const country = GOOGLE_DICT_CORPUS[corpus];
	if (country) url.searchParams.set('country', country);
	url.searchParams.set('strategy', '2');
	url.searchParams.set('key', googleDictKey());
	return url.toString();
}

/**
 * dictionaryextension-pa → the app's own normalised shape.
 *
 * Same upstream the BYO slot can be pointed at, but with the credential supplied
 * by the server env rather than the client, so this path IS cacheable and the key
 * never reaches a shipped binary.
 *
 * Deliberately permissive: the endpoint is undocumented and can change without
 * notice, so every field is probed defensively and an unrecognised body yields
 * "no definition" rather than throwing.
 */
function fromGoogleDict(payload, word, options = {}) {
	if (!payload || typeof payload !== 'object') return null;

	// A MISS ARRIVES AS HTTP 200 with a 20-byte { "status": 404 } body, so the
	// HTTP status proves nothing. The envelope's own `status` is the only
	// reliable hit/miss signal, and an absent payload here must mean "not
	// found" — never "fall through and try another provider".
	if (payload.status !== 200) return null;

	const dictionaryData = Array.isArray(payload.dictionaryData) ? payload.dictionaryData[0] : null;

	if (dictionaryData && !dictionaryData.error) {
		const entry = Array.isArray(dictionaryData.entries) ? dictionaryData.entries[0] : null;
		const groups = entry && Array.isArray(entry.senseFamilies) ? entry.senseFamilies : [];

		const meanings = [];
		for (const family of groups) {
			if (!family || !Array.isArray(family.senses)) continue;

			// The API field is `partsOfSpeech`, an array of { value } objects.
			// (The upstream extension's own template asks for `partsOfSpeechs`,
			// which never matches, so its POS label silently never renders — do
			// not copy that name.)
			const posList = Array.isArray(family.partsOfSpeech) ? family.partsOfSpeech : [];
			const pos = htmlToText(posList.find(p => p?.value)?.value || '');

			const definitions = [];
			for (const sense of family.senses) {
				const text = tidyDefinition(sense?.definition?.text || '');
				if (!text) continue;

				// One usage example per sense, when the corpus carries any.
				let example = '';
				for (const group of Array.isArray(sense.exampleGroups) ? sense.exampleGroups : []) {
					const found = (Array.isArray(group?.examples) ? group.examples : [])
						.map(htmlToText)
						.find(Boolean);
					if (found) {
						example = clampString(found, 200);
						break;
					}
				}

				// Thesaurus sits on the sense, not the family, and only some
				// senses carry it.
				const nyms = [];
				for (const thesaurus of Array.isArray(sense.thesaurusEntries) ? sense.thesaurusEntries : []) {
					for (const syn of Array.isArray(thesaurus?.synonyms) ? thesaurus.synonyms : []) {
						for (const nym of Array.isArray(syn?.nyms) ? syn.nyms : []) {
							const label = htmlToText(nym?.nym || '');
							if (label) nyms.push(label);
						}
					}
				}

				definitions.push({
					definition: text,
					example,
					synonyms: uniqueStrings(nyms, MAX_SYNONYMS),
					antonyms: []
				});
				if (definitions.length >= MAX_DEFINITIONS_PER_POS) break;
			}

			if (!definitions.length) continue;
			// Fall back to a generic label rather than skipping: the card draws a
			// POS heading per group, so dropping one would strand its definitions
			// under no heading at all.
			meanings.push({
				partOfSpeech: pos || 'definition',
				definitions,
				synonyms: [],
				antonyms: []
			});
			if (meanings.length >= MAX_POS_GROUPS) break;
		}

		// Last resort: a scraped web definition when no licensed entry applied.
		if (!meanings.length) {
			const web = Array.isArray(dictionaryData.webDefinitions) ? dictionaryData.webDefinitions[0] : null;
			const text = tidyDefinition(web?.definition || '');
			if (text) {
				meanings.push({
					partOfSpeech: 'definition',
					definitions: [{ definition: text, example: '', synonyms: [], antonyms: [] }],
					synonyms: [],
					antonyms: []
				});
			}
		}

		if (!meanings.length) return null;

		// Phonetics live on the entry; audio URLs arrive protocol-relative.
		const phonetics = [];
		for (const item of Array.isArray(entry?.phonetics) ? entry.phonetics : []) {
			if (!item || typeof item !== 'object') continue;
			const text = typeof item.text === 'string' ? item.text : '';
			const audio = finiteUrl(httpsUrl(item.oxfordAudio || ''));
			if ((!text && !audio) || phonetics.some(p => p.text === text && p.audio === audio)) continue;
			phonetics.push({ text, audio });
			if (phonetics.length >= 4) break;
		}

		// In translation mode the only recording sits at the top level.
		const topAudio = finiteUrl(httpsUrl(payload.oxfordAudio || ''));
		if (topAudio && !phonetics.some(p => p.audio === topAudio)) {
			phonetics.unshift({ text: '', audio: topAudio });
		}

		const sourceUrl =
			options.language && options.language !== 'en'
				? `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(options.language)}&text=${encodeURIComponent(word)}`
				: `https://www.google.com/search?q=${encodeURIComponent(`define ${word}`)}`;

		return {
			word: typeof entry?.headword === 'string' && entry.headword ? entry.headword : word,
			// Prefer an IPA that actually has audio so the play button is never dead.
			phonetic: (phonetics.find(p => p.text && p.audio) || phonetics.find(p => p.text) || {}).text || '',
			phonetics: phonetics.slice(0, 5),
			sourceUrl,
			meanings
		};
	}

	// Translation-shaped response: surface it as a single "translation" sense so
	// the same card renders it without a second code path.
	const translation = payload.translateResponse;
	if (translation && typeof translation === 'object') {
		const text = clampString(htmlToText(translation.translateText || ''), MAX_DEFINITION_CHARS);
		if (!text) return null;

		// uniqueStrings() takes plain strings, not objects.
		const terms = Array.isArray(translation.bilingualDictionary)
			? translation.bilingualDictionary.flatMap(entry =>
				(Array.isArray(entry?.terms) ? entry.terms : [])
			)
			: [];

		const audio = finiteUrl(httpsUrl(payload.oxfordAudio || ''));
		const detected = htmlToText(translation.detectedSourceLanguage || 'auto');
		const target = htmlToText(translation.outputLanguage || options.language || '');

		return {
			word,
			phonetic: '',
			phonetics: audio ? [{ text: '', audio }] : [],
			sourceUrl: target
				? `https://translate.google.com/?sl=${encodeURIComponent(detected)}&tl=${encodeURIComponent(target)}&text=${encodeURIComponent(word)}`
				: '',
			meanings: [{
				partOfSpeech: 'translation',
				definitions: [{ definition: text, example: '', synonyms: [], antonyms: [] }],
				synonyms: [],
				antonyms: []
			}],
			translationTerms: uniqueStrings(terms, MAX_SYNONYMS)
		};
	}

	return null;
}

/**
 * Normalises a raw upstream payload, exported for tests.
 *
 * The parsing rules are the only part of this provider that encodes upstream
 * quirks — protocol-relative audio, the 200-with-404-body miss, `partsOfSpeech`
 * naming — and they have to be verifiable without a live key in CI.
 */
export function parseGoogleDict(payload, word, options = {}) {
	return fromGoogleDict(payload, word, options);
}

/** Builds the upstream URL for a word, exported alongside the parser for tests. */
export function buildGoogleDictUrl(word, options = {}) {
	return googleDictUrl(word, options);
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
async function lookup(word, options = {}) {
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

	// Google is tried BEFORE the race, not raced alongside it, so the answer is
	// deterministic. Racing it meant Wiktionary (which answers in ~4s) frequently
	// won despite Google being both richer and faster, and the card then rendered
	// without audio or phonetics — the exact content this provider exists for.
	// A miss or a failure here just falls through to the race below, which is what
	// keeps a revoked key or a Google-side change from becoming a blank tooltip.
	if (isGoogleDictEnabled()) {
		const google = await fetchJson(
			googleDictUrl(word, options),
			GOOGLE_DICT_TIMEOUT_MS,
			null,
			// NOT a forbidden header name, so it is settable from here; it is the
			// only thing that satisfies the key's referrer restriction.
			{ 'x-referer': googleDictXReferer() }
		);
		const data = fromGoogleDict(google, word, options);
		if (data) return { data, provider: 'google' };
	}

	const controllers = sources.map(() =>
		typeof AbortController === 'function' ? new AbortController() : null
	);

	let winner = null;
	let settleWinner;
	const won = new Promise(resolve => {
		settleWinner = resolve;
	});

	const attempts = sources.map(async (source, index) => {
		const payload = await fetchJson(source.url, source.timeoutMs, controllers[index], source.headers);
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

/**
 * Language/corpus hints for the Google source, read from the query string.
 *
 * Validated against a shape test rather than passed through: these become query
 * params on an upstream URL, and an unvalidated string there is a
 * parameter-injection surface on what is effectively a server-side proxy.
 */
function googleOptionsFromQuery(url) {
	const language = url.searchParams.get('glang') || '';
	const corpus = url.searchParams.get('gcorpus') || '';
	const lang = /^[a-z]{2,3}(-[a-z]{2})?$/i.test(language) ? language : 'en';
	const explicitCorpus = /^[a-z]{2}(-[a-z]{2})?$/i.test(corpus) ? corpus : '';

	// When translating, `corpus` must follow the TARGET language.
	//
	// Sending language=es together with the default corpus of en-US asks for
	// "hello in the US English dictionary", which HITS and returns a definition —
	// so translation silently never happened. The upstream only returns
	// translateResponse when the target language is not the corpus it looks in.
	let resolved = explicitCorpus;
	if (!resolved) {
		// en-uk maps to corpus "en" (UK spelling); every other code is its own
		// corpus, which the upstream accepts for the languages it carries.
		resolved = lang === 'en-uk' ? 'en' : lang;
	}
	return { language: lang, corpus: resolved };
}

export async function handleDictionaryGet(event) {
	const url = new URL(event.request.url);

	// Advertise whether the optional richer provider is available, so the client
	// can offer it without shipping a key or probing blind. Checked BEFORE word
	// validation because it carries no word — validating first made the endpoint
	// unreachable, always answering 400.
	if (url.searchParams.get('capabilities') === '1') {
		return jsonResponse({
			ok: true,
			providers: ['dictionaryapi.dev', 'wiktionary'],
			google: isGoogleDictEnabled()
				? { enabled: true, corpus: GOOGLE_DICT_DEFAULT_CORPUS }
				: { enabled: false }
		});
	}

	const word = normalizeWord(url.searchParams.get('word') || '');

	if (!word) {
		return jsonResponse(
			{ ok: false, error: 'invalid_word', message: 'Provide a single word via ?word=' },
			400
		);
	}

	const options = googleOptionsFromQuery(url);

	if (!isCacheableRequest(event.request, event.request.url)) {
		// Only reachable for an authenticated caller; skip the shared cache
		// rather than risk serving one user's answer from another's cache slot.
		const result = await lookup(word, options);
		if (!result) {
			return jsonResponse({ ok: false, error: 'not_found', word }, 404);
		}
		return jsonResponse({ ok: true, word, ...result.data, provider: result.provider });
	}

	const cached = await cachedResponse(event.request, CACHE_TTL_SECONDS, async () => {
		const result = await lookup(word, options);
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
			'access-control-allow-methods': 'GET, POST, OPTIONS',
			'access-control-max-age': '86400'
		}
	});
}

// ---- user-configured provider ---------------------------------------------
// A BYO slot: the client sends its own base URL, key and parameter names, and
// this handler performs the upstream fetch. Two reasons it cannot happen in the
// browser: the Worker is the only place with no `Origin` header (this class of
// endpoint rejects any request carrying one), and the credential never has to
// be embedded in a shipped binary.
//
// This endpoint is DELIBERATELY never cached and never logged with its body. A
// cached response keyed on someone else's credential would be a cross-tenant
// leak, so the edge cache is bypassed entirely for this path.

const CUSTOM_TIMEOUT_MS = 12000;
const CUSTOM_PARAM_KEYS = [
	'termParam', 'languageParam', 'corpusParam', 'countryParam', 'strategyParam', 'keyParam'
];

/** Only http(s) URLs are proxied, and never a loopback/link-local address. */
function safeUpstreamUrl(raw) {
	if (typeof raw !== 'string' || !raw) return null;
	let url;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

	const host = url.hostname.toLowerCase();
	if (
		host === 'localhost' || host === '::1' ||
		host.endsWith('.localhost') || host.endsWith('.internal') ||
		/^127\./.test(host) || /^10\./.test(host) ||
		/^192\.168\./.test(host) || /^169\.254\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host)
	) {
		return null;
	}
	return url;
}

/**
 * Reads the provider's response into the app's normalised shape.
 *
 * Deliberately permissive: this payload is undocumented and can change without
 * notice, so every field is probed defensively and an unrecognised body yields
 * "no definition" instead of throwing. A miss is also reported as HTTP 200 with
 * a `status:404`-style body upstream, so the HTTP status alone is not trusted.
 */
function parseCustomPayload(payload, word) {
	if (!payload || typeof payload !== 'object') return null;

	// A MISS ARRIVES AS HTTP 200 with { "status": 404 }. Without this check the
	// function fell through to `return null` at the end, which reads as "no
	// definition" — indistinguishable from a real miss, and it silently discarded
	// any payload shape this parser did not recognise.
	if (payload.status !== 200) return null;

	const meanings = [];
	const dictionaryData = Array.isArray(payload.dictionaryData) ? payload.dictionaryData[0] : null;

	if (dictionaryData && !dictionaryData.error) {
		const entry = Array.isArray(dictionaryData.entries) ? dictionaryData.entries[0] : null;
		const groups = entry && Array.isArray(entry.senseFamilies) ? entry.senseFamilies : [];

		for (const family of groups) {
			if (!family || !Array.isArray(family.senses)) continue;
			const definitions = [];
			for (const sense of family.senses) {
				const text = htmlToText(sense?.definition?.text || sense?.definition || '');
				if (!text) continue;
				definitions.push({
					definition: text.slice(0, 400),
					example: '',
					synonyms: [],
					antonyms: []
				});
				if (definitions.length >= MAX_DEFINITIONS_PER_POS) break;
			}
			// The API field is `partsOfSpeech` — an array of { value }. Reading
			// `partOfSpeechs` (as this previously did) always produced '', and the
			// `&& pos` guard then dropped EVERY sense group, so the custom path
			// reported "no definition" for this endpoint whatever it returned.
			const posList = Array.isArray(family.partsOfSpeech) ? family.partsOfSpeech : [];
			const pos = htmlToText(posList.find(p => p?.value)?.value || '');
			// Fall back rather than skip, so a corpus that omits a POS tag still
			// renders its definitions.
			if (definitions.length) {
				meanings.push({ partOfSpeech: pos || 'definition', definitions, synonyms: [], antonyms: [] });
			}
		}

		if (!meanings.length) {
			const web = Array.isArray(dictionaryData.webDefinitions) ? dictionaryData.webDefinitions[0] : null;
			const text = htmlToText(web?.definition || '');
			if (text) {
				meanings.push({
					partOfSpeech: 'definition',
					definitions: [{ definition: text.slice(0, 400), example: '', synonyms: [], antonyms: [] }],
					synonyms: [],
					antonyms: []
				});
			}
		}

		if (!meanings.length) return null;

		const phonetics = [];
		const candidates = [
			...(Array.isArray(dictionaryData.phonetics) ? dictionaryData.phonetics : []),
			...(entry && Array.isArray(entry.phonetics) ? entry.phonetics : [])
		];
		for (const item of candidates) {
			if (!item || typeof item !== 'object') continue;
			const text = typeof item.text === 'string' ? item.text : '';
			// oxfordAudio is protocol-relative ("//ssl.gstatic.com/…"), which
			// new URL() rejects. Normalise before validating.
			const audio = finiteUrl(httpsUrl(item.oxfordAudio || ''));
			if ((!text && !audio) || phonetics.some(p => p.text === text && p.audio === audio)) continue;
			phonetics.push({ text, audio });
			if (phonetics.length >= 4) break;
		}
		const topAudio = finiteUrl(httpsUrl(payload.oxfordAudio || ''));
		if (topAudio) phonetics.unshift({ text: '', audio: topAudio });

		return {
			word,
			phonetic: phonetics.find(p => p.text)?.text || '',
			phonetics: phonetics.slice(0, 5),
			sourceUrl: '',
			meanings
		};
	}

	// Translation-shaped response: surface it as a single "translation" sense.
	const translation = payload.translateResponse;
	if (translation && typeof translation === 'object') {
		const text = htmlToText(translation.translateText || '');
		if (!text) return null;
		const terms = Array.isArray(translation.bilingualDictionary)
			? translation.bilingualDictionary.flatMap(entry => (Array.isArray(entry?.terms) ? entry.terms : []))
			: [];
		return {
			word,
			phonetic: '',
			phonetics: [],
			sourceUrl: '',
			meanings: [{
				partOfSpeech: 'translation',
				definitions: [{ definition: text, example: '', synonyms: [], antonyms: [] }],
				synonyms: [],
				antonyms: []
			}],
			translationTerms: uniqueStrings(terms, 8)
		};
	}

	return null;
}

export async function handleDictionaryPost(event) {
	let body;
	try {
		body = await event.request.json();
	} catch {
		return jsonResponse({ ok: false, error: 'invalid_body' }, 400);
	}

	const word = normalizeWord(body?.word || '');
	const custom = body?.custom;
	if (!word || !custom || typeof custom !== 'object') {
		return jsonResponse({ ok: false, error: 'invalid_request' }, 400);
	}

	const url = safeUpstreamUrl(custom.baseUrl);
	if (!url) {
		return jsonResponse({ ok: false, error: 'invalid_base_url' }, 400);
	}
	if (typeof custom.key !== 'string' || !custom.key) {
		return jsonResponse({ ok: false, error: 'missing_key' }, 400);
	}

	// Parameter names come from the client, so they are whitelisted to a simple
	// identifier shape before being used as query keys.
	const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,30}$/;
	const safeName = (name, fallback) =>
		(typeof name === 'string' && PARAM_NAME.test(name)) ? name : fallback;

	for (const paramKey of CUSTOM_PARAM_KEYS) {
		const value = custom[paramKey];
		if (value !== undefined && (typeof value !== 'string' || !PARAM_NAME.test(value))) {
			return jsonResponse({ ok: false, error: `invalid_${paramKey}` }, 400);
		}
	}

	url.searchParams.set(safeName(custom.termParam, 'term'), word.toLowerCase());
	if (custom.language) url.searchParams.set(safeName(custom.languageParam, 'language'), String(custom.language));
	if (custom.corpus) url.searchParams.set(safeName(custom.corpusParam, 'corpus'), String(custom.corpus));
	if (custom.country) url.searchParams.set(safeName(custom.countryParam, 'country'), String(custom.country));
	if (custom.strategy) url.searchParams.set(safeName(custom.strategyParam, 'strategy'), String(custom.strategy));
	url.searchParams.set(safeName(custom.keyParam, 'key'), custom.key);

	const headers = { accept: 'application/json' };
	if (
		typeof custom.headerName === 'string' &&
		/^[A-Za-z-]{1,64}$/.test(custom.headerName) &&
		typeof custom.headerValue === 'string' &&
		custom.headerValue.length <= 512
	) {
		headers[custom.headerName] = custom.headerValue;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), CUSTOM_TIMEOUT_MS);
	try {
		const response = await fetch(url.toString(), { headers, signal: controller.signal });
		if (!response.ok) {
			// Still credential-bearing, so still uncacheable: a shared cache
			// entry here would expose the outcome of someone else's key.
			return jsonResponse({ ok: false, error: 'upstream_error', status: response.status }, 502, {
				'cache-control': 'no-store'
			});
		}
		const payload = await response.json().catch(() => null);
		const data = parseCustomPayload(payload, word);
		if (!data) {
			return jsonResponse({ ok: false, error: 'not_found', word }, 404, {
				// Explicitly uncacheable: the request carried a credential.
				'cache-control': 'no-store'
			});
		}
		return jsonResponse(
			{ ok: true, word, ...data, provider: 'custom' },
			200,
			{ 'cache-control': 'no-store' }
		);
	} catch {
		return jsonResponse({ ok: false, error: 'upstream_unreachable' }, 504, { 'cache-control': 'no-store' });
	} finally {
		clearTimeout(timer);
	}
}