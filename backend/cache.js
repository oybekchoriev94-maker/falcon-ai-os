const REDIS_URL = process.env.REDIS_URL;

let client = null;
let fallbackStore = new Map();
const fallbackMode = !REDIS_URL;

export async function initCache() {
  if (REDIS_URL) {
    try {
      const { createClient } = await import('redis');
      client = createClient({ url: REDIS_URL });
      client.on('error', (e) => { console.warn('[CACHE] Redis xatosi:', e.message); });
      await client.connect();
      console.log('[CACHE] Redis connected');
      return true;
    } catch (e) {
      console.warn('[CACHE] Redis ulanmadi, in-memory cache ishlaydi:', e.message);
    }
  }
  return false;
}

export async function get(key) {
  if (client?.isOpen) {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  }
  const entry = fallbackStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { fallbackStore.delete(key); return null; }
  return entry.value;
}

export async function set(key, value, ttlSeconds = 300) {
  if (client?.isOpen) {
    await client.setEx(key, ttlSeconds, JSON.stringify(value));
  } else {
    fallbackStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

export async function del(key) {
  if (client?.isOpen) { await client.del(key); }
  else { fallbackStore.delete(key); }
}

export async function cachedQuery(key, queryFn, ttlSeconds = 300) {
  const cached = await get(key);
  if (cached) return cached;
  const result = await queryFn();
  await set(key, result, ttlSeconds);
  return result;
}

export async function disconnectCache() {
  if (client) { try { await client.disconnect(); } catch {} }
}
