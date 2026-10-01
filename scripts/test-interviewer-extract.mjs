/**
 * Behaviour tests for the interviewer extraction engine.
 * Run: node scripts/test-interviewer-extract.mjs
 */
import {
  mergeExtracted,
  sanitiseValue,
  isMeaningfulValue,
  extractFields,
  nextOpenField,
  isSatisfied
} from '../src/lib/server/interviewer-extract.js';

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`); }
}

// The real "Viva Box" shape: a numeric select, a text subject, a long question
// list, a difficulty select and two optional extras.
const viva = {
  id: 'viva-question-bank',
  fields: [
    { name: 'semester', label: 'What semester is it?', type: 'select', required: true, options: ['1', '3', '5', '7'] },
    { name: 'subject', label: 'what subject?', type: 'text', required: true },
    { name: 'questions', label: 'List questions that were being asked', type: 'text', required: true },
    { name: 'difficulty', label: 'What was the difficulty level for you?', type: 'select', required: true, options: ['Easy', 'Medium', 'Hard'] },
    { name: 'faculty', label: 'Share the faculty name (Optional)', type: 'text', required: false, minLength: 3, maxLength: 30 },
    { name: 'notes', label: 'Any additional Tips?', type: 'text', required: false }
  ]
};

console.log('\n— meaningless answers are rejected —');
for (const junk of ['n/a', 'none', 'unknown', 'not sure', "don't know", 'skip', 'ok', 'thanks', 'yeah', '-', '', '  ']) {
  check(`rejects ${JSON.stringify(junk)}`, isMeaningfulValue(junk), false);
}
check('accepts a real answer', isMeaningfulValue('Explain the difference between a stack and a queue'), true);

console.log('\n— stopwords never become a subject —');
// This is the exact bug: "It was easy for me" captured subject="me".
check('"me" is not meaningful', isMeaningfulValue('me'), false);
check('"for me" yields no subject', extractFields('It was easy for me', viva.fields, {}, 'difficulty').subject, undefined);

console.log('\n— select fields —');
// A declared option said plainly is a direct answer and must be honoured.
check('a bare declared option is accepted', sanitiseValue(viva.fields[0], '5'), '5');
check('"5th semester" resolves', sanitiseValue(viva.fields[0], '5th semester'), '5');
check('"sem 7" resolves', sanitiseValue(viva.fields[0], 'sem 7'), '7');
check('prose never becomes a semester', sanitiseValue(viva.fields[0], 'I had a long chat about pointers and memory'), null);
check('difficulty snaps to an option', sanitiseValue(viva.fields[3], 'hard'), 'Hard');
check('unlisted difficulty rejected', sanitiseValue(viva.fields[3], 'brutal'), null);

// Forms disagree on the wording — snapping must follow the form, not a guess.
const hardForm = { fields: [{ name: 'difficulty', label: 'Difficulty', type: 'select', options: ['Easy', 'Moderate', 'Challenging'] }] };
check('"tough" snaps to Challenging on that form', sanitiseValue(hardForm.fields[0], 'tough'), 'Challenging');
check('"hard" snaps to Hard on the viva form', sanitiseValue(viva.fields[3], 'tough'), 'Hard');
check('"it was hard" reaches difficulty via the fallback',
  extractFields('it was hard', viva.fields, { semester: '5' }, 'difficulty').difficulty, 'Hard');

console.log('\n— a stray digit in a sentence is not a semester —');
check('"queue 5 times" yields no semester', extractFields('I did queue 5 times in that mock', viva.fields, {}, 'questions').semester, undefined);
check('"5th semester" in prose does set it', extractFields('This was 5th semester for me', viva.fields, {}, 'questions').semester, '5');

console.log('\n— the fallback attributes replies to the field we asked about —');
const t1 = extractFields('Hi, it was 5th semester', viva.fields, {}, 'semester');
check('semester captured', t1.semester, '5');

const t2 = extractFields('Data Structures', viva.fields, { semester: '5' }, 'subject');
check('subject captured', t2.subject, 'Data Structures');

const t3 = extractFields('Explain the difference between a stack and a queue', viva.fields, { semester: '5', subject: 'Data Structures' }, 'questions');
check('questions captured', t3.questions, 'Explain the difference between a stack and a queue');

const t4 = extractFields('It was easy for me', viva.fields, { semester: '5', subject: 'Data Structures', questions: 'stack vs queue' }, 'difficulty');
check('difficulty captured', t4.difficulty, 'Easy');
check('subject left alone', t4.subject, undefined);

console.log('\n— a full fallback walkthrough —');
let known = {};
let hint = nextOpenField(viva, known, []).name;
for (const say of ['Hi, it was 5th semester', 'Data Structures', 'Explain stack vs queue', 'It was easy']) {
  const got = extractFields(say, viva.fields, known, hint);
  known = { ...known, ...got };
  hint = nextOpenField(viva, known, [])?.name || null;
}
check('all four required captured, no noise', known, {
  semester: '5', subject: 'Data Structures', questions: 'Explain stack vs queue', difficulty: 'Easy'
});
check('nothing left to ask', isSatisfied(viva, known, []), false, undefined);
check('only optional fields remain', nextOpenField(viva, known, []).name, 'faculty');

console.log('\n— captured answers are protected —');
const after = mergeExtracted(viva, {}, { semester: '5', subject: 'Data Structures' });
const noise = mergeExtracted(viva, after.extracted, { semester: 'n/a', subject: 'me' });
check('noise does not overwrite', noise.extracted.subject, 'Data Structures');
check('nothing reported as updated', noise.updated, []);
const fixed = mergeExtracted(viva, after.extracted, { subject: 'Actually it was Computer Networks' });
check('an explicit correction applies', fixed.extracted.subject, 'Actually it was Computer Networks');
check('correction is reported', fixed.updated, ['subject']);

// Being *longer* is not a correction. This was overwriting good answers.
const longer = mergeExtracted(
  viva,
  { questions: 'Explain stack vs queue' },
  { questions: 'Explain the difference between a stack and a queue' }
);
check('a longer answer does NOT overwrite', longer.extracted.questions, 'Explain stack vs queue');
check('and is not reported as an update', longer.updated, []);

// A stub being filled in with real detail is an improvement.
const stub = mergeExtracted(viva, { subject: 'TBD' }, { subject: 'Data Structures and Algorithms' });
check('a stub IS filled in', stub.extracted.subject, 'Data Structures and Algorithms');
check('filling a stub is reported', stub.updated, ['subject']);

check('unknown fields dropped', mergeExtracted(viva, {}, { hacker: 'x' }).rejected, ['hacker']);
check('oversized value dropped', mergeExtracted(viva, {}, { faculty: 'x'.repeat(40) }).rejected, ['faculty']);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);