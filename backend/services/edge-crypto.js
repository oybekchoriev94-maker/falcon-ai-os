import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ENCRYPTION_KEY_PATTERN = /^[a-f0-9]{64}$/i;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/i;

export class EdgeCryptoConfigurationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'EdgeCryptoConfigurationError';
  }
}

function encryptionKey(env = process.env) {
  const encoded = String(env.EDGE_KEY_ENCRYPTION_KEY || '');
  if (!ENCRYPTION_KEY_PATTERN.test(encoded)) {
    throw new EdgeCryptoConfigurationError(
      'EDGE_KEY_ENCRYPTION_KEY 32-byte hex secret bo\'lishi kerak'
    );
  }
  return Buffer.from(encoded, 'hex');
}

export function generateEdgeSigningSecret() {
  return randomBytes(32).toString('hex');
}

export function encryptEdgeSigningSecret(secret, env = process.env) {
  const value = String(secret || '');
  if (!HEX_64_PATTERN.test(value)) {
    throw new EdgeCryptoConfigurationError('Edge signing secret 32-byte hex bo\'lishi kerak');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptEdgeSigningSecret(payload, env = process.env) {
  const [version, ivHex, tagHex, ciphertextHex, extra] = String(payload || '').split(':');
  if (
    version !== 'v1'
    || extra !== undefined
    || !/^[a-f0-9]{24}$/i.test(ivHex || '')
    || !/^[a-f0-9]{32}$/i.test(tagHex || '')
    || !/^[a-f0-9]+$/i.test(ciphertextHex || '')
  ) {
    throw new EdgeCryptoConfigurationError('Edge signing secret ciphertext yaroqsiz');
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(env),
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new EdgeCryptoConfigurationError('Edge signing secret decrypt qilinmadi', {
      cause: error,
    });
  }
}

export function sha256Hex(body) {
  return createHash('sha256').update(body).digest('hex');
}

export function buildEdgeSignature({ secret, method, path, timestamp, nonce, body }) {
  const bodyHash = sha256Hex(body);
  const canonical = [method.toUpperCase(), path, String(timestamp), nonce, bodyHash].join('\n');
  return {
    bodyHash,
    signature: createHmac('sha256', secret).update(canonical).digest('hex'),
  };
}

export function safeHexEqual(left, right) {
  if (!HEX_64_PATTERN.test(String(left || '')) || !HEX_64_PATTERN.test(String(right || ''))) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
