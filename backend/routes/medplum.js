// ============================================================
// Falcon AI OS — Medplum (FHIR) sinhronizatsiya API (roadmap PR #5)
//
// Klinik ma'lumotning asosiy manbasi Medplum bo'ladi: Falcon
// bemor kartalari va qabullarni FHIR resurslari sifatida push
// qiladi. ID ko'prigi external_ids jadvalida saqlanadi —
// sinhronizatsiya takrorlanganda UPDATE qilinadi (idempotent).
//
// Gate: MEDPLUM_BASE_URL bo'sh bo'lsa hamma endpoint 503 +
// MEDPLUM_DISABLED qaytaradi — qolgan tizim buzilmaydi.
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { q, qGet } from '../db.js';
import { authMiddleware } from '../shared.js';
import { requirePermission } from '../rbac.js';
import {
  isMedplumEnabled,
  toFhirPatient,
  toFhirEncounter,
  createFhirResource,
  updateFhirResource,
} from '../services/medplum-client.js';
import { serverFail } from '../services/safe-error.js';

const SYSTEM = 'medplum';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function medplumRoutes() {
  const router = Router();

  // ─── external_ids helper'lari ──────────────────────────────────────
  async function getMapping(tenantId, entity, localId) {
    return qGet(
      `SELECT external_id, external_version, synced_at
         FROM external_ids
        WHERE tenant_id = $1 AND system = $2 AND entity = $3 AND local_id = $4`,
      [tenantId, SYSTEM, entity, localId]
    );
  }

  async function saveMapping(tenantId, entity, localId, externalId, versionId) {
    await q(
      `INSERT INTO external_ids (tenant_id, system, entity, local_id, external_id, external_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, system, entity, local_id)
       DO UPDATE SET external_id = EXCLUDED.external_id,
                     external_version = EXCLUDED.external_version,
                     synced_at = now()`,
      [tenantId, SYSTEM, entity, localId, externalId, versionId || null]
    );
  }

  function guardDisabled(res) {
    if (isMedplumEnabled()) return false;
    res.status(503).json({
      success: false,
      code: 'MEDPLUM_DISABLED',
      error: "MEDPLUM_BASE_URL sozlanmagan — integratsiya o'chirilgan",
    });
    return true;
  }

  function guardUuid(req, res) {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) {
      res.status(400).json({ success: false, error: "id UUID formatda bo'lishi shart" });
      return null;
    }
    return id;
  }

  // Bemorni Medplumga yuboradi; mappingni saqlab, tashqi IDni qaytaradi.
  // Encounter sinhronizatsiyasi ham shu funksiyani chaqiradi.
  async function syncPatient(tenantId, patientId) {
    const patient = await qGet(
      'SELECT * FROM patients WHERE tenant_id = $1 AND id = $2',
      [tenantId, patientId]
    );
    if (!patient) return { error: 'Bemor topilmadi', status: 404 };

    const resource = toFhirPatient(patient);
    const existing = await getMapping(tenantId, 'patient', patientId);
    const result = existing
      ? await updateFhirResource('Patient', existing.external_id, resource)
      : await createFhirResource('Patient', resource);
    if (!result) {
      return { error: "Medplumga ulanib bo'lmadi yoki javob xato", status: 502, code: 'MEDPLUM_ERROR' };
    }
    await saveMapping(tenantId, 'patient', patientId, result.id, result.versionId);
    return { external_id: result.id, version: result.versionId };
  }

  // ─── Endpoint'lar ─────────────────────────────────────────────────
  // GET /api/medplum/status — integratsiya holati (UI badge uchun)
  router.get('/status', authMiddleware, requirePermission('patients.read'), async (req, res) => {
    try {
      const count = await qGet(
        `SELECT COUNT(*)::int AS total FROM external_ids
          WHERE tenant_id = $1 AND system = $2`,
        [req.user.tenant_id, SYSTEM]
      );
      res.json({ success: true, enabled: isMedplumEnabled(), mapped: count?.total || 0 });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Holatni olib bo\'lmadi', details: e.message });
    }
  });

  // POST /api/medplum/sync/patient/:id — bemor kartasini push qilish
  router.post('/sync/patient/:id', authMiddleware, requirePermission('patients.write'), async (req, res) => {
    if (guardDisabled(res)) return;
    const id = guardUuid(req, res);
    if (!id) return;
    try {
      const r = await syncPatient(req.user.tenant_id, id);
      if (r.error) {
        res.status(r.status).json({ success: false, code: r.code || 'NOT_FOUND', error: r.error });
        return;
      }
      res.json({ success: true, synced: true, entity: 'Patient', external_id: r.external_id });
    } catch (e) {
      serverFail(res, e, 'Sinhronizatsiya xatosi', 500);
    }
  });

  // POST /api/medplum/sync/encounter/:id — qabulni push qilish.
  // Bemor hali sinhronlanmagan bo'lsa, AVVAL bemor yuboriladi —
  // Encounter'ga subject kerak.
  router.post('/sync/encounter/:id', authMiddleware, requirePermission('appointments.write'), async (req, res) => {
    if (guardDisabled(res)) return;
    const id = guardUuid(req, res);
    if (!id) return;
    try {
      const appointment = await qGet(
        `SELECT a.id, a.patient_id, a.patient_name, a.status, a.scheduled_at,
                a.doctor_name, s.name AS service_name
           FROM appointments a
           LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1 AND a.id = $2`,
        [req.user.tenant_id, id]
      );
      if (!appointment) {
        res.status(404).json({ success: false, error: 'Qabul topilmadi' });
        return;
      }
      if (!appointment.patient_id) {
        res.status(400).json({
          success: false,
          error: "Qabulga bemor kartasi bog'lanmagan — avval bemorni biriktiring",
        });
        return;
      }

      const patientSync = await syncPatient(req.user.tenant_id, appointment.patient_id);
      if (patientSync.error) {
        res.status(patientSync.status).json({
          success: false,
          code: patientSync.code || 'NOT_FOUND',
          error: `Bemor sinhronlanmadi: ${patientSync.error}`,
        });
        return;
      }

      const resource = toFhirEncounter({
        appointment,
        patientExternalId: patientSync.external_id,
      });
      const existing = await getMapping(req.user.tenant_id, 'appointment', id);
      const result = existing
        ? await updateFhirResource('Encounter', existing.external_id, resource)
        : await createFhirResource('Encounter', resource);
      if (!result) {
        res.status(502).json({ success: false, code: 'MEDPLUM_ERROR', error: "Medplumga ulanib bo'lmadi" });
        return;
      }
      await saveMapping(req.user.tenant_id, 'appointment', id, result.id, result.versionId);
      res.json({
        success: true,
        synced: true,
        entity: 'Encounter',
        external_id: result.id,
        patient_external_id: patientSync.external_id,
      });
    } catch (e) {
      serverFail(res, e, 'Sinhronizatsiya xatosi', 500);
    }
  });

  // GET /api/medplum/mappings — sinhronlangan yozuvlar ro'yxati
  router.get('/mappings', authMiddleware, requirePermission('patients.read'), async (req, res) => {
    try {
      const rows = await q(
        `SELECT entity, local_id, external_id, external_version, synced_at
           FROM external_ids
          WHERE tenant_id = $1 AND system = $2
          ORDER BY synced_at DESC LIMIT 100`,
        [req.user.tenant_id, SYSTEM]
      );
      res.json({ success: true, total: rows.length, mappings: rows });
    } catch (e) {
      serverFail(res, e, "Ro'yxatni olib bo'lmadi", 500);
    }
  });

  return router;
}
