// Nightly snapshot: dumps the live MongoDB collections that back the public
// read APIs (promotions / releases / examdata) into static/assets/data/*.json.
//
// Why this exists: the API handlers fall back to those static files when
// Mongo is unreachable from the edge. The bundled files go stale (e.g. a
// disabled June promo still marked enabled, past exams only), so a stale
// fallback silently serves wrong data. This script keeps the fallback fresh:
// run it locally after changing promos/releases/exams, and daily via the
// `sync-snapshots.yml` GitHub Action (which commits only when content changed).
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

// Same active-promo selection as handlePromotionsFeature (features-handler.js).
function pickActivePromo(promos) {
  const now = new Date();
  const enabled = (promos || []).filter((p) => p && p.enabled);
  return (
    enabled.find((promo) => {
      if (!promo.isLimitedOffer) return true;
      if (!promo.startDate || !promo.endDate) return true;
      const start = new Date(promo.startDate);
      const end = new Date(promo.endDate);
      return now >= start && now <= end;
    }) || null
  );
}

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 15000
});

try {
  await client.connect();
  const db = client.db('materio');
  let changed = 0;

  // 1. Promotions — the file holds the single active promo object.
  const promos = await db
    .collection('promotions')
    .find({})
    .sort({ lastUpdated: -1, _id: -1 })
    .toArray();
  const active = pickActivePromo(promos);
  if (active) {
    if (writeIfChanged('promo.json', stripId(active))) changed++;
  } else {
    console.log('- promo.json: no active promo in Mongo, leaving file as-is');
  }

  // 2. Releases — the file holds the full array.
  const releases = await db.collection('releases').find({}).toArray();
  if (releases.length > 0) {
    if (writeIfChanged('releases.json', releases.map(stripId))) changed++;
  } else {
    console.log('- releases.json: collection empty, leaving file as-is');
  }

  // 3. Examdata — the file holds the single config object.
  const config =
    (await db.collection('examdata').findOne({ type: 'config' })) ||
    (await db.collection('examdata').findOne({ semesters: { $exists: true } })) ||
    (await db.collection('examdata').findOne({}));
  if (config && (Array.isArray(config.semesters) || config.enabled === false)) {
    if (writeIfChanged('examdata.json', stripId(config))) changed++;
  } else {
    console.log('- examdata.json: no usable config in Mongo, leaving file as-is');
  }

  console.log(changed > 0 ? `Done. ${changed} file(s) updated.` : 'Done. All snapshots already fresh.');
} catch (err) {
  console.error('Snapshot sync failed:', err.message);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
