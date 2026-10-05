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
import {
	normalise,
	extractFields,
	mergeExtracted,
	sanitiseValue,
	nextOpenField,
	isSatisfied,
	buildSystemPrompt
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
 */
function questionFor(form, extracted, skipped, llmReply) {
	if (llmReply && llmReply.trim()) return llmReply.trim();
	const next = nextOpenField(form, extracted, skipped);
	if (!next) return form?.interview?.completeMessage || 'Thanks — your response has been recorded.';

	const answered = Object.keys(extracted || {}).length > 0;
	if (!answered) {
		return "No rush — whenever you're ready, what would you like to tell me about?";
	}

	let ask = String(next.label || '').trim().replace(/[?.!]+$/, '');
	if (!ask) ask = 'anything else';
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
 * Runs the turn through the provider chain in interviewer-llm.js.
 *
 * Returns null when no provider could answer — the ONLY case where the regex
 * extractor is used. Previously a single 429 from the last provider in the list
 * sent the whole conversation down that path, which is why replies came across
 * blunt and templated.
 */
async function extractWithLlm({ form, history, latestText, priorExtracted = {}, skipped = [] }) {
	const system = buildSystemPrompt({ form, priorExtracted, skipped });
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
		const docs = await withMongoTimeout(
			collection.find({
				$or: [
					{ formId },
					{ 'values.questions': { $exists: true, $ne: '' } },
					{ 'values.question': { $exists: true, $ne: '' } }
				]
			}).sort({ updatedAt: -1, createdAt: -1 }).limit(50).toArray(),
			MONGO_OP_MS,
			'interviewer responses find'
		);

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

export async function GET({ url }) {
	const formId = url.searchParams.get('form') || defaultForm.id;
	const action = url.searchParams.get('action');

	if (action === 'responses') {
		const data = await getEnhancedResponses(formId);
		return json(data);
	}

	return json({ form: await loadForm(formId) });
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
				form: { ...form, fields },
				history: existing?.messages || [],
				latestText: text,
				priorExtracted,
				skipped: priorSkipped
			});
			if (out) {
				extractedNew = out.extracted || {};
				llmReply = out.reply || '';
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
		const reply = isFinished
			? (form?.interview?.completeMessage || llmReply || 'Thanks — your response has been recorded.')
			: questionFor({ ...form, fields }, extracted, activeSkipped, llmReply);

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
