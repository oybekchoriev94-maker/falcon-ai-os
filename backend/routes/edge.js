import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';

import { createEdgeAuthMiddleware } from '../edge-auth.js';
import {
  encryptEdgeSigningSecret,
  generateEdgeSigningSecret,
} from '../services/edge-crypto.js';

const scopePattern = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const eventTypePattern = /^[a-z][a-z0-9_.-]{2,63}$/;
const hex64Pattern = /^[a-f0-9]{64}$/;

const cameraSchema = z.object({
  camera_id: z.string().regex(scopePattern),
  channel: z.number().int().min(1).max(256),
  zone_id: z.string().regex(scopePattern),
  display_name: z.string().min(1).max(120),
  enabled: z.boolean(),
  vendor: z.literal('hikvision'),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
}).strict();

const registrationSchema = z.object({
  tenant_id: z.string().regex(scopePattern),
  clinic_id: z.string().regex(scopePattern),
  node_id: z.string().regex(scopePattern),
  software_version: z.string().min(1).max(32),
  capabilities: z.array(z.string().min(1).max(64)).max(32),
  cameras: z.array(cameraSchema).max(256),
}).strict();

const eventSchema = z.object({
  id: z.uuid(),
  tenant_id: z.string().regex(scopePattern),
  clinic_id: z.string().regex(scopePattern),
  node_id: z.string().regex(scopePattern),
  camera_id: z.string().regex(scopePattern),
  zone_id: z.string().regex(scopePattern),
  event_type: z.string().regex(eventTypePattern),
  subject_ref: z.string().regex(/^[a-z0-9][a-z0-9_.:-]{2,95}$/).nullable().optional(),
  confidence: z.number().min(0).max(1),
  occurred_at: z.iso.datetime({ offset: true }),
  received_at: z.iso.datetime({ offset: true }),
  model_version: z.string().min(1).max(96),
  evidence_sha256: z.string().regex(hex64Pattern).nullable().optional(),
  dedup_key: z.string().min(8).max(190),
  metadata: z.record(z.string(), z.unknown()),
  previous_hash: z.string().regex(hex64Pattern),
  record_hash: z.string().regex(hex64Pattern),
}).strict().superRefine((event, context) => {
  if (Object.keys(event.metadata).length > 32) {
    context.addIssue({ code: 'custom', path: ['metadata'], message: 'metadata maydoni juda katta' });
  }
  if (Buffer.byteLength(JSON.stringify(event.metadata)) > 8192) {
    context.addIssue({ code: 'custom', path: ['metadata'], message: 'metadata 8192 byte dan oshdi' });
  }
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(500),
}).strict();

const provisionSchema = z.object({
  node_id: z.string().regex(scopePattern),
  clinic_id: z.string().regex(scopePattern),
  display_name: z.string().min(1).max(120),
}).strict();

function validationError(res, result) {
  return res.status(400).json({
    success: false,
    error: 'Edge payload validatsiyasi muvaffaqiyatsiz',
    details: result.error.flatten().fieldErrors,
  });
}

function scopeMatches(edgeNode, payload) {
  return payload.tenant_id === edgeNode.tenant_id
    && payload.clinic_id === edgeNode.clinic_id
    && payload.node_id === edgeNode.node_id;
}

function routeError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ success: false, error: error.message, code: error.code });
  }
  if (error?.code === '23505') {
    return res.status(409).json({ success: false, error: 'Edge node yoki kalit allaqachon mavjud' });
  }
  return res.status(500).json({ success: false, error: 'Edge operatsiyasi bajarilmadi' });
}

function edgeConflict(message, code) {
  return Object.assign(new Error(message), { status: 409, code });
}

function requireEdgeEnabled(_req, res, next) {
  if (process.env.EDGE_INGEST_ENABLED !== 'true') {
    return res.status(503).json({
      success: false,
      error: 'Edge integratsiyasi hozircha faollashtirilmagan',
      code: 'EDGE_DISABLED',
    });
  }
  return next();
}

export function createEdgeIngestRoutes(pool, platformPool) {
  const router = Router();
  router.use(requireEdgeEnabled);
  router.use(createEdgeAuthMiddleware(platformPool));

  router.post('/nodes/register', async (req, res) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    if (!scopeMatches(req.edgeNode, parsed.data)) {
      return res.status(403).json({ success: false, error: 'Edge scope mos emas' });
    }
    try {
      const result = await pool.query(
        `UPDATE edge_nodes
         SET status = 'active', software_version = $1, capabilities = $2,
             cameras = $3, last_seen_at = NOW(), last_registered_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $4 AND node_id = $5
         RETURNING id`,
        [
          parsed.data.software_version,
          JSON.stringify(parsed.data.capabilities),
          JSON.stringify(parsed.data.cameras),
          req.edgeNode.tenant_id,
          req.edgeNode.node_id,
        ]
      );
      if (result.rowCount !== 1) {
        return res.status(404).json({ success: false, error: 'Edge node topilmadi' });
      }
      req.auditSummary = {
        node_id: req.edgeNode.node_id,
        capabilities: parsed.data.capabilities,
        camera_count: parsed.data.cameras.length,
      };
      return res.json({ accepted: true });
    } catch (error) {
      req.log?.error({ err: error }, 'Edge registration failed');
      return routeError(res, error);
    }
  });

  router.post('/events/batch', async (req, res) => {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    if (parsed.data.events.some((event) => !scopeMatches(req.edgeNode, event))) {
      return res.status(403).json({ success: false, error: 'Event scope mos emas' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const nodeResult = await client.query(
        `SELECT last_event_hash FROM edge_nodes
         WHERE tenant_id = $1 AND node_id = $2
         FOR UPDATE`,
        [req.edgeNode.tenant_id, req.edgeNode.node_id]
      );
      if (nodeResult.rowCount !== 1) {
        throw Object.assign(new Error('Edge node topilmadi'), { status: 404 });
      }
      let currentHash = nodeResult.rows[0].last_event_hash;
      const acceptedIds = [];

      for (const event of parsed.data.events) {
        const existing = await client.query(
          `SELECT record_hash FROM vision_events
           WHERE tenant_id = $1 AND node_id = $2 AND id = $3`,
          [req.edgeNode.tenant_id, req.edgeNode.node_id, event.id]
        );
        if (existing.rowCount === 1) {
          if (existing.rows[0].record_hash !== event.record_hash) {
            throw edgeConflict('Event ID boshqa hash bilan qayta yuborildi', 'EDGE_EVENT_TAMPERED');
          }
          acceptedIds.push(event.id);
          continue;
        }
        if (event.previous_hash !== currentHash) {
          throw edgeConflict('Edge event hash zanjiri uzilgan', 'EDGE_CHAIN_MISMATCH');
        }

        const inserted = await client.query(
          `INSERT INTO vision_events (
             id, tenant_id, clinic_id, node_id, camera_id, zone_id, event_type,
             subject_ref, confidence, occurred_at, edge_received_at, model_version,
             evidence_sha256, dedup_key, metadata, previous_hash, record_hash
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
           ) ON CONFLICT DO NOTHING RETURNING id`,
          [
            event.id,
            event.tenant_id,
            event.clinic_id,
            event.node_id,
            event.camera_id,
            event.zone_id,
            event.event_type,
            event.subject_ref || null,
            event.confidence,
            event.occurred_at,
            event.received_at,
            event.model_version,
            event.evidence_sha256 || null,
            event.dedup_key,
            JSON.stringify(event.metadata),
            event.previous_hash,
            event.record_hash,
          ]
        );
        if (inserted.rowCount !== 1) {
          throw edgeConflict('Event dedup kaliti to\'qnashdi', 'EDGE_DEDUP_CONFLICT');
        }
        currentHash = event.record_hash;
        acceptedIds.push(event.id);
      }

      await client.query(
        `UPDATE edge_nodes
         SET last_event_hash = $1, last_seen_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $2 AND node_id = $3`,
        [currentHash, req.edgeNode.tenant_id, req.edgeNode.node_id]
      );
      await client.query('COMMIT');
      req.auditSummary = {
        node_id: req.edgeNode.node_id,
        event_count: acceptedIds.length,
        event_ids: acceptedIds,
      };
      return res.json({ accepted_ids: acceptedIds });
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        req.log?.error({ err: rollbackError }, 'Edge batch rollback failed');
      }
      req.log?.warn({ err: error, nodeId: req.edgeNode.node_id }, 'Edge event batch rejected');
      return routeError(res, error);
    } finally {
      client.release();
    }
  });

  return router;
}

export function createEdgeAdminRoutes(pool) {
  const router = Router();
  router.use(requireEdgeEnabled);

  router.post('/nodes', async (req, res) => {
    const parsed = provisionSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    try {
      const signingKey = generateEdgeSigningSecret();
      const keyId = `edge-${randomUUID()}`;
      const ciphertext = encryptEdgeSigningSecret(signingKey);
      const result = await pool.query(
        `INSERT INTO edge_nodes (
           id, tenant_id, clinic_id, node_id, display_name, key_id, signing_secret_ciphertext
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, tenant_id, clinic_id, node_id, display_name, key_id, status, created_at`,
        [
          randomUUID(),
          req.user.tenant_id,
          parsed.data.clinic_id,
          parsed.data.node_id,
          parsed.data.display_name,
          keyId,
          ciphertext,
        ]
      );
      req.auditSummary = { node_id: parsed.data.node_id, action: 'edge.provision' };
      return res.status(201).json({
        success: true,
        node: result.rows[0],
        signing_key: signingKey,
        warning: 'Signing key faqat bir marta ko\'rsatiladi. Uni Edge secret store ga saqlang.',
      });
    } catch (error) {
      req.log?.error({ err: error }, 'Edge provisioning failed');
      return routeError(res, error);
    }
  });

  router.post('/nodes/:nodeId/rotate-key', async (req, res) => {
    if (!scopePattern.test(req.params.nodeId)) {
      return res.status(400).json({ success: false, error: 'node_id yaroqsiz' });
    }
    try {
      const signingKey = generateEdgeSigningSecret();
      const keyId = `edge-${randomUUID()}`;
      const ciphertext = encryptEdgeSigningSecret(signingKey);
      const result = await pool.query(
        `UPDATE edge_nodes
         SET key_id = $1, signing_secret_ciphertext = $2, status = 'provisioned',
             updated_at = NOW()
         WHERE tenant_id = $3 AND node_id = $4
         RETURNING id, tenant_id, clinic_id, node_id, display_name, key_id, status, updated_at`,
        [keyId, ciphertext, req.user.tenant_id, req.params.nodeId]
      );
      if (result.rowCount !== 1) {
        return res.status(404).json({ success: false, error: 'Edge node topilmadi' });
      }
      req.auditSummary = { node_id: req.params.nodeId, action: 'edge.rotate-key' };
      return res.json({
        success: true,
        node: result.rows[0],
        signing_key: signingKey,
        warning: 'Eski kalit darhol bekor qilindi. Yangi kalitni Edge qurilmaga o\'rnating.',
      });
    } catch (error) {
      req.log?.error({ err: error }, 'Edge key rotation failed');
      return routeError(res, error);
    }
  });

  router.get('/nodes', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, tenant_id, clinic_id, node_id, display_name, key_id, status,
                software_version, capabilities, cameras, last_event_hash, last_seen_at,
                last_registered_at, created_at, updated_at
         FROM edge_nodes WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [req.user.tenant_id]
      );
      return res.json({ success: true, nodes: result.rows, count: result.rowCount });
    } catch (error) {
      return routeError(res, error);
    }
  });

  router.get('/events', async (req, res) => {
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
      camera_id: z.string().regex(scopePattern).optional(),
      event_type: z.string().regex(eventTypePattern).optional(),
      before: z.iso.datetime({ offset: true }).optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return validationError(res, parsed);

    try {
      const conditions = ['tenant_id = $1'];
      const values = [req.user.tenant_id];
      if (parsed.data.camera_id) {
        values.push(parsed.data.camera_id);
        conditions.push(`camera_id = $${values.length}`);
      }
      if (parsed.data.event_type) {
        values.push(parsed.data.event_type);
        conditions.push(`event_type = $${values.length}`);
      }
      if (parsed.data.before) {
        values.push(parsed.data.before);
        conditions.push(`occurred_at < $${values.length}`);
      }
      values.push(parsed.data.limit);
      const result = await pool.query(
        `SELECT id, clinic_id, node_id, camera_id, zone_id, event_type, subject_ref,
                confidence, occurred_at, edge_received_at, model_version,
                evidence_sha256, metadata, previous_hash, record_hash, ingested_at
         FROM vision_events
         WHERE ${conditions.join(' AND ')}
         ORDER BY occurred_at DESC, id DESC LIMIT $${values.length}`,
        values
      );
      return res.json({ success: true, events: result.rows, count: result.rowCount });
    } catch (error) {
      return routeError(res, error);
    }
  });

  return router;
}
