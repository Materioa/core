/**
 * Guards the free-only policy and the max_tokens fix that unblocked the API.
 * Run: node scripts/test-interviewer-llm.mjs
 *
 * Both of these were real production failures:
 *   - OpenRouter pre-authorises against max_tokens, so an uncapped request was
 *     rejected up front on a zero-credit account.
 *   - A metered model slipping into the ladder costs real money.
 */
import assert from 'node:assert/strict';

// Mirrors the module's policy without importing $env.
const ALLOW_PAID = process.env.INTERVIEWER_ALLOW_PAID === '1' || process.env.INTERVIEWER_ALLOW_PAID === 'true';
function assertFree(model) {
	if (ALLOW_PAID) return model;
	if (!model.endsWith(':free')) {
		throw new Error(`refusing metered model "${model}" (set INTERVIEWER_ALLOW_PAID=1 to allow)`);
	}
	return model;
}

let pass = 0;
let fail = 0;
function check(name, fn) {
	try {
		fn();
		pass++;
		console.log(`  PASS  ${name}`);
	} catch (e) {
		fail++;
		console.log(`  FAIL  ${name}\n        ${e.message}`);
	}
}

console.log('\n— free models are allowed —');
for (const m of [
	'google/gemma-4-31b-it:free',
	'nvidia/nemotron-3.5-lightning:free',
	'qwen/qwen3.8-27b:free'
]) {
	check(`${m} allowed`, () => assert.equal(assertFree(m), m));
}

console.log('\n— metered models are refused (free-only default) —');
for (const m of [
	'google/gemini-3.5-flash-lite',
	'meta/llama-3.3-70b-instruct',
	'google/gemini-3.7-flash'
]) {
	check(`${m} refused`, () => assert.throws(() => assertFree(m), /refusing metered model/));
}

console.log('\n— parsing tolerates fences and prose —');
// Mirrors parseModelJson.
function parseModelJson(raw) {
	const text = String(raw || '').trim();
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const body = fenced ? fenced[1] : text;
	const start = body.indexOf('{');
	const end = body.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) throw new Error('model returned no JSON');
	return JSON.parse(body.slice(start, end + 1));
}

check('plain JSON parses', () => assert.deepEqual(parseModelJson('{"reply":"hi"}'), { reply: 'hi' }));
check('fenced JSON parses', () => assert.deepEqual(parseModelJson('```json\n{"reply":"hi"}\n```'), { reply: 'hi' }));
check('JSON with surrounding prose parses', () =>
	assert.deepEqual(parseModelJson('Sure! {"reply":"hi"} hope that helps'), { reply: 'hi' }));
check('no JSON throws', () => assert.throws(() => parseModelJson('no json here'), /no JSON/));

console.log('\n— rotation triggers —');
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
check('429 detected', () => assert.equal(isRateLimited({ status: 429 }), true));
check('"free-models-per-day" detected', () => assert.equal(isRateLimited(new Error('Rate limit exceeded: free-models-per-day')), true));
check('credits error rotates', () => assert.equal(isRateLimited(new Error('This request requires more credits, or fewer max_tokens')), true));
check('stale model id rotates', () => assert.equal(isRateLimited(new Error('meta/llama-3.3-70b-instruct is not a valid model ID')), true));
check('missing endpoints rotate', () => assert.equal(isRateLimited(new Error('No endpoints found for google/gemini-2.0-flash-001.')), true));
check('a real failure is not a rotation', () => assert.equal(isRateLimited(new Error('ECONNRESET')), false));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);