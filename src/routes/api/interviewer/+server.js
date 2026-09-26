import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	getFormConfigsCollection,
	getInterviewerSessionsCollection,
	getFormResponsesCollection,
	getFormsCollection
} from '$lib/server/mongodb.js';
import { verifyToken } from '$lib/server/supabase.js';

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

function normalise(text) {
	return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractFields(text, fields) {
	const answer = normalise(text);
	const values = {};
	for (const field of fields) {
		const label = String(field.label || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (!label) continue;
		const match = answer.match(new RegExp(`${label}\\s*(?:is|:|-)?\\s*([^.;]+)`, 'i'));
		if (match && match[1].trim()) values[field.name] = match[1].trim();
	}
	if (fields[0] && !values[fields[0].name] && answer) values[fields[0].name] = answer;
	if (fields.some((field) => field.name === 'subject') && !values.subject) {
		const subjectMatch = answer.match(/(?:on|about|for|in)\s+([A-Za-z0-9 &'/-]+?)(?:[,.]|$)/i);
		if (subjectMatch) values.subject = subjectMatch[1].trim();
	}
	const diff = answer.match(/\b(easy|moderate|challenging|hard|tough)\b/i);
	if (diff && fields.some((f) => f.name === 'difficulty')) {
		const d = diff[1].toLowerCase();
		values.difficulty = d === 'hard' || d === 'tough' ? 'Challenging' : d.charAt(0).toUpperCase() + d.slice(1);
	}
	return values;
}

function nextOpenField(form, extracted = {}, skipped = []) {
	const fields = form.fields || [];
	// Prioritize required fields first
	const nextReq = fields.find((f) => f.required && !extracted[f.name] && !skipped.includes(f.name));
	if (nextReq) return nextReq;
	// Then ask remaining optional fields
	const nextOpt = fields.find((f) => !extracted[f.name] && !skipped.includes(f.name));
	return nextOpt || null;
}

function questionFor(form, extracted, skipped, llmReply) {
	if (llmReply) return llmReply;
	const next = nextOpenField(form, extracted, skipped);
	if (!next) return form?.interview?.completeMessage || 'Thanks — your response has been recorded.';
	if (Object.keys(extracted).length === 0 && form?.interview?.openingQuestion) return form.interview.openingQuestion;
	const skipHint = form?.interview?.skipAllowed !== false ? ' (You can skip this if you like.)' : '';
	return `Got it. What about "${next.label}"?${skipHint}`;
}

async function extractWithLlm({ form, history, latestText, priorExtracted = {}, skipped = [] }) {
	const fields = form.fields || [];
	const nextField = nextOpenField(form, priorExtracted, skipped);
	const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_AI_KEY;
	const nvidiaKey = env.NVIDIA_API_KEY || env.NVIDIA_NIM_KEY;
	const openRouterKey = env.OPENROUTER_API_KEY;

	const systemPrompt = [
		form?.interview?.systemPrompt || 'You turn natural-language answers into structured form values. Be concise.',
		`Form Fields JSON: ${JSON.stringify(fields.map(f => ({ name: f.name, label: f.label, required: !!f.required, options: f.options || [] })))}.`,
		`Already extracted values: ${JSON.stringify(priorExtracted)}.`,
		nextField ? `Target to collect next: "${nextField.label}" (name: "${nextField.name}", ${nextField.required ? 'required' : 'optional'}).` : 'All fields have been answered or skipped.',
		`Reply ONLY with valid raw JSON in this format:
{"extracted": { "fieldName": "value" }, "reply": "Your brief conversational follow-up or confirmation asking the next question", "complete": false}
Set "complete" to true ONLY when all questions (both required and optional) have been asked or skipped.`
	].join('\n');

	// 1. Google AI Studio (Gemini)
	if (geminiKey) {
		try {
			const model = env.INTERVIEWER_MODEL || 'gemini-1.5-flash';
			const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					systemInstruction: { parts: [{ text: systemPrompt }] },
					contents: [
						...(history || []).slice(-8).map(m => ({
							role: m.role === 'assistant' ? 'model' : 'user',
							parts: [{ text: String(m.content).slice(0, 800) }]
						})),
						{ role: 'user', parts: [{ text: latestText }] }
					],
					generationConfig: {
						responseMimeType: 'application/json',
						temperature: 0.3
					}
				})
			});
			if (res.ok) {
				const data = await res.json();
				const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
				const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
				return { extracted: parsed.extracted || {}, reply: parsed.reply || '', complete: !!parsed.complete };
			}
		} catch (err) {
			console.warn('Gemini extraction failed, trying next provider:', err?.message);
		}
	}

	// 2. NVIDIA NIM
	if (nvidiaKey) {
		try {
			const model = env.INTERVIEWER_MODEL || 'meta/llama-3.3-70b-instruct';
			const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${nvidiaKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model,
					temperature: 0.3,
					messages: [
						{ role: 'system', content: systemPrompt },
						...(history || []).slice(-8).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content).slice(0, 800) })),
						{ role: 'user', content: latestText }
					]
				})
			});
			if (res.ok) {
				const data = await res.json();
				const raw = data?.choices?.[0]?.message?.content || '';
				const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
				return { extracted: parsed.extracted || {}, reply: parsed.reply || '', complete: !!parsed.complete };
			}
		} catch (err) {
			console.warn('NVIDIA extraction failed, trying OpenRouter:', err?.message);
		}
	}

	// 3. OpenRouter (Default)
	if (openRouterKey) {
		const model = env.INTERVIEWER_MODEL || 'openrouter/free';
		const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${openRouterKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'https://getmaterio.app',
				'X-Title': 'Materio Interviewer'
			},
			body: JSON.stringify({
				model,
				temperature: 0.3,
				messages: [
					{ role: 'system', content: systemPrompt },
					...(history || []).slice(-8).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content).slice(0, 800) })),
					{ role: 'user', content: latestText }
				]
			})
		});
		if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
		const data = await res.json();
		const raw = data?.choices?.[0]?.message?.content || '';
		const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
		return { extracted: parsed.extracted || {}, reply: parsed.reply || '', complete: !!parsed.complete };
	}

	throw new Error('No AI provider key configured');
}

async function loadForm(formId) {
	try {
		const configs = await getFormConfigsCollection();
		const configured = await configs.findOne({ id: formId, published: true });
		if (configured) {
			const { _id, ...rest } = configured;
			return rest;
		}
	} catch (error) {
		console.error('Interviewer form config lookup failed:', error);
	}
	return { ...defaultForm, id: formId };
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
		const docs = await collection.find({
			$or: [
				{ formId },
				{ 'values.questions': { $exists: true, $ne: '' } },
				{ 'values.question': { $exists: true, $ne: '' } }
			]
		}).sort({ updatedAt: -1, createdAt: -1 }).limit(50).toArray();

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
			existing = await sessions.findOne({ sessionId });
		} catch (err) {
			console.warn('Interviewer session store unavailable, continuing without persistence:', err?.message);
		}
		const priorExtracted = existing?.extracted || {};
		const priorSkipped = existing?.skipped || [];

		if (sessions) {
			try {
				await sessions.updateOne(
					{ sessionId },
					{
						$setOnInsert: { sessionId, formId: form.id, userId, createdAt: new Date() },
						$set: { updatedAt: new Date(), status: 'in_progress', examContext, ...(userId ? { userId } : {}) },
						$push: { messages: { role: 'user', content: text, createdAt: new Date() } }
					},
					{ upsert: true }
				);
			} catch (err) {
				console.warn('Interviewer session persist failed:', err?.message);
			}
		}

		let extractedNew = {};
		let llmReply = '';
		let llmComplete = false;

		try {
			const out = await extractWithLlm({
				form: { ...form, fields },
				history: existing?.messages || [],
				latestText: text,
				priorExtracted,
				skipped: priorSkipped
			});
			extractedNew = out.extracted || {};
			llmReply = out.reply || '';
			llmComplete = !!out.complete;
		} catch (err) {
			console.warn('Falling back to regex extraction:', err?.message);
			extractedNew = extractFields(text, fields);
		}

		const extracted = { ...priorExtracted, ...extractedNew };
		const nextField = nextOpenField({ ...form, fields }, extracted, priorSkipped);
		const isFinished = !nextField || llmComplete;
		const reply = isFinished
			? (form?.interview?.completeMessage || llmReply || 'Thanks — your response has been recorded.')
			: questionFor({ ...form, fields }, extracted, priorSkipped, llmReply);

		if (sessions) {
			try {
				await sessions.updateOne(
					{ sessionId },
					{
						$set: { updatedAt: new Date(), extracted, status: isFinished ? 'completed' : 'in_progress' },
						$push: { messages: { role: 'assistant', content: reply, createdAt: new Date() } }
					}
				);
			} catch (error) {
				console.warn('Interviewer session persist failed:', error?.message);
			}
		}

		// Async persist structured responses to form_responses AND form_submissions (for Admin panel visibility)
		Promise.allSettled([
			getFormResponsesCollection().then((responses) =>
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
				)
			),
			isFinished ? getFormsCollection().then((submissions) =>
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
				)
			) : Promise.resolve()
		]).catch((error) => console.error('Interviewer async persist failed:', error));

		return json({
			sessionId,
			extracted,
			message: reply,
			reply,
			nextField,
			complete: isFinished
		});
	} catch (error) {
		console.error('Interviewer submission failed:', error);
		return json({ error: 'Unable to save this response' }, { status: 500 });
	}
}

export async function PATCH({ request }) {
	try {
		const { sessionId, action, field, examContext } = await request.json();
		if (!sessionId) return json({ error: 'sessionId is required' }, { status: 400 });
		let collection = null;
		try {
			collection = await getInterviewerSessionsCollection();
		} catch (err) {
			console.warn('Interviewer session store unavailable:', err?.message);
			return json({ error: 'Interview service is temporarily unavailable. Please try again shortly.' }, { status: 503 });
		}
		const existing = await collection.findOne({ sessionId });
		if (!existing) return json({ error: 'Session not found' }, { status: 404 });
		const form = await loadForm(existing.formId);
		const fields = form.fields || defaultForm.fields;
		const skipped = existing.skipped || [];
		const extracted = existing.extracted || {};

		if (action === 'skip') {
			const target = field || nextOpenField({ ...form, fields }, extracted, skipped)?.name;
			if (target && !skipped.includes(target)) skipped.push(target);
			const nextField = nextOpenField({ ...form, fields }, extracted, skipped);
			const isFinished = !nextField;
			const reply = isFinished
				? (form?.interview?.completeMessage || 'Thanks — your response has been recorded.')
				: questionFor({ ...form, fields }, extracted, skipped, '');

			await collection.updateOne(
				{ sessionId },
				{
					$set: { skipped, updatedAt: new Date(), status: isFinished ? 'completed' : 'in_progress' },
					$push: { messages: { role: 'assistant', content: reply, createdAt: new Date() } }
				}
			);

			await getFormResponsesCollection()
				.then((responses) => responses.updateOne(
					{ sessionId },
					{ $set: { skipped, values: extracted, status: isFinished ? 'completed' : 'in_progress', updatedAt: new Date().toISOString() } },
					{ upsert: true }
				))
				.catch(() => {});

			return json({
				extracted,
				skipped,
				message: reply,
				reply,
				nextField,
				complete: isFinished
			});
		}

		if (action === 'complete' || action === 'submit') {
			await collection.updateOne({ sessionId }, { $set: { status: 'completed', updatedAt: new Date() } });
			try {
				const responses = await getFormResponsesCollection();
				await responses.updateOne(
					{ sessionId },
					{ $set: { values: extracted, skipped, status: 'completed', examContext: examContext || existing.examContext || {}, updatedAt: new Date().toISOString() } },
					{ upsert: true }
				);
				const submissions = await getFormsCollection();
				await submissions.updateOne(
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
