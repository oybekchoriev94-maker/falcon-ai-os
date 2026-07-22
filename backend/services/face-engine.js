import crypto from 'crypto';

const FACE_SVC_URL = process.env.FACE_SVC_URL || 'http://face-svc:8082';

export async function extractFace(imageBase64) {
  try {
    const resp = await fetch(`${FACE_SVC_URL}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.success ? data.embedding : null;
  } catch (e) {
    console.error('[FACE] extractFace error:', e.message);
    return null;
  }
}

function getEncryptionKey() {
  const raw = process.env.FACE_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'hex');
  if (key.length === 32) return key;
  console.warn(`[FACE] FACE_ENCRYPTION_KEY noto'g'ri: ${raw.length} simvol, 64 talab. Shifrlanmagan holda ishlatiladi.`);
  return null;
}
const ENC_KEY = getEncryptionKey();
const ALGO = 'aes-256-gcm';

export function l2Norm(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < arr.length; i++) arr[i] /= n;
  return arr;
}

export function cosineSimilarity(a, b) {
  const aNorm = l2Norm(new Float32Array(a));
  const bNorm = l2Norm(new Float32Array(b));
  let dot = 0;
  const len = Math.min(aNorm.length, bNorm.length);
  for (let i = 0; i < len; i++) dot += aNorm[i] * bNorm[i];
  return dot;
}

export function findBestMatch(inputArr, candidates, threshold = 0.45) {
  const inputNorm = l2Norm(new Float32Array(inputArr));
  let best = { match: null, distance: 1.0 };
  for (const c of candidates) {
    if (!c.face_descriptor) continue;
    let stored;
    try {
      const raw = parseDescriptor(c.face_descriptor);
      stored = l2Norm(new Float32Array(raw));
    } catch { continue; }
    let dot = 0;
    const len = Math.min(inputNorm.length, stored.length);
    for (let i = 0; i < len; i++) dot += inputNorm[i] * stored[i];
    const distance = 1 - dot;
    if (distance < best.distance) best = { match: c, distance };
  }
  return best.match && best.distance <= threshold
    ? { match: best.match, distance: best.distance, confidence: 1 - best.distance }
    : { match: null, distance: best.distance, confidence: 0 };
}

function parseDescriptor(stored) {
  if (!stored) return null;
  if (typeof stored !== 'string') return stored;
  const parsed = JSON.parse(stored);
  if (parsed.enc) return decryptDescriptor(stored);
  if (Array.isArray(parsed)) return parsed;
  if (parsed.v && Array.isArray(parsed.data)) return parsed.data;
  return parsed;
}

export function encryptDescriptor(arr) {
  if (!ENC_KEY) return JSON.stringify({ v: 2, model: 'arcface-r100', dims: arr.length, data: Array.from(arr) });
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, ENC_KEY, iv);
  const plain = JSON.stringify(Array.from(arr));
  let enc = cipher.update(plain, 'utf8', 'hex');
  enc += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ v: 2, model: 'arcface-r100', dims: arr.length, enc: true, iv: iv.toString('hex'), tag: authTag, data: enc });
}

export function decryptDescriptor(stored) {
  if (!stored) return null;
  if (typeof stored !== 'string') return stored;
  const parsed = JSON.parse(stored);
  if (!parsed.enc) return parsed.v ? parsed.data : parsed;
  if (!ENC_KEY) throw new Error('FACE_ENCRYPTION_KEY .env da ko\'rsatilmagan');
  const decipher = crypto.createDecipheriv(ALGO, ENC_KEY, Buffer.from(parsed.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'));
  let dec = decipher.update(parsed.data, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return JSON.parse(dec);
}

export function prepareForDb(arr) {
  return encryptDescriptor(arr);
}

export function prepareFromDb(stored) {
  return decryptDescriptor(stored);
}
