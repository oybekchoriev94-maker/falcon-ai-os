import { describe, expect, it } from 'vitest';

import {
  buildEdgeSignature,
  decryptEdgeSigningSecret,
  EdgeCryptoConfigurationError,
  encryptEdgeSigningSecret,
  generateEdgeSigningSecret,
  safeHexEqual,
} from '../backend/services/edge-crypto.js';

const env = {
  EDGE_KEY_ENCRYPTION_KEY:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('Edge signing key cryptography', () => {
  it('generates and encrypts a secret without storing it in plaintext', () => {
    const secret = generateEdgeSigningSecret();
    const ciphertext = encryptEdgeSigningSecret(secret, env);

    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain(secret);
    expect(decryptEdgeSigningSecret(ciphertext, env)).toBe(secret);
  });

  it('rejects a modified authenticated ciphertext', () => {
    const ciphertext = encryptEdgeSigningSecret('a'.repeat(64), env);
    const modified = `${ciphertext.slice(0, -1)}${ciphertext.endsWith('0') ? '1' : '0'}`;

    expect(() => decryptEdgeSigningSecret(modified, env))
      .toThrow(EdgeCryptoConfigurationError);
  });

  it('builds the documented canonical HMAC signature', () => {
    const result = buildEdgeSignature({
      secret: 'sync-secret',
      method: 'post',
      path: '/api/edge/v1/events/batch',
      timestamp: 1_700_000_000,
      nonce: '0123456789abcdef0123456789abcdef',
      body: Buffer.from('{"events":[]}'),
    });

    expect(result.bodyHash).toBe(
      '24de1c4a19c43ad41b013f13dcd858c17b0daa7f33a53f19913e5b11366d1c2e'
    );
    expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(safeHexEqual(result.signature, result.signature)).toBe(true);
    expect(safeHexEqual(result.signature, '0'.repeat(64))).toBe(false);
  });

  it('requires an exact 32-byte encryption key', () => {
    expect(() => encryptEdgeSigningSecret('a'.repeat(64), {
      EDGE_KEY_ENCRYPTION_KEY: 'too-short',
    })).toThrow(EdgeCryptoConfigurationError);
  });
});
