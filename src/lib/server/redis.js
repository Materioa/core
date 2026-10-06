import { Redis } from '@upstash/redis';
import { env } from '$env/dynamic/private';

let redisInstance = null;
let isConfigured = null;

/**
 * Returns the Upstash Redis client instance, or null if unconfigured.
 */
export function getRedis() {
  if (isConfigured === false) return null;
  if (redisInstance) return redisInstance;

  const url = env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL || env.REDIS_URL || process.env.REDIS_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || env.REDIS_TOKEN || process.env.REDIS_TOKEN;

  if (!url || !token) {
    if (isConfigured === null) {
      console.warn('[Redis] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not configured. Running without Redis cache.');
      isConfigured = false;
    }
    return null;
  }

  try {
    redisInstance = new Redis({ url, token });
    isConfigured = true;
    return redisInstance;
  } catch (err) {
    console.error('[Redis] Failed to initialize Upstash Redis client:', err.message);
    isConfigured = false;
    return null;
  }
}

/**
 * Get a parsed JSON value or raw value from Redis.
 */
export async function redisGet(key) {
  try {
    const client = getRedis();
    if (!client) return null;
    const res = await client.get(key);
    if (res === null || res === undefined) return null;
    if (typeof res === 'object') return res;
    try {
      return JSON.parse(res);
    } catch {
      return res;
    }
  } catch (err) {
    console.warn(`[Redis] GET failed for "${key}":`, err.message);
    return null;
  }
}

/**
 * Store a value in Redis with a TTL in seconds.
 */
export async function redisSet(key, value, ttlSeconds = 300) {
  try {
    const client = getRedis();
    if (!client) return false;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await client.set(key, serialized, { ex: ttlSeconds });
    } else {
      await client.set(key, serialized);
    }
    return true;
  } catch (err) {
    console.warn(`[Redis] SET failed for "${key}":`, err.message);
    return false;
  }
}

/**
 * Delete a key from Redis.
 */
export async function redisDel(key) {
  try {
    const client = getRedis();
    if (!client) return false;
    await client.del(key);
    return true;
  } catch (err) {
    console.warn(`[Redis] DEL failed for "${key}":`, err.message);
    return false;
  }
}
