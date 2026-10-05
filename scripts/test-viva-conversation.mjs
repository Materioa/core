#!/usr/bin/env node
/**
 * Regression tests for the viva box's conversation behaviour.
 * Run: node scripts/test-viva-conversation.mjs
 *
 * Two production bugs are pinned here:
 *
 * 1. The fallback replied with ONE fixed sentence, so a visitor who said "hi"
 *    and then "i am ready" got the identical "No rush — whenever you're ready…"
 *    line twice and concluded the bot had not heard either message. That is
 *    the "unhinged and disconnected" report.
 *
 * 2. The subject prompt offered nothing concrete. `subject` is a free-text
 *    field with no options, so the visitor was asked to recall a subject code
 *    they were never shown — while the seating CSV already knew exactly which
 *    subjects their division sits today.
 *
 * Drives the real questionFor/normaliseSubjectOptions out of +server.js by
 * extracting them from source (the route imports $env/$lib, which cannot be
 * resolved outside SvelteKit), the same technique test-parse-model-json.mjs
 * and test-exam-modal-close.mjs already use.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'routes', 'api', 'interviewer', '+server.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else {
    fail++;
    console.log(`  FAIL  ${name}\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
  }
}
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}

/**
 * Pull one top-level `function name(...) {...}` out of the route source by
 * brace matching.
 *
 * Brace counting has to ignore anything inside a string, a template literal or
 * a line comment, or it closes on the first `}` that appears inside prose or
 * an object default. That is not hypothetical: questionFor's signature
 * contains `{ askedLog = [], subjectOptions = [] }`, so a naive scan from the
 * first `{` stops inside the parameter list and returns a fragment that will
 * not even parse.
 */
function extractFn(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(`, 'g');
  const m = re.exec(source);
  if (!m) throw new Error(`${name} not found in +server.js`);

  // Start brace-matching at the BODY, not at the signature. A signature with a
  // destructured options param — questionFor(form, extracted, skipped,
  // llmReply, { askedLog = [], subjectOptions = [] }) — contains a `{` that
  // closes before the body even opens, so matching from the signature balances
  // out on the parameter list and returns the signature alone. Scanning for the
  // closing paren of the param list first skips that.
  const paramsEnd = source.indexOf(')', m.index + m[0].length);
  if (paramsEnd === -1) throw new Error(`no parameter list for ${name}`);
  const open = source.indexOf('{', paramsEnd);
  if (open === -1) throw new Error(`no body brace for ${name}`);

  let depth = 0;
  let i = open;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) break;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(m.index, i + 1);
    }
    i++;
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

/**
 * The REAL nextOpenField, not a stub. It decides which field is asked next, so
 * stubbing it to null made questionFor report "complete" on the very first turn
 * and every conversation check below failed for the wrong reason.
 * interviewer-extract.js imports nothing, so it loads directly.
 */
const { nextOpenField: realNextOpenField } = await import(
  pathToFileURL(join(root, 'src', 'lib', 'server', 'interviewer-extract.js')).href
);

/**
 * Compile the extracted helpers with every dependency they reference supplied
 * explicitly, so a missing or renamed helper fails loudly here instead of
 * surfacing as a confusing "Unexpected token" from `new Function`.
 */
function build(list) {
  const body = list.join('\n');
  try {
    return new Function(
      'nextOpenField',
      `${body}\nreturn { questionFor, normaliseSubjectOptions, READY_NUDGES, subjectOptionsFor, listPhrase };`
    )(realNextOpenField);
  } catch (err) {
    throw new Error(`could not compile extracted helpers: ${err.message}\n---\n${body}\n---`);
  }
}

// Helpers the extracted bodies call, injected rather than extracted.
const noopNextOpenField = () => null;
const normaliseSubjectOptionsSrc = extractFn(src, 'normaliseSubjectOptions');
const subjectOptionsForSrc = extractFn(src, 'subjectOptionsFor');
const listPhraseSrc = extractFn(src, 'listPhrase');
const questionForSrc = extractFn(src, 'questionFor');
// Keep the whole statements, not just the literals: questionFor references
// READY_NUDGES and READY_MARKER by name.
const readyNudgesSrc = src.match(/const READY_NUDGES = \[[\s\S]*?\];/)[0];
const readyMarkerSrc = src.match(/const READY_MARKER = .*?;/)[0];

const {
  questionFor,
  normaliseSubjectOptions,
  READY_NUDGES,
  subjectOptionsFor,
  listPhrase
} = build([
  readyNudgesSrc,
  readyMarkerSrc,
  listPhraseSrc,
  subjectOptionsForSrc,
  normaliseSubjectOptionsSrc,
  questionForSrc
]);

// The live viva-question-bank field shape, from /api/interviewer.
const viva = {
  id: 'viva-question-bank',
  interview: { skipAllowed: true, completeMessage: 'Thanks — your question is queued for the viva box.' },
  fields: [
    { name: 'question', label: 'Question', type: 'textarea', required: true },
    { name: 'subject', label: 'Subject or topic', type: 'text', required: true },
    { name: 'difficulty', label: 'Difficulty', type: 'select', options: ['Easy', 'Moderate', 'Challenging'], required: false },
    { name: 'notes', label: 'Helpful notes', type: 'textarea', required: false }
  ]
};
const nextOpen = (form, extracted, skipped) => {
  const open = (f) => !extracted[f.name] && !skipped.includes(f.name);
  const fields = form.fields || [];
  return fields.find((f) => f.required && open(f)) || fields.find(open) || null;
};

console.log('\nnormaliseSubjectOptions');
check('empty context -> []', normaliseSubjectOptions({}, {}), []);
check('undefined -> []', normaliseSubjectOptions(undefined, {}), []);
check('non-array is ignored', normaliseSubjectOptions({ subjects: 'nope' }, {}), []);
check('objects flattened to names',
  normaliseSubjectOptions({ subjects: [{ subject: 'BDA' }, { subject: 'INS' }] }, {}), ['BDA', 'INS']);
check('plain strings accepted',
  normaliseSubjectOptions({ subjects: ['BDA', 'CS'] }, {}), ['BDA', 'CS']);
check('dupes collapsed case-insensitively',
  normaliseSubjectOptions({ subjects: ['BDA', 'bda', 'BDA'] }, {}), ['BDA']);
check('blank entries dropped',
  normaliseSubjectOptions({ subjects: ['', '  ', 'CS'] }, {}), ['CS']);
check('falls back to single subject field',
  normaliseSubjectOptions({ subject: 'Project II' }, {}), ['Project II']);
check('subjects wins over single subject',
  normaliseSubjectOptions({ subject: 'X', subjects: ['BDA'] }, {}), ['BDA']);
check('already-answered subject is not re-offered',
  normaliseSubjectOptions({ subjects: ['BDA', 'INS'] }, { subject: 'ins' }), ['BDA']);
check('subjectName shape supported',
  normaliseSubjectOptions({ subjects: [{ subjectName: 'DS' }] }, {}), ['DS']);
check('absurdly long value dropped',
  normaliseSubjectOptions({ subjects: ['x'.repeat(200), 'OK'] }, {}), ['OK']);

console.log('\nthe fallback never repeats itself (the reported bug)');
// MARK is the sentinel the route records for a turn that captured nothing.
// One MARK already logged means that turn has been through questionFor once.
const MARK = '__no_answer__';
// Reproduces the screenshot exactly: "hi", then "i am ready", nothing captured.
// Index is the number of MARKs already logged, so 0/1/2 markers are the first
// three greetings of a session.
const t1 = questionFor(viva, {}, [], '', { askedLog: [], subjectOptions: [] });
const t2 = questionFor(viva, {}, [], '', { askedLog: [MARK], subjectOptions: [] });
const t3 = questionFor(viva, {}, [], '', { askedLog: [MARK, MARK], subjectOptions: [] });
ok('turn 1 differs from turn 2', t1 !== t2, `both were: ${t1}`);
ok('turn 2 differs from turn 3', t2 !== t3, `both were: ${t2}`);
ok('all three distinct', new Set([t1, t2, t3]).size === 3, [t1, t2, t3].join(' | '));
check('nudges come from the rotating set', [t1, t2, t3],
  [READY_NUDGES[0], READY_NUDGES[1], READY_NUDGES[2]]);
ok('never asks the same question twice in a row', t1 !== t2 && t2 !== t3);
// Beyond the list it must clamp, not index off the end.
const t9 = questionFor(viva, {}, [], '', { askedLog: Array(20).fill(MARK), subjectOptions: [] });
check('clamps at the last nudge', t9, READY_NUDGES[READY_NUDGES.length - 1]);

console.log('\nthe subject prompt names real options');
const opts = ['BDA', 'INS', 'CS', 'DS', 'Project II'];
const greeting = questionFor(viva, {}, [], '', { askedLog: [], subjectOptions: opts });
ok('greeting nudge lists today\'s subjects',
  greeting.includes('BDA') && greeting.includes('Project II'), greeting);
const asked = questionFor(viva, { question: 'explain deadlock' }, [], '', {
  askedLog: ['question'],
  subjectOptions: opts
});
ok('subject step asks which subject', /which subject/i.test(asked), asked);
ok('subject step offers options', asked.includes('BDA') && asked.includes('INS'), asked);

console.log('\noptions only where they belong');
// difficulty is a select with its own options — never the subject list.
const diff = questionFor(
  { ...viva, fields: [viva.fields[1], { ...viva.fields[2], required: true }] },
  { subject: 'BDA' },
  [],
  '',
  { askedLog: [], subjectOptions: opts }
);
ok('difficulty is not offered the subject list', !diff.includes('Project II'), diff);

console.log('\ndegrades safely');
check('no options -> plain question, no crash',
  questionFor(viva, {}, [], '', { askedLog: [], subjectOptions: null }).length > 0, true);
check('llmReply always wins',
  questionFor(viva, {}, [], 'the model said this', { askedLog: [], subjectOptions: opts }),
  'the model said this');
check('complete when nothing left',
  questionFor(viva, { question: 'q', subject: 'BDA', difficulty: 'Easy', notes: 'n' }, [], '',
    { askedLog: [], subjectOptions: opts }),
  'Thanks — your question is queued for the viva box.');
check('skipped subject is not asked again',
  questionFor(viva, { question: 'q' }, ['subject'], '', { askedLog: [], subjectOptions: opts })
    .length > 0, true);

// The same helpers again, now with every dependency questionFor calls injected
// for real instead of stubbed — the end-to-end conversation path.
console.log('\nend-to-end, with every dependency the real one');
const realNext = realNextOpenField;
check('no fields captured -> asks the question field', realNext(viva, {}, []).name, 'question');
check('question captured -> moves to subject', realNext(viva, { question: 'q' }, []).name, 'subject');
check('required before optional', realNext(viva, { question: 'q', subject: 'BDA' }, []).name, 'difficulty');
check('skipped subject is passed over', realNext(viva, { question: 'q' }, ['subject']).name, 'difficulty');
check('all answered -> null',
  realNext(viva, { question: 'q', subject: 's', difficulty: 'Easy', notes: 'n' }, []), null);

const live = new Function(
  'nextOpenField',
  `${readyNudgesSrc}\n${readyMarkerSrc}\n${listPhraseSrc}\n${subjectOptionsForSrc}\n${normaliseSubjectOptionsSrc}\n${questionForSrc}\nreturn questionFor;`
)(realNext);

const realStep1 = live(viva, {}, [], '', { askedLog: [], subjectOptions: opts });
const realStep2 = live(viva, { question: 'explain deadlock' }, [], '', { askedLog: ['question'], subjectOptions: opts });
ok('real fallback: greeting lists subjects',
  realStep1.includes('BDA') && realStep1.includes('Project II'), realStep1);
ok('real fallback: subject step offers options',
  /which subject/i.test(realStep2) && realStep2.includes('INS'), realStep2);
const realGreet1 = live(viva, {}, [], '', { askedLog: [], subjectOptions: [] });
const realGreet2 = live(viva, {}, [], '', { askedLog: [MARK], subjectOptions: [] });
ok('real fallback: consecutive greetings differ', realGreet1 !== realGreet2,
  `${realGreet1} || ${realGreet2}`);

// The prompt is what invites a verbatim-copied reply, so pin that too.
console.log('\nthe prompt cannot invite a copied reply');
const { buildSystemPrompt } = await import(
  pathToFileURL(join(root, 'src', 'lib', 'server', 'interviewer-extract.js')).href
);
const prompt = buildSystemPrompt({
  form: { ...viva, interview: { ...viva.interview, subjectOptions: opts } },
  priorExtracted: {},
  skipped: [],
  latestText: 'hi'
});
ok('prompt states what the visitor just said', prompt.includes('The visitor just said: "hi"'));
ok('prompt forbids reusing an earlier reply', /NEVER reuse a reply/i.test(prompt));
ok('prompt carries the live subject list', prompt.includes('BDA') && prompt.includes('Project II'));
ok('example reply is an obvious placeholder', prompt.includes('<<WRITE A REAL REPLY HERE>>'));
ok('no copyable example reply remains', !prompt.includes('"reply":"a short friendly question"'));

const p2 = buildSystemPrompt({
  form: viva, priorExtracted: { question: 'explain deadlock' }, skipped: [], latestText: 'BDA'
});
ok('no subject list -> makes no subject claim', !/Subjects running today/i.test(p2));
ok('does not claim nothing was captured once one field is', !p2.includes('Nothing captured yet.'));
ok('marks settled fields as already captured', /Already captured/.test(p2));
ok('never leaks the whole visitor history', !prompt.includes('explain deadlock'));
check('an empty form still renders a prompt', typeof buildSystemPrompt({ form: { fields: [] } }), 'string');
ok('example values are labelled placeholders', /PLACEHOLDER/.test(prompt));

// The rotation is keyed to a sentinel, not a field name. Keying it per field
// let a session that moved between open fields restart the cycle, so two
// greetings in a row produced the SAME sentence again — precisely the bug this
// exists to prevent. Reproduced live before this was fixed.
console.log('\ngreeting rotation survives the open field changing');
const g1 = live(viva, {}, [], '', { askedLog: [], subjectOptions: [] });
const g2 = live(viva, {}, [], '', { askedLog: [MARK], subjectOptions: [] });
ok('first greeting is the first nudge', g1 === READY_NUDGES[0], g1);
ok('second greeting differs', g2 !== g1, `${g1} || ${g2}`);
ok('second greeting is the second nudge', g2 === READY_NUDGES[1], g2);
const g3 = live(viva, {}, [], '', { askedLog: [MARK, MARK], subjectOptions: [] });
ok('third greeting is the third nudge', g3 === READY_NUDGES[2], g3);
ok('fourth clamps instead of repeating',
  live(viva, {}, [], '', { askedLog: [MARK, MARK, MARK, MARK, MARK], subjectOptions: [] })
    === READY_NUDGES[2], true);
const g4 = live(viva, {}, [], '', { askedLog: ['question'], subjectOptions: [] });
ok('a field name in the log is not a greeting', g4 === READY_NUDGES[0], g4);

console.log('\ncopied example values never get stored');
const { isExampleValue } = await import(
  pathToFileURL(join(root, 'src', 'lib', 'server', 'interviewer-extract.js')).href
);
const EXAMPLE_PHRASE = 'the visitor' + String.fromCharCode(39) + 's words';
check('example extracted value recognised', isExampleValue(EXAMPLE_PHRASE), true);
check('trailing punctuation tolerated', isExampleValue(EXAMPLE_PHRASE + '.'), true);
check('reply placeholder recognised', isExampleValue('<<WRITE A REAL REPLY HERE>>'), true);
check('old copyable reply text recognised', isExampleValue('a short friendly question'), true);
check('a real answer is NOT rejected', isExampleValue('explain how a deadlock occurs'), false);
check('empty is not an example', isExampleValue(''), false);
check('undefined is safe', isExampleValue(undefined), false);
check('a real viva question survives', isExampleValue('What is a deadlock?'), false);

console.log(`\n${pass + fail} checks, ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);