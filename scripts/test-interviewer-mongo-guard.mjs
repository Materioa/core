#!/usr/bin/env node
/**
 * Regression guard: every Mongo driver op in the interviewer route must be
 * raced against withMongoTimeout.
 *
 * Why this is an outage and not a "slow path": when the pool is poisoned a
 * queued checkout wedges with NOTHING pending — no driver timeout fires and
 * try/catch can't help, because nothing ever throws. The event is left open
 * forever and workerd kills it with
 *
 *   "detected that your Worker's code had hung and would never generate a
 *    response"
 *
 * That kill LATCHES the isolate, so every later request routed to it dies in
 * ~7ms with a Cloudflare HTML 500. Because requests round-robin between
 * isolates, the user-visible symptom was a perfect 500/200 alternation on
 * every other request — unaffected by incognito, retries or a fresh browser.
 *
 * features-handler.js has bounded all 11 of its ops this way; this route was
 * the only one with none, and it was the route throwing every "hung" event.
 *
 * This is a dependency-free source check so it can run in the CI test job,
 * which installs nothing by design.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// argv[2] lets the guard run against a doctored copy when verifying it fails.
const file = process.argv[2] || join(root, 'src', 'routes', 'api', 'interviewer', '+server.js');

const source = readFileSync(file, 'utf8');
const lines = source.split(/\r?\n/);

const WRAP = /withMongoTimeout\s*\(/;
// Mongo call shapes. Deliberately NOT `.find(` — `fields.find(...)` is a
// plain Array.find in this file and would be a false positive.
const OP = /(?:\.)?(?:findOne|findOneAndUpdate|updateOne|updateMany|insertOne|insertMany|deleteOne|deleteMany|countDocuments|toArray)\s*\(/;
// Lines that would begin a NEW statement, used to prove a chained .toArray()
// still belongs to the nearest enclosing withMongoTimeout( call.
const STMT_START = /^\s*(?:const|let|var|await|return|if|else|for|while|throw|}\s*catch)\b/;

const openers = [];
const ops = [];

lines.forEach((line, i) => {
	const n = i + 1;
	if (WRAP.test(line)) openers.push(n);
	if (OP.test(line)) ops.push({ n, text: line.trim() });
});

const failures = [];

// Rule 1 — one wrapper per op. Catches an op added with no wrapper at all.
if (openers.length !== ops.length) {
	failures.push(
		`expected one withMongoTimeout( per Mongo op, found ${openers.length} wrappers and ${ops.length} ops`
	);
}

// Rule 2 — findOne/updateOne must be the argument of a wrapper, i.e. on the
// wrapper's own line or the line directly after it (both call styles).
// Chained .toArray() is a multi-line argument, so it is Rule 3's job.
for (const op of ops) {
	if (/\.toArray\s*\(/.test(op.text)) continue;
	const prev = lines[op.n - 2] || '';
	const same = lines[op.n - 1] || '';
	const wrapped = WRAP.test(same) || WRAP.test(prev);
	if (!wrapped) {
		failures.push(`line ${op.n}: unwrapped Mongo op -> ${op.text}`);
	}
}

// Rule 3 — a chained .toArray() must live inside the nearest wrapper's
// argument list, with no new statement starting in between.
const toArrayOps = ops.filter((o) => /\.toArray\s*\(/.test(o.text));
for (const op of toArrayOps) {
	let anchor = -1;
	for (let i = op.n - 1; i >= 0; i--) {
		if (WRAP.test(lines[i])) { anchor = i; break; }
	}
	if (anchor === -1) {
		failures.push(`line ${op.n}: .toArray() with no enclosing withMongoTimeout( -> ${op.text}`);
		continue;
	}
	for (let i = anchor + 1; i < op.n - 1; i++) {
		if (STMT_START.test(lines[i])) {
			failures.push(
				`line ${op.n}: .toArray() sits after a new statement (line ${i + 1}) that is not wrapped`
			);
			break;
		}
	}
}

if (failures.length) {
	console.error('FAIL interviewer Mongo guard:');
	for (const f of failures) console.error('  - ' + f);
	process.exit(1);
}

console.log(`PASS interviewer Mongo guard: ${ops.length} ops, all wrapped in withMongoTimeout`);
