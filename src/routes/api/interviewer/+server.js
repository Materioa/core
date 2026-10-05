import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	getFormConfigsCollection,
	getInterviewerSessionsCollection,
	getFormResponsesCollection,
	getFormsCollection,
	withMongoTimeout
} from '$lib/server/mongodb.js';
import { verifyToken } from '$lib/server/supabase.js';
import { cachedResponse } from '$lib/server/edge-cache.js';
import {
	normalise,
	extractFields,
	mergeExtracted,
	sanitiseValue,
	nextOpenField,
	isSatisfied,
	buildSystemPrompt,
	isExampleValue
} from '$lib/server/interviewer-extract.js';
import { askInterviewerModel } from '$lib/server/interviewer-llm.js';

/**
 * Every driver op below is raced against this bound (withMongoTimeout).
 *
 * When the Mongo pool is poisoned, a queued checkout wedges with NOTHING
 * pending — no driver timeout fires and try/catch can't help, because
 * nothing ever throws. The event is then left open forever and workerd
 * kills it with "detected that your Worker's code had hung and would never
 * generate a response". That kill latches the isolate, so every later
 * request routed to it dies in ~7ms with a Cloudflare HTML 500 — which is
 * why this endpoint was failing in a perfect 500/200 alternation while
 * incognito, retries and a fresh browser made no difference.
 *
 * Racing our own timer turns that wedge into an ordinary caught error, and
 * drops the poisoned pool so the next request reconnects fresh.
 * features-handler.js has bounded all 11 of its ops this way for the same
 * reason; this route was the only one with none.
 */
const MONGO_OP_MS = 5000;

function tokenUserId(request) {
	try {
		const token = request.headers.get('authorization')?.replace('Bearer ', '') || '';
		if (!token) return null;
		const decoded = verifyToken(token);
		return decoded?.id || decoded?.sub || null;
	} catch {
		return null;
	}
}

const defaultForm = {
	id: 'viva-question-bank',
	kind: 'interview',
	title: 'Viva Box',
	description: 'Share practical and viva questions that helped you prepare.',
	context: 'viva',
	fields: [
		{ name: 'question', label: 'Question', type: 'textarea', required: true },
		{ name: 'subject', label: 'Subject or topic', type: 'text', required: true },
		{ name: 'difficulty', label: 'Difficulty', type: 'select', options: ['Easy', 'Moderate', 'Challenging'], required: false },
		{ name: 'notes', label: 'Helpful notes', type: 'textarea', required: false }
	],
	interview: {
		openingQuestion: 'Which viva or practical question would you like to share with the community today?',
		systemPrompt: 'You collect viva/practical exam questions. Ask one focused follow-up at a time until the question, subject/topic and difficulty are known. Keep replies under 40 words.',
		skipAllowed: true,
		completeMessage: 'Thanks — your question is queued for the viva box.'
	},
	triggers: { examTypes: ['viva', 'practical'], autoShow: true }
};

// Extraction, value merging and question selection all live in
// interviewer-extract.js. The inline regex fallback that used to sit here
// dumped the whole reply into fields[0] and guessed "subject" from the word
// after "for" — which is how answers ended up overwritten with noise.

/**
 * Conversational nudge when the model gave us nothing usable.
 *
 * Reading a field label aloud verbatim read as robotic, and when the visitor
 * only said "oh hi" it replied as though they had already answered something.
 * So: greet them properly when nothing has been captured, and otherwise fold
 * the label into a sentence rather than quoting it.
 *
 * NEVER REPEAT. This is the fallback path, so it runs whenever the model is
 * down or slow — and it used to emit one fixed sentence, so "hi" and then
 * "i am ready" both produced the identical "No rush — whenever you're ready…"
 * line. It read as though the bot had not heard either message. `askedLog`
 * counts how many times each field has been requested, which both varies the
 * wording and escalates from "are you ready" to actually naming what we need.
 *
 * `subjectOptions` are the viva subjects running today for this student's
 * division. Naming them is what makes the fallback useful: without it the
 * model has no idea what is even being asked for, because the form's `subject`
 * field is a free-text box with no options.
 */
const READY_NUDGES = [
	"No rush — whenever you're ready, what would you like to tell me about?",
	"Still here whenever you are. What question are you thinking of?",
	"Let's start anywhere — what's on your mind?"
];

/** Sentinel in askedLog marking a turn that captured nothing. Never a field name. */
const READY_MARKER = '__no_answer__';

function questionFor(form, extracted, skipped, llmReply, conversationOpts = {}) {
	// Defensive normalisation of the options bag. These values come straight off
	// `await request.json()` on a public endpoint, so an explicit null (or a
	// missing 5th argument) must not throw — the fallback throwing here turns a
	// merely degraded conversation into a 500.
	const { askedLog = [], subjectOptions = [] } = conversationOpts || {};
	const asked = Array.isArray(askedLog) ? askedLog : [];
	const options = Array.isArray(subjectOptions) ? subjectOptions : [];

	if (llmReply && llmReply.trim()) return llmReply.trim();
	const next = nextOpenField(form, extracted, skipped);
	if (!next) return form?.interview?.completeMessage || 'Thanks — your response has been recorded.';

	const answered = Object.keys(extracted || {}).length > 0;
	const timesAsked = (name) => asked.filter((n) => n === name).length;

	if (!answered) {
		// Greeting/filler that captured nothing. Rotate rather than repeat, and
		// name the live subjects straight away: on a bare greeting this is the
		// one turn with nothing to anchor on, so it is the moment a name helps
		// most. Not gated on the field being the subject one — on the viva form
		// the first required field is the semester, and naming today's subjects
		// is exactly the context needed to answer it.
		//
		// Rotation is indexed on TOTAL greeting turns, not per-field. Keying it to
		// the field meant a session that started on 'semester' and later moved to
		// 'subject' restarted the cycle, and two consecutive greetings produced
		// the same sentence again — the exact bug this was meant to fix.
		const greetingTurns = asked.filter((n) => n === READY_MARKER).length;
		const n = READY_NUDGES[Math.min(greetingTurns, READY_NUDGES.length - 1)];
		if (options.length) {
			return `${n} Today that covers ${listPhrase(options)} — pick one, or name your own.`;
		}
		return n;
	}

	let ask = String(next.label || '').trim().replace(/[?.!]+$/, '');
	if (!ask) ask = 'anything else';

	// A select with real options is far easier to answer as a choice, and a
	// viva subject is exactly that. Name the live list rather than asking the
	// visitor to recall a subject code they were never shown.
	const opts = subjectOptionsFor(next.name, options);
	if (opts.length) {
		const opener = timesAsked(next.name) >= 1 ? 'Still need this one —' : 'Thanks, got it.';
		return `${opener} which subject is it for? ${listPhrase(opts)}.`;
	}

	if (/^(what|which)\b/i.test(ask)) {
		ask = ask.replace(/^(what|which)\b/i, (m) => m.toLowerCase());
	} else {
		ask = `what about "${ask}"`;
	}

	const opener = 'Thanks, got it.';
	const skipHint =
		form?.interview?.skipAllowed !== false
			? " And if you'd rather leave one out, just say so."
			: '';
	return `${opener} And ${ask}?${skipHint}`;
}

/**
 * Today's viva subjects for this student, as a plain list of names.
 *
 * Deliberately tolerant about shape. The client may send an array of strings,
 * an array of {subject} objects, or the examContext may only carry the single
 * subject it guessed. Anything unrecognised yields [] and the caller simply
 * falls back to asking without options — never a crash, never a wrong list.
 *
 * A subject the visitor has ALREADY answered is dropped, so a three-option
 * nudge does not keep offering the one they picked.
 */
function normaliseSubjectOptions(examContext, extracted) {
	const raw =
		examContext?.subjects ??
		examContext?.subjectOptions ??
		(examContext?.subject ? [examContext.subject] : []);
	if (!Array.isArray(raw)) return [];

	const already = String(extracted?.subject ?? '').trim().toLowerCase();
	const seen = new Set();
	const out = [];
	for (const item of raw) {
		const name =
			typeof item === 'string'
				? item.trim()
				: String(item?.subject ?? item?.name ?? item?.subjectName ?? '').trim();
		if (!name || name.length > 80) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		if (already && key === already) continue;
		seen.add(key);
		out.push(name);
	}
	return out;
}

/** Subjects only make sense as options for the subject-ish fields. */
function subjectOptionsFor(fieldName, subjectOptions) {
	if (!Array.isArray(subjectOptions) || !subjectOptions.length) return [];
	if (!/subject|topic|course|paper/i.test(String(fieldName || ''))) return [];
	return subjectOptions;
}

/** "A, B or C" — never a wall of text. */
function listPhrase(items, max = 6) {
	const shown = items.slice(0, max);
	const rest = items.length - shown.length;
	if (shown.length === 1) return rest > 0 ? `${shown[0]} and a few others` : shown[0];
	const head = shown.slice(0, -1).join(', ');
	const tail = shown[shown.length - 1];
	const list = `${head} or ${tail}`;
	return rest > 0 ? `${list}, plus ${rest} more` : list;
}

/**
 * Runs the turn through the provider chain in interviewer-llm.js.
 *
 * Returns null when no provider could answer — the ONLY case where the regex
 * extractor is used. Previously a single 429 from the last provider in the list
 * sent the whole conversation down that path, which is why replies came across
 * blunt and templated.
 */
async function extractWithLlm({ form, history, latestText, priorExtracted = {}, skipped = [] }) {
	// latestText goes into the prompt so the model can be told what THIS turn
	// actually said. Without it the prompt had no idea which message it was
	// replying to, which is how a reply from two turns earlier got echoed back.
	const system = buildSystemPrompt({ form, priorExtracted, skipped, latestText });
	const messages = [
		...(history || []).slice(-12).map((m) => ({
			role: m.role === 'user' ? 'user' : 'assistant',
			content: String(m.content).slice(0, 1000)
		})),
		{ role: 'user', content: String(latestText).slice(0, 2000) }
	];
	return askInterviewerModel({ system, messages });
}


/**
 * Form configs change a few times a month, but this lookup runs on every page
 * load and on every chat turn. A short in-process cache takes a Mongo
 * round-trip off the critical path — that read was the visible pause before
 * the interviewer card appeared.
 */
const CONFIG_TTL_MS = 60_000;
const configCache = new Map();

async function loadForm(formId) {
	const hit = configCache.get(formId);
	if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.value;

	let value;
	try {
		const configs = await getFormConfigsCollection();
		const configured = await withMongoTimeout(
			configs.findOne({ id: formId, published: true }),
			MONGO_OP_MS,
			'interviewer form config find'
		);
		if (configured) {
			const { _id, ...rest } = configured;
			value = rest;
		} else {
			value = { ...defaultForm, id: formId };
		}
	} catch (error) {
		// A failed lookup must not be cached, or one blip disables the form for
		// the next minute.
		console.error('Interviewer form config lookup failed:', error);
		return { ...defaultForm, id: formId };
	}

	configCache.set(formId, { at: Date.now(), value });
	return value;
}

/**
 * Drop a cached config after an admin edit. Leading underscore because
 * SvelteKit only permits a fixed set of exports from a +server.js file.
 */
export function _invalidateInterviewerConfig(formId) {
	if (formId) configCache.delete(formId);
	else configCache.clear();
}

function enhanceSingleQuestion(q) {
	if (!q || typeof q !== 'string') return '';
	let str = q.trim();
	if (!str) return '';

	// Clean leading numbering, dashes, or bullets
	str = str.replace(/^[\d]+[\.\)\-\:]\s*/, '').replace(/^[\-\•\*\>\+]\s*/, '').trim();

	// Capitalize first character
	str = str.charAt(0).toUpperCase() + str.slice(1);

	// Expand common acronyms if stand-alone
	const acronymMap = {
		'aes': 'AES (Advanced Encryption Standard)',
		'des': 'DES (Data Encryption Standard)',
		'rsa': 'RSA Public-Key Algorithm',
		'tcp': 'TCP (Transmission Control Protocol)',
		'udp': 'UDP (User Datagram Protocol)',
		'osi': 'OSI 7-Layer Reference Model',
		'dbms': 'DBMS Architecture',
		'rdbms': 'RDBMS Relational Principles',
		'acid': 'ACID Properties (Atomicity, Consistency, Isolation, Durability)',
		'bfs': 'BFS (Breadth First Search)',
		'dfs': 'DFS (Depth First Search)',
		'ins': 'INS (Information & Network Security)',
		'cn': 'Computer Networks Architecture',
		'os': 'Operating Systems Principles'
	};

	const lower = str.toLowerCase();
	if (acronymMap[lower]) {
		str = `Explain ${acronymMap[lower]}`;
	} else if (/^[a-z0-9]{2,5}$/i.test(str)) {
		str = `Explain ${str.toUpperCase()}`;
	}

	// Add punctuation if missing
	if (!/[?.!]$/.test(str)) {
		if (/^(what|why|how|when|where|which|who|whom|whose|can|could|is|are|do|does|did|explain|define|differentiate|distinguish|compare|describe|illustrate)/i.test(str)) {
			str = str + '?';
		} else {
			str = str + '.';
		}
	}

	return str;
}

function splitAndEnhanceQuestions(rawText) {
	if (!rawText) return [];
	// Split by newlines, semicolons, or commas followed by letters/words
	const parts = String(rawText)
		.split(/[\r\n;]+|,\s*(?=[a-zA-Z0-9])/g)
		.map(p => p.trim())
		.filter(Boolean);

	const enhanced = [];
	for (const part of parts) {
		const item = enhanceSingleQuestion(part);
		if (item && item.length > 2) {
			enhanced.push(item);
		}
	}
	return enhanced.length > 0 ? enhanced : [enhanceSingleQuestion(rawText)];
}

async function getEnhancedResponses(formId) {
	try {
		const collection = await getFormResponsesCollection();
		// Deliberately NOT .sort() on the cursor. A sorted cursor wedges on
		// workerd — this file already works around that twice, in
		// handlePromotionsFeature and getMergedNotifications — and this query
		// was still doing it, which is why this endpoint consistently took
		// exactly our 5000ms bound (5052ms p50) before falling back to an
		// empty list. limit() before a sort would also return the wrong 50, so
		// take a bounded unsorted slice and order it here instead.
		const scanned = await withMongoTimeout(
			collection.find({
				$or: [
					{ formId },
					{ 'values.questions': { $exists: true, $ne: '' } },
					{ 'values.question': { $exists: true, $ne: '' } }
				]
			}).limit(500).toArray(),
			MONGO_OP_MS,
			'interviewer responses find'
		);
		const timeOf = (doc) => {
			const v = doc?.updatedAt || doc?.createdAt;
			if (!v) return 0;
			return (v instanceof Date ? v.getTime() : Date.parse(v)) || 0;
		};
		scanned.sort((a, b) => {
			const at = timeOf(a);
			const bt = timeOf(b);
			if (at !== bt) return bt - at;
			return String(b?._id ?? '').localeCompare(String(a?._id ?? ''));
		});
		const docs = scanned.slice(0, 50);

		const items = [];
		const subjectSet = new Set();
		const semesterSet = new Set();

		for (const doc of docs) {
			const vals = doc.values || {};
			const rawQuestions = vals.questions || vals.question || vals.notes || '';
			if (!rawQuestions) continue;

			// Extract Subject
			let subject = vals.subject || doc.examContext?.subject || '';
			if (!subject || subject === 'viva' || subject === 'easy-medium') {
				subject = 'General';
			} else {
				subject = subject.trim();
			}
			subjectSet.add(subject);

			// Extract Semester
			let sem = vals.semester || doc.examContext?.semester || '';
			if (/sem(?:ester)?\s*(\d)/i.test(sem)) {
				const match = sem.match(/sem(?:ester)?\s*(\d)/i);
				sem = `Sem ${match[1]}`;
			} else if (/^\d$/.test(String(sem).trim())) {
				sem = `Sem ${String(sem).trim()}`;
			} else if (doc.examContext?.code && /[A-Z0-9]+(\d)[0-9]{3}/i.test(doc.examContext.code)) {
				const m = doc.examContext.code.match(/[A-Z0-9]+(\d)[0-9]{3}/i);
				sem = `Sem ${m[1]}`;
			} else {
				sem = 'Sem 5';
			}
			semesterSet.add(sem);

			const difficulty = vals.difficulty || 'General';

			// Split comma-separated questions into enhanced new lines
			const enhancedQuestions = splitAndEnhanceQuestions(rawQuestions);

			items.push({
				id: doc._id?.toString() || doc.sessionId,
				sessionId: doc.sessionId,
				subject,
				semester: sem,
				difficulty,
				rawQuestions,
				enhancedQuestions,
				updatedAt: doc.updatedAt || doc.createdAt || new Date().toISOString()
			});
		}

		return {
			formId,
			total: items.length,
			categories: ['All', ...Array.from(subjectSet)],
			semesters: ['All', ...Array.from(semesterSet)],
			items
		};
	} catch (error) {
		console.error('getEnhancedResponses failed:', error);
		return {
			formId,
			total: 0,
			categories: ['All'],
			semesters: ['All'],
			items: []
		};
	}
}

export async function GET({ request, url }) {
	const formId = url.searchParams.get('form') || defaultForm.id;
	const action = url.searchParams.get('action');

	// This handler was the only one here without a top-level try/catch, so any
	// throw became a Cloudflare 500. getEnhancedResponses and loadForm each
	// catch internally, but anything between them (or a future edit) must
	// degrade to a usable response rather than an error page: an empty
	// Responses tab is fine, breaking the modal is not.
	try {
		if (action === 'responses') {
			// Cached for 60s like the other low-churn community reads (releases
			// 300s, notifications 60s). This is the heaviest query on a page
			// load — an unindexed $or scan over form_responses — so serving it
			// from the edge keeps it off Mongo entirely. It only changes when
			// somebody submits a question, so a minute of staleness is free.
			return await cachedResponse(request, 60, async () =>
				json(await getEnhancedResponses(formId))
			);
		}

		return json({ form: await loadForm(formId) });
	} catch (error) {
		console.error('Interviewer GET failed:', error);
		if (action === 'responses') {
			return json({ formId, total: 0, categories: ['All'], semesters: ['All'], items: [] });
		}
		return json({ form: defaultForm });
	}
}

export async function POST({ request }) {
	try {
		const body = await request.json();
		const text = normalise(body.text);
		if (!text) return json({ error: 'An answer is required' }, { status: 400 });

		const form = body.form?.id ? await loadForm(body.form.id) : (body.formId ? await loadForm(body.formId) : defaultForm);
		const fields = form.fields || defaultForm.fields;
		const sessionId = body.sessionId || crypto.randomUUID();
		const examContext = body.examContext || {};
		const userId = tokenUserId(request);
		// Session persistence is best-effort: if Mongo is down the interview
		// still works (extraction + reply) instead of 500ing every submit.
		let sessions = null;
		let existing = null;
		try {
			sessions = await getInterviewerSessionsCollection();
			existing = await withMongoTimeout(
				sessions.findOne({ sessionId }),
				MONGO_OP_MS,
				'interviewer session find'
			);
		} catch (err) {
			console.warn('Interviewer session store unavailable, continuing without persistence:', err?.message);
		}
		const priorExtracted = existing?.extracted || {};
		const priorSkipped = existing?.skipped || [];

		if (sessions) {
			try {
				await withMongoTimeout(
					sessions.updateOne(
						{ sessionId },
						{
							$setOnInsert: { sessionId, formId: form.id, userId, createdAt: new Date() },
							$set: { updatedAt: new Date(), status: 'in_progress', examContext, ...(userId ? { userId } : {}) },
							$push: { messages: { role: 'user', content: text, createdAt: new Date() } }
						},
						{ upsert: true }
					),
					MONGO_OP_MS,
					'interviewer session push user'
				);
			} catch (err) {
				console.warn('Interviewer session persist failed:', err?.message);
			}
		}

		let extractedNew = {};
		let llmReply = '';
		let llmComplete = false;

		// Which field we last asked about. The regex fallback needs this to know
		// where the visitor's reply belongs — without it every turn looked like
		// a blank slate, which is what made it re-ask everything.
		const hintField = nextOpenField({ ...form, fields }, priorExtracted, priorSkipped)?.name || null;

		try {
			const out = await extractWithLlm({
				form: {
					...form,
					fields,
					// The prompt and the fallback both need the live subject list;
					// it lives on examContext, not on the stored form config.
					interview: {
						...(form.interview || {}),
						...(normaliseSubjectOptions(examContext, priorExtracted).length
							? {
									subjectOptions: normaliseSubjectOptions(
										examContext,
										priorExtracted
									)
								}
							: {})
					}
				},
				history: existing?.messages || [],
				latestText: text,
				priorExtracted,
				skipped: priorSkipped
			});
			if (out) {
				// Drop example placeholders the model copied. The prompt's example
				// JSON is unavoidable (without it these models invent field names
				// that match nothing), so a model that copies a value verbatim must
				// not have it stored as though the visitor said it.
				const raw = out.extracted && typeof out.extracted === 'object' ? out.extracted : {};
				for (const [k, v] of Object.entries(raw)) {
					if (isExampleValue(v)) {
						console.warn(`Discarded copied example value for "${k}"`);
						continue;
					}
					extractedNew[k] = v;
				}
				llmReply = out.reply || '';
				// Same for the reply: a placeholder echoed back is not a sentence.
				if (isExampleValue(llmReply)) llmReply = '';
				llmComplete = !!out.complete;
			} else {
				// Every provider is rate-limited or down. This is now the ONLY
				// path that reaches the regex extractor.
				extractedNew = extractFields(text, fields, priorExtracted, hintField);
			}
		} catch (err) {
			console.warn('Falling back to regex extraction:', err?.message);
			extractedNew = extractFields(text, fields, priorExtracted, hintField);
		}

		// Monotonic merge: a good answer is never replaced by a restatement or
		// a stray sentence, only by an explicit correction.
		let { extracted, added, updated } = mergeExtracted(
			{ ...form, fields },
			priorExtracted,
			extractedNew
		);

		// Guarantee forward progress. If nothing usable came back for the field
		// we just asked about, attribute the reply ourselves rather than going
		// round the loop. Sanitise first — a digression must not be parked in a
		// field just because we happened to ask for it.
		if (hintField && extracted[hintField] === undefined && !priorExtracted[hintField]) {
			const guessed = extractFields(text, fields, { ...priorExtracted, ...extracted }, hintField);
			const fieldDef = fields.find((f) => f.name === hintField);
			const value = guessed[hintField] ? sanitiseValue(fieldDef, guessed[hintField]) : null;
			if (value) {
				extracted = { ...extracted, [hintField]: value };
				added = [...added, hintField];
			}
		}

		// Never nag. If we have asked the same field twice and still have nothing
		// for it, take the hint and move on — this is the "it keeps asking for
		// the same value" complaint in its purest form.
		const askedLog = Array.isArray(existing?.asked) ? [...existing.asked] : [];
		if (hintField) askedLog.push(hintField);
		// A turn that captured nothing is recorded as READY_MARKER, not under the
		// field name. The fallback rotates its greeting nudges by counting these,
		// so two greetings in a row can never produce the same sentence — even
		// when the open field changed in between, which per-field counting got
		// wrong and reintroduced the repeat.
		const capturedNothing = Object.keys(extracted).length === 0;
		if (capturedNothing) askedLog.push(READY_MARKER);
		let activeSkipped = priorSkipped;
		let nextField = nextOpenField({ ...form, fields }, extracted, activeSkipped);
		if (nextField && hintField === nextField.name) {
			const times = askedLog.filter((n) => n === hintField).length;
			if (times >= 2 && !activeSkipped.includes(hintField)) {
				activeSkipped = [...activeSkipped, hintField];
				nextField = nextOpenField({ ...form, fields }, extracted, activeSkipped);
			}
		}
		const isFinished = !nextField || llmComplete;
		// Subjects running today for THIS student's division. The client sends
		// the list it resolved from the same seating CSV the exam card uses, so
		// the fallback can name the real options instead of asking an open
		// question the visitor has no way to answer well.
		const subjectOptions = normaliseSubjectOptions(examContext, extracted);
		const reply = isFinished
			? (form?.interview?.completeMessage || llmReply || 'Thanks — your response has been recorded.')
			: questionFor({ ...form, fields }, extracted, activeSkipped, llmReply, {
				askedLog,
				subjectOptions
			});

		if (sessions) {
			try {
				await withMongoTimeout(
					sessions.updateOne(
						{ sessionId },
						{
							$set: {
								updatedAt: new Date(),
								extracted,
								skipped: activeSkipped,
								asked: askedLog.slice(-20),
								status: isFinished ? 'completed' : 'in_progress',
								lastAsked: nextField?.name || null
							},
							$push: { messages: { role: 'assistant', content: reply, createdAt: new Date() } }
						}
					),
					MONGO_OP_MS,
					'interviewer session push assistant'
				);
			} catch (error) {
				console.warn('Interviewer session persist failed:', error?.message);
			}
		}

		// Async persist structured responses to form_responses AND form_submissions (for Admin panel visibility)
		// Bounded: these are kicked off before we return, so an unbounded
		// wedge here keeps the isolate's event loop occupied after we have
		// replied — exactly the state workerd reports as "code had hung".
		// withMongoTimeout guarantees each settles within MONGO_OP_MS, so the
		// isolate always drains instead of latching.
		Promise.allSettled([
			getFormResponsesCollection().then((responses) =>
				withMongoTimeout(
					responses.updateOne(
						{ sessionId },
						{
							$set: {
								formId: form.id,
								kind: form.kind || 'interview',
								sessionId,
								values: extracted,
								skipped: priorSkipped,
								status: isFinished ? 'completed' : 'in_progress',
								userId,
								examContext,
								updatedAt: new Date().toISOString()
							},
							$setOnInsert: { createdAt: new Date().toISOString() }
						},
						{ upsert: true }
					),
					MONGO_OP_MS,
					'interviewer responses upsert'
				)
			),
			isFinished ? getFormsCollection().then((submissions) =>
				withMongoTimeout(
					submissions.updateOne(
						{ sessionId },
						{
							$set: {
								formType: form.id,
								sessionId,
								submittedAt: new Date().toISOString(),
								user: { type: userId ? 'authenticated' : 'anonymous', userId },
								data: extracted,
								status: 'Submitted',
								meta: { source: 'materio-interviewer', examContext }
							},
							$setOnInsert: { createdAt: new Date().toISOString() }
						},
						{ upsert: true }
					),
					MONGO_OP_MS,
					'interviewer submissions upsert'
				)
			) : Promise.resolve()
		]).catch((error) => console.error('Interviewer async persist failed:', error));

		return json({
			sessionId,
			extracted,
			message: reply,
			reply,
			nextField,
			added,
			updated,
			complete: isFinished
		});
	} catch (error) {
		console.error('Interviewer submission failed:', error);
		return json({ error: 'Unable to save this response' }, { status: 500 });
	}
}

export async function PATCH({ request }) {
	try {
		const { sessionId, action, field, values, examContext } = await request.json();
		if (!sessionId) return json({ error: 'sessionId is required' }, { status: 400 });
		let collection = null;
		try {
			collection = await getInterviewerSessionsCollection();
		} catch (err) {
			console.warn('Interviewer session store unavailable:', err?.message);
			return json({ error: 'Interview service is temporarily unavailable. Please try again shortly.' }, { status: 503 });
		}
		const existing = await withMongoTimeout(
			collection.findOne({ sessionId }),
			MONGO_OP_MS,
			'interviewer patch session find'
		);
		if (!existing) return json({ error: 'Session not found' }, { status: 404 });
		const form = await loadForm(existing.formId);
		const fields = form.fields || defaultForm.fields;
		const skipped = existing.skipped || [];
		let extracted = existing.extracted || {};

		// The review step sends the visitor's corrections. Sanitise them exactly
		// like live extraction so a stray sentence cannot be written, then apply
		// them over what we hold — these are deliberate, so they win.
		if (values && typeof values === 'object') {
			const { extracted: cleaned } = mergeExtracted({ ...form, fields }, {}, values);
			extracted = { ...extracted, ...cleaned };
		}

		if (action === 'skip') {
			const target = field || nextOpenField({ ...form, fields }, extracted, skipped)?.name;
			// Non-mutating: this used to push onto the array read straight out of
			// the Mongo document, so a retry could double-skip.
			const nextSkipped = target && !skipped.includes(target) ? [...skipped, target] : skipped;
			const nextField = nextOpenField({ ...form, fields }, extracted, nextSkipped);
			const isFinished = !nextField;
			const reply = isFinished
				? (form?.interview?.completeMessage || 'Thanks — your response has been recorded.')
				: questionFor({ ...form, fields }, extracted, nextSkipped, '');

			await withMongoTimeout(
				collection.updateOne(
					{ sessionId },
					{
						$set: {
							skipped: nextSkipped,
							updatedAt: new Date(),
							status: isFinished ? 'completed' : 'in_progress',
							lastAsked: nextField?.name || null
						},
						$push: { messages: { role: 'assistant', content: reply, createdAt: new Date() } }
					}
				),
				MONGO_OP_MS,
				'interviewer patch skip'
			);

			await getFormResponsesCollection()
				.then((responses) => withMongoTimeout(
					responses.updateOne(
						{ sessionId },
						{ $set: { skipped: nextSkipped, values: extracted, status: isFinished ? 'completed' : 'in_progress', updatedAt: new Date().toISOString() } },
						{ upsert: true }
					),
					MONGO_OP_MS,
					'interviewer patch responses'
				))
				.catch(() => {});

			return json({
				extracted,
				skipped: nextSkipped,
				message: reply,
				reply,
				nextField,
				complete: isFinished
			});
		}

		if (action === 'complete' || action === 'submit') {
			await withMongoTimeout(
				collection.updateOne({ sessionId }, { $set: { status: 'completed', updatedAt: new Date() } }),
				MONGO_OP_MS,
				'interviewer patch complete'
			);
			try {
				const responses = await getFormResponsesCollection();
				await withMongoTimeout(
					responses.updateOne(
						{ sessionId },
						{ $set: { values: extracted, skipped, status: 'completed', examContext: examContext || existing.examContext || {}, updatedAt: new Date().toISOString() } },
						{ upsert: true }
					),
					MONGO_OP_MS,
					'interviewer finalise responses'
				);
				const submissions = await getFormsCollection();
				await withMongoTimeout(
					submissions.updateOne(
						{ sessionId },
						{
							$set: {
								formType: form.id,
								sessionId,
								submittedAt: new Date().toISOString(),
								data: extracted,
								status: 'Submitted',
								meta: { source: 'materio-interviewer', examContext: examContext || existing.examContext || {} }
							},
							$setOnInsert: { createdAt: new Date().toISOString() }
						},
						{ upsert: true }
					),
					MONGO_OP_MS,
					'interviewer finalise submissions'
				);
			} catch (error) {
				console.error('form_responses finalise failed:', error);
			}
			return json({
				success: true,
				complete: true,
				extracted,
				message: form?.interview?.completeMessage || 'Thanks — your response has been recorded.'
			});
		}

		return json({ error: 'Unknown action' }, { status: 400 });
	} catch (error) {
		console.error('Interviewer update failed:', error);
		return json({ error: 'Unable to update session' }, { status: 500 });
	}
}
