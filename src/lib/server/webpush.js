import webpush from 'web-push';
import { getMongoDb } from './mongodb.js';
import { env } from '$env/dynamic/private';

const VAPID_PUBLIC_KEY = env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = env.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = env.VAPID_SUBJECT || process.env.VAPID_SUBJECT || 'mailto:support@materioapp.in';
const COLLECTION_NAME = 'web_push_subscriptions';

let vapidConfigured = false;

export function isWebPushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY;
}

function ensureVapidConfigured() {
  if (vapidConfigured) return;
  if (!isWebPushConfigured()) {
    throw new Error('VAPID keys are not configured');
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidConfigured = true;
}

function normalizeSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object') {
    throw new Error('Invalid subscription payload');
  }

  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys?.p256dh;
  const auth = subscription.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    throw new Error('Subscription must include endpoint, p256dh, and auth keys');
  }

  return {
    endpoint,
    expirationTime: subscription.expirationTime || null,
    keys: { p256dh, auth }
  };
}

async function getPushCollection() {
  const db = await getMongoDb();
  return db.collection(COLLECTION_NAME);
}

export async function upsertWebPushSubscription(subscription, meta = {}) {
  const normalized = normalizeSubscription(subscription);
  const collection = await getPushCollection();
  const now = new Date();

  await collection.updateOne(
    { endpoint: normalized.endpoint },
    {
      $set: {
        subscription: normalized,
        endpoint: normalized.endpoint,
        userAgent: meta.userAgent || null,
        ip: meta.ip || null,
        enabled: true,
        updatedAt: now,
        lastSeenAt: now
      },
      $setOnInsert: {
        createdAt: now
      }
    },
    { upsert: true }
  );

  return { endpoint: normalized.endpoint };
}

export async function removeWebPushSubscription(endpoint) {
  if (!endpoint) return { removed: 0 };

  const collection = await getPushCollection();
  const result = await collection.deleteOne({ endpoint });
  return { removed: result.deletedCount || 0 };
}

export async function sendWebPushToAll(payload) {
  if (!isWebPushConfigured()) {
    return { sent: 0, failed: 0, removed: 0, skipped: true };
  }

  ensureVapidConfigured();

  const collection = await getPushCollection();
  const subscriptions = await collection.find({ enabled: { $ne: false } }).toArray();

  if (!subscriptions.length) {
    return { sent: 0, failed: 0, removed: 0, skipped: false };
  }

  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const doc of subscriptions) {
    try {
      await webpush.sendNotification(doc.subscription, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = error?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await collection.deleteOne({ endpoint: doc.endpoint });
        removed += 1;
      }
    }
  }

  return { sent, failed, removed, skipped: false };
}
