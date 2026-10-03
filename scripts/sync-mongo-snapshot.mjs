// Nightly snapshot: dumps the deploy version manifest (releases.json)
// from MongoDB into static/assets/data/releases.json.
//
// Why this exists: the health handler derives the served version string
// from the bundle-time static file (no live Mongo read on that endpoint),
// so the file must stay fresh across deploys without a manual bump.
// Promotions / releases API reads and exam config intentionally serve
// Mongo-only — a committed snapshot there was silently promoted to a
// source of truth (dead promos, past exams), so those dumps are gone.
//
// Usage:
//   MONGODB_URI="mongodb+srv://..." node scripts/sync-mongo-snapshot.mjs
//   npm run sync:snapshots   (reads MONGODB_URI from .env)
//
// Exit 0 even when nothing changed; prints what it did.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dataDir = join(root, 'static', 'assets', 'data');

const require = createRequire(join(root, 'package.json'));
const { MongoClient } = require('mongodb');

function loadDotenv(path) {
  const out = {};
  let src = '';
  try {
    src = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const rawLine of src.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const uri =
  process.env.MONGODB_URI || loadDotenv(join(root, '.env')).MONGODB_URI || '';
if (!uri) {
  console.error('MONGODB_URI is not set (env or .env). Nothing synced.');
  process.exit(1);
}

const stripId = (doc) => {
  if (!doc || typeof doc !== 'object') return doc;
  const { _id, ...rest } = doc;
  return rest;
};

function writeIfChanged(filename, data) {
  const path = join(dataDir, filename);
  const next = JSON.stringify(data, null, 2) + '\n';
  let prev = null;
  try {
    prev = readFileSync(path, 'utf8');
  } catch {}
  if (prev === next) {
    console.log(`- ${filename}: unchanged`);
    return false;
  }
  writeFileSync(path, next, 'utf8');
  console.log(`- ${filename}: updated`);
  return true;
}

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 15000
});

try {
  await client.connect();
  const db = client.db('materio');
  let changed = 0;

  // Releases — the file holds the full array.
  const releases = await db.collection('releases').find({}).toArray();
  if (releases.length > 0) {
    if (writeIfChanged('releases.json', releases.map(stripId))) changed++;
  } else {
    console.log('- releases.json: collection empty, leaving file as-is');
  }

  console.log(changed > 0 ? `Done. ${changed} file(s) updated.` : 'Done. All snapshots already fresh.');
} catch (err) {
  console.error('Snapshot sync failed:', err.message);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
