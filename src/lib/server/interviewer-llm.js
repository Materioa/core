/**
 * Interviewer LLM provider chain.
 *
 * Why this exists: the interviewer used to try providers in a fixed order and,
 * when the last one returned 429, drop straight to the regex extractor. That
 * made the whole conversation sound canned and blunt, because roughly every
 * reply came from a template instead of the model.
 *
 * What it does now:
 *   - Several providers, tried in order, with per-provider cooldowns.
 *   - A 429 on one provider rotates to the next instead of ending the turn.
 *   - OpenRouter cycles a list of models, so a rate-limited model isn't fatal.
 *   - The regex extractor is only reached when every provider is unavailable.
 *   - Identical prompts inside a short window reuse the previous answer, which
 *     takes a lot of pressure off the rate-limited providers.
 */

import { env } from '$env/dynamic/private';

const DEFAULT_TIMEOUT_MS = 25_000;

/** provider id -> epoch ms until which it is skipped. */
const cooldownUntil = new Map();

/** Tiny prompt+model cache. Keeps a burst of retries off the rate limiter. */
const responseCache = new Map();
const CACHE_TTL_MS = 45_000;
const CACHE_MAX = 60;

/**
 * Should we rotate to the next provider / model rather than giving up?
 *
 * Rate limits are the obvious case, but OpenRouter also rejects up front for
 * three more reasons that are all "try something else" rather than "this is
 * broken": the token cap exceeds what the account can pre-authorise, the model
 * id has gone stale, or the model has no live endpoints.
 */
function isRateLimited(err) {
	const status = Number(err?.status || 0);
	const msg = String(err?.message || '');
	return (
		status === 429 ||
		/rate.?limit|too many requests|quota/i.test(msg) ||
		/requires more credits|max_tokens|exceeds the maximum/i.test(msg) ||
		/not a valid model|no endpoints found/i.test(msg)
	);
}

function penalise(id, ms) {
	cooldownUntil.set(id, Date.now() + ms);
}

function available(id) {
	return (cooldownUntil.get(id) || 0) <= Date.now();
}

function readCache(key) {
	const hit = responseCache.get(key);
	if (!hit) return null;
	if (Date.now() - hit.at > CACHE_TTL_MS) {
		responseCache.delete(key);
		return null;
	}
	return hit.value;
}

function writeCache(key, value) {
	if (responseCache.size >= CACHE_MAX) responseCache.clear();
	responseCache.set(key, { at: Date.now(), value });
}

/** Parse the first JSON object out of a model reply, tolerating code fences. */
export function parseModelJson(raw) {
	const text = String(raw || '').trim();
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const body = fenced ? fenced[1] : text;
	const start = body.indexOf('{');
	const end = body.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) throw new Error('model returned no JSON');
	return JSON.parse(body.slice(start, end + 1));
}

async function postJson(url, { headers, body, timeout = DEFAULT_TIMEOUT_MS }) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body: JSON.stringify(body),
			signal: controller.signal
		});
		if (!res.ok) {
			const err = new Error(`HTTP ${res.status}`);
			err.status = res.status;
			throw err;
		}
		return await res.json();
	} finally {
		clearTimeout(timer);
	}
}

/**
 * OpenRouter pre-authorises a request against its max_tokens, so a large cap
 * is rejected up front — including on an account with no credits, even
 * though the same call succeeds with a small cap. This was the single reason
 * every turn 429'd and fell back to the canned extractor.
 */
const MAX_TOKENS = 600;

/**
 * Free-only by default, and deliberately so.
 *
 * OpenRouter's `:free` models share one daily quota for the whole account
 * (currently 100 requests/day), and once it's spent every free model returns
 * 429 at once. That is survivable — the answer is to also configure a provider
 * with a genuine free tier (Gemini AI Studio or NVIDIA NIM both have one), so
 * the chain keeps working when OpenRouter's daily cap is gone.
 *
 * Set INTERVIEWER_ALLOW_PAID=1 to allow metered models. They do currently
 * answer at MAX_TOKENS even on a zero-credit account, but that is not
 * something to rely on, and it costs real money once credits exist.
 */
const ALLOW_PAID = env.INTERVIEWER_ALLOW_PAID === '1' || env.INTERVIEWER_ALLOW_PAID === 'true';

/** Guard so a paid model can never be reached by accident. */
function assertFree(model) {
	if (ALLOW_PAID) return model;
	if (!model.endsWith(':free')) {
		throw new Error(`refusing metered model "${model}" (set INTERVIEWER_ALLOW_PAID=1 to allow)`);
	}
	return model;
}

/* ------------------------------------------------------------------ */
/* Providers                                                          */
/* ------------------------------------------------------------------ */

async function viaGemini({ system, messages, model }) {
	const key = env.GEMINI_API_KEY || env.GOOGLE_AI_KEY;
	if (!key) return null;
	const m = model || env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
	const data = await postJson(
		`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
		{
			headers: {},
			body: {
				systemInstruction: { parts: [{ text: system }] },
				contents: messages.map((msg) => ({
					role: msg.role === 'assistant' ? 'model' : 'user',
					parts: [{ text: msg.content }]
				})),
				generationConfig: {
					responseMimeType: 'application/json',
					temperature: 0.7,
					maxOutputTokens: MAX_TOKENS
				}
			}
		}
	);
	return parseModelJson(data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '');
}

async function viaNvidia({ system, messages, model }) {
	const key = env.NVIDIA_API_KEY || env.NVIDIA_NIM_KEY;
	if (!key) return null;
	const m = model || env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct';
	const data = await postJson('https://integrate.api.nvidia.com/v1/chat/completions', {
		headers: { Authorization: `Bearer ${key}` },
		body: {
			model: m,
			temperature: 0.7,
			max_tokens: MAX_TOKENS,
			messages: [{ role: 'system', content: system }, ...messages]
		}
	});
	return parseModelJson(data?.choices?.[0]?.message?.content || '');
}

/**
 * Self-hosted Qwen endpoint (FastAPI + transformers, e.g. a HF Space).
 *
 * That API takes `max_new_tokens` — NOT `max_tokens`, which is the other
 * reason every call came back 422. It answers with `{ response, ... }`.
 * Slower than a hosted API (CPU inference), so it gets a shorter timeout and
 * sits below the hosted providers in the ladder.
 */
async function viaHuggingFaceSpace({ system, messages }) {
	const url = env.HF_LLM_URL;
	if (!url) return null;
	const turns = messages.map((m) => ({ role: m.role, content: m.content }));

	const data = await postJson(url, {
		// Required: the Space is private, so without this every call 404s.
		headers: env.HF_TOKEN ? { Authorization: `Bearer ${env.HF_TOKEN}` } : {},
		body: {
			messages: turns,
			max_new_tokens: MAX_TOKENS,
			temperature: 0.7
		},
		timeout: Number(env.HF_LLM_TIMEOUT_MS) || 60_000
	});

	// The FastAPI returns `{ response: "…" }`, sometimes as pretty-printed JSON
	// with real newlines inside the string. Unescaping first means
	// parseModelJson sees a normal single-line object.
	const raw = data?.response;
	if (typeof raw !== 'string' || !raw.trim()) {
		throw new Error('HF endpoint returned no response field');
	}
	return parseModelJson(raw.replace(/\\n/g, '\n').replace(/\\"/g, '"'));
}

/**
 * OpenRouter with a model ladder. A rate-limited model is retried on the next
 * one rather than aborting the turn.
 */
async function viaOpenRouter({ system, messages }) {
	const key = env.OPENROUTER_API_KEY;
	if (!key) return null;
	// Free-only ladder, verified against /api/v1/models. The previous defaults
	// (meta/llama-3.3-70b-instruct, google/gemini-2.0-flash-001) are not valid
	// ids, and paid ids are rejected outright unless explicitly allowed.
	const models = (
		env.INTERVIEWER_MODELS ||
		[
			'google/gemma-4-31b-it:free',
			'nvidia/nemotron-3.5-lightning:free',
			'qwen/qwen3.8-27b:free',
			'nvidia/nemotron-3-super-120b-a12b:free',
			'liquid/lfm-2.5-2.6b:free',
			'inclusionai/ling-3.0-flash-sante:free'
		].join(',')
	)
		.split(',')
		.map((m) => m.trim())
		.filter(Boolean)
		.map(assertFree);

	let lastErr;
	for (const model of models) {
		try {
			const data = await postJson(
				`${String(env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')}/chat/completions`,
				{
					headers: {
						Authorization: `Bearer ${key}`,
						'HTTP-Referer': 'https://getmaterio.app',
						'X-Title': 'Materio Interviewer'
					},
					body: {
						model,
						temperature: 0.7,
						max_tokens: MAX_TOKENS,
						messages: [{ role: 'system', content: system }, ...messages]
					}
				}
			);
			return parseModelJson(data?.choices?.[0]?.message?.content || '');
		} catch (err) {
			lastErr = err;
			// Rotate on rate limits, on "no credits / cap too large", and on
			// stale model ids — all "try the next one", not "give up".
			if (!isRateLimited(err)) throw err;
		}
	}
	throw lastErr || new Error('OpenRouter: no model succeeded');
}

/** id, cooldown on 429, cooldown on other failures. */
const PROVIDERS = [
	{ id: 'gemini', run: viaGemini, cooldown429: 60_000, cooldownErr: 15_000 },
	{ id: 'nvidia', run: viaNvidia, cooldown429: 60_000, cooldownErr: 15_000 },
	{ id: 'hf-space', run: viaHuggingFaceSpace, cooldown429: 60_000, cooldownErr: 30_000 },
	{ id: 'openrouter', run: viaOpenRouter, cooldown429: 45_000, cooldownErr: 15_000 }
];

/**
 * Ask the model for the next turn.
 *
 * @returns {Promise<{ extracted: object, reply: string, complete: boolean } | null>}
 *   null means every configured provider failed — the caller then uses the
 *   regex extractor, which is a last resort rather than the common case.
 */
export async function askInterviewerModel({ system, messages }) {
	// Cache on the tail of the conversation so a retry after a 429 is free.
	const key = `${system.length}:${system.slice(-220)}|${messages
		.slice(-3)
		.map((m) => `${m.role}:${String(m.content).slice(0, 160)}`)
		.join('|')}`;
	const cached = readCache(key);
	if (cached) return cached;

	for (const provider of PROVIDERS) {
		if (!available(provider.id)) continue;
		try {
			const parsed = await provider.run({ system, messages });
			if (!parsed) continue; // provider not configured
			// A response with no reply is a FAILED turn, not a partial success.
			// Small models (Qwen 0.5B, for one) happily return
			// {"extracted":{…}} and drop the reply — treating that as success
			// silently swapped the AI out for the canned fallback, which is how
			// a weak model looked like "the AI is working" when it wasn't.
			const reply = String(parsed.reply || '').trim();
			if (!reply) {
				throw new Error('model returned no reply text');
			}
			const value = { extracted: parsed.extracted || {}, reply, complete: !!parsed.complete };
			writeCache(key, value);
			// A success clears any lingering penalty.
			cooldownUntil.delete(provider.id);
			return value;
		} catch (err) {
			const limited = isRateLimited(err);
			penalise(provider.id, limited ? provider.cooldown429 : provider.cooldownErr);
			try {
				console.warn(
					`[interviewer] ${provider.id} ${limited ? 'rate-limited' : 'failed'}: ${err?.message || err}`
				);
			} catch {}
		}
	}

	try {
		console.warn(
			'[interviewer] every provider unavailable — using regex extraction. ' +
				'If this is OpenRouter, the free daily quota is likely spent; ' +
				'add GEMINI_API_KEY or NVIDIA_API_KEY for a provider with its own free tier.'
		);
	} catch {}
	return null;
}

/** Test seam. */
export function _resetLlmState() {
	cooldownUntil.clear();
	responseCache.clear();
}