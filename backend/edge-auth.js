import { bindTenantDbContext } from './request-tenant-context.js';
import {
  buildEdgeSignature,
  decryptEdgeSigningSecret,
  safeHexEqual,
} from './services/edge-crypto.js';

const SCOPE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const NODE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,63}$/;
const NONCE_PATTERN = /^[a-f0-9]{32,64}$/i;
const SIGNATURE_PATTERN = /^v1=([a-f0-9]{64})$/i;
const TIMESTAMP_PATTERN = /^[0-9]{10}$/;
const MAX_CLOCK_SKEW_SECONDS = 300;
const NONCE_TTL_SECONDS = 600;
const MAX_EDGE_BODY_BYTES = 1_048_576;

function header(req, name) {
  const value = req.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function unauthorized(res) {
  return res.status(401).json({ success: false, error: 'Edge autentifikatsiyasi muvaffaqiyatsiz' });
}

export function createEdgeAuthMiddleware(platformPool, { now = () => Date.now() } = {}) {
  if (!platformPool?.query) throw new TypeError('Edge auth uchun platform DB pool talab qilinadi');

  return async function edgeAuth(req, res, next) {
    try {
      const tenantId = header(req, 'X-Falcon-Tenant');
      const clinicId = header(req, 'X-Falcon-Clinic');
      const nodeId = header(req, 'X-Falcon-Node');
      const keyId = header(req, 'X-Falcon-Key-ID');
      const nonce = header(req, 'X-Falcon-Nonce');
      const timestampRaw = header(req, 'X-Falcon-Timestamp');
      const bodyHash = header(req, 'X-Content-SHA256').toLowerCase();
      const signatureMatch = header(req, 'X-Falcon-Signature').match(SIGNATURE_PATTERN);
      const timestamp = Number(timestampRaw);
      const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.alloc(0);

      if (
        !SCOPE_PATTERN.test(tenantId)
        || !SCOPE_PATTERN.test(clinicId)
        || !NODE_PATTERN.test(nodeId)
        || !KEY_ID_PATTERN.test(keyId)
        || !NONCE_PATTERN.test(nonce)
        || !TIMESTAMP_PATTERN.test(timestampRaw)
        || !Number.isSafeInteger(timestamp)
        || !signatureMatch
        || rawBody.length === 0
        || rawBody.length > MAX_EDGE_BODY_BYTES
      ) {
        return unauthorized(res);
      }
      const currentSeconds = Math.floor(now() / 1000);
      if (Math.abs(currentSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
        return unauthorized(res);
      }

      const nodeResult = await platformPool.query(
        `SELECT id, tenant_id, clinic_id, node_id, key_id, signing_secret_ciphertext, status
         FROM edge_nodes
         WHERE tenant_id = $1 AND clinic_id = $2 AND node_id = $3 AND key_id = $4`,
        [tenantId, clinicId, nodeId, keyId]
      );
      const node = nodeResult.rows[0];
      if (!node || !['provisioned', 'active'].includes(node.status)) return unauthorized(res);

      const secret = decryptEdgeSigningSecret(node.signing_secret_ciphertext);
      const path = `${req.baseUrl}${req.path}`;
      const expected = buildEdgeSignature({
        secret,
        method: req.method,
        path,
        timestamp,
        nonce,
        body: rawBody,
      });
      if (!safeHexEqual(bodyHash, expected.bodyHash)) return unauthorized(res);
      if (!safeHexEqual(signatureMatch[1], expected.signature)) return unauthorized(res);

      const nonceResult = await platformPool.query(
        `INSERT INTO edge_nonces (tenant_id, node_id, nonce, expires_at)
         VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'))
         ON CONFLICT (tenant_id, node_id, nonce) DO NOTHING
         RETURNING nonce`,
        [tenantId, nodeId, nonce.toLowerCase(), NONCE_TTL_SECONDS]
      );
      if (nonceResult.rowCount !== 1) {
        return res.status(409).json({ success: false, error: 'Edge so\'rovi takrorlangan' });
      }
      void platformPool.query('DELETE FROM edge_nonces WHERE expires_at < NOW()').catch(() => {});

      req.edgeNode = node;
      req.tenant_id = tenantId;
      req.user = {
        id: node.id,
        role: 'edge-node',
        name: nodeId,
        tenant_id: tenantId,
      };
      res.setHeader('x-tenant-id', tenantId);
      return bindTenantDbContext(tenantId, res, next);
    } catch (error) {
      req.log?.error({ err: error }, 'Edge authentication failed');
      return res.status(503).json({ success: false, error: 'Edge autentifikatsiyasi mavjud emas' });
    }
  };
}

export const edgeAuthLimits = Object.freeze({
  maxBodyBytes: MAX_EDGE_BODY_BYTES,
  maxClockSkewSeconds: MAX_CLOCK_SKEW_SECONDS,
  nonceTtlSeconds: NONCE_TTL_SECONDS,
});
