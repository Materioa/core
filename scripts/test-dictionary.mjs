// Ad-hoc check for the dictionary proxy: exercises the normaliser and the
// provider fallback chain without booting SvelteKit.
//   node scripts/test-dictionary.mjs [word ...]

import { normalizeWord, htmlToText, handleDictionaryGet } from '../src/lib/server/dictionary-handler.js';

let failures = 0;

function check(label, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got      ${JSON.stringify(actual)}\n       expected ${JSON.stringify(expected)}`}`);
}

// --- normalizeWord ---------------------------------------------------------
check('rejects empty', normalizeWord(''), '');
check('rejects whitespace', normalizeWord('   '), '');
check('strips wrapping punctuation', normalizeWord('(hello),'), 'hello');
check('lowercases', normalizeWord('EPHEMERAL'), 'ephemeral');
check('keeps internal apostrophe', normalizeWord("don't"), "don't");
check('curly apostrophe normalises', normalizeWord('don’t'), "don't");
// A bare number is a valid upstream path segment; it is the CLIENT that
// declines to look one up (selectedWord requires a letter), not this sanitiser.
check('keeps bare number', normalizeWord('42'), '42');
check('rejects over-long input', normalizeWord('x'.repeat(65)), '');
check('survives stray percent', normalizeWord('100%'), '100');
check('rejects path traversal', normalizeWord('../../etc/passwd'), '');
check('rejects internal slash', normalizeWord('foo/bar'), '');
check('rejects query injection', normalizeWord('a&b=c'), '');
check('keeps hyphenated word', normalizeWord('well-known'), 'well-known');

// --- htmlToText -----------------------------------------------------------
check('strips tags', htmlToText('<span class="x">a <a href="/wiki/b">b</a></span>'), 'a b');
check('decodes entities', htmlToText('a &amp; b &#39;c&#39;'), "a & b 'c'");
check('collapses whitespace', htmlToText('  a\n\t b  '), 'a b');
check('handles empty span', htmlToText('<span></span>Lasting'), 'Lasting');

// --- live lookup ----------------------------------------------------------
const words = process.argv.slice(2).length ? process.argv.slice(2) : ['ephemeral', 'hello'];

for (const word of words) {
	const event = {
		request: new Request(`https://example.test/api/v2/dictionary?word=${encodeURIComponent(word)}`, {
			method: 'GET'
		}),
		url: new URL(`https://example.test/api/v2/dictionary?word=${encodeURIComponent(word)}`)
	};

	const started = Date.now();
	let res;
	try {
		res = await handleDictionaryGet(event);
	} catch (error) {
		failures++;
		console.log(`FAIL ${word} threw: ${error?.message || error}`);
		continue;
	}

	const body = await res.json();
	const took = Date.now() - started;
	console.log(`\n${word}: HTTP ${res.status} via ${body.provider || '-'} (${took}ms), cache=${res.headers.get('X-Edge-Cache') || 'none'}`);
	console.log(`  phonetic: ${body.phonetic || '(none)'}  meanings: ${(body.meanings || []).map(m => m.partOfSpeech).join(', ') || '(none)'}`);
	console.log(`  first: ${body.meanings?.[0]?.definitions?.[0]?.definition?.slice(0, 110) || body.message || '(none)'}`);
}

// Repeat the first word: the edge cache must serve it without a refetch.
if (words.length) {
	const url = `https://example.test/api/v2/dictionary?word=${encodeURIComponent(words[0])}`;
	const again = await handleDictionaryGet({
		request: new Request(url, { method: 'GET' }),
		url: new URL(url)
	});
	console.log(`\nrepeat ${words[0]}: cache=${again.headers.get('X-Edge-Cache') || 'none'}`);
}

// A missing word must be a clean 404, not a crash.
const missing = await handleDictionaryGet({
	request: new Request('https://example.test/api/v2/dictionary?word=zzqqxxyynotaword', { method: 'GET' }),
	url: new URL('https://example.test/api/v2/dictionary?word=zzqqxxyynotaword')
});
console.log(`missing word: HTTP ${missing.status} ${JSON.stringify(await missing.json())}`);

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);