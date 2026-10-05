#!/usr/bin/env node
/**
 * Regression guard: every Mongo driver op on a server path must be raced
 * against withMongoTimeout.
 *
 * Why this is an outage and not a "slow path": when the pool is poisoned a
 * queued checkout wedges with NOTHING pending — no driver timeout fires and
 * try/catch cannot help, because nothing ever throws. The event is left open
 * forever and workerd kills it with
 *
 *   "detected that your Worker's code had hung and would never generate a
 *    response"
 *
 * That kill LATCHES the isolate, so every later request routed to it dies in
 * ~7ms with a Cloudflare HTML 500. Requests round-robin between isolates, so
 * the user-visible symptom was a burst of unrelated endpoints failing
 * together — releases, popups, notebooks and the interviewer's Responses tab
 * all 500ing at once — and nothing the client did made any difference.
 *
 * This was NOT limited to one route: /api/interviewer had 13 unwrapped ops
 * while features-handler.js had 31 more, health-handler.js 6 and webpush.js 3.
 * A single unwrapped op is a latent outage, so the check is repo-wide.
 *
 * Dependency-free source check, so it runs in the CI test job which installs
 * nothing by design. Pass a file path to check a doctored copy.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ROOTS = [
	join(root, 'src', 'routes', 'api'),
	join(root, 'src', 'lib', 'server')
];

const WRAP = /withMongoTimeout\s*\(/;
// Mongo call shapes. `.find(` is deliberately excluded: `arr.find(...)` is a
// plain Array.find in several of these files.
const OP =
	/(?:\.)?(?:findOne|findOneAndUpdate|updateOne|updateMany|insertOne|insertMany|deleteOne|deleteMany|bulkWrite|countDocuments|distinct|aggregate|estimatedDocumentCount|toArray)\s*\(/;
// Lines that begin a NEW statement, used to prove a chained .toArray() still
// belongs to the nearest enclosing withMongoTimeout( call.
const STMT_START =
	/^\s*(?:const|let|var|await|return|if|else|for|while|throw|}\s*catch|\.then\b|\})\s/;

/** Comment lines talk about toArray()/findOne() and must not count as ops. */
const isComment = (line) => {
	const t = line.trim();
	return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--');
};

function walk(dir, acc = []) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return acc;
	}
	for (const name of entries) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, acc);
		else if (name === '+server.js' || /\.(?:js|ts)$/.test(name)) acc.push(p);
	}
	return acc;
}

function checkFile(file) {
	const lines = readFileSync(file, 'utf8').split(/\r?\n/);
	const bare = [];

	lines.forEach((line, i) => {
		if (isComment(line)) return;
		if (!OP.test(line)) return;

		const n = i + 1;
		if (/\.toArray\s*\(/.test(line)) {
			// Chained continuation of a multi-line argument list.
			let anchor = -1;
			for (let k = n - 1; k >= 0; k--) {
				if (WRAP.test(lines[k])) { anchor = k; break; }
			}
			if (anchor === -1) {
				bare.push(`${n}: ${line.trim()}`);
				return;
			}
			for (let k = anchor + 1; k < n - 1; k++) {
				if (!isComment(lines[k]) && STMT_START.test(lines[k])) {
					bare.push(`${n}: ${line.trim()}  (statement opened at ${k + 1})`);
					return;
				}
			}
			return;
		}

		const same = WRAP.test(line);
		const prev = i > 0 && !isComment(lines[i - 1]) ? WRAP.test(lines[i - 1]) : false;
		if (!same && !prev) bare.push(`${n}: ${line.trim()}`);
	});

	return bare;
}

const files = process.argv[2]
	? [process.argv[2]]
	: ROOTS.flatMap((r) => walk(r)).sort();

let total = 0;
const failures = [];

for (const f of files) {
	const bare = checkFile(f);
	if (!bare.length) continue;
	total += bare.length;
	failures.push(`\n  ${relative(root, f).replace(/\\/g, '/')}`);
	for (const b of bare) failures.push(`    line ${b}`);
}

if (total) {
	console.error(`FAIL mongo timeout guard: ${total} unwrapped Mongo op(s) in ${failures.length} file(s)`);
	console.error(failures.join('\n'));
	process.exit(1);
}

console.log(`PASS mongo timeout guard: ${files.length} server files, every Mongo op bounded`);