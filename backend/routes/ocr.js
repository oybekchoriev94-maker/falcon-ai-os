// ============================================================
// Falcon AI OS — Hujjat elektronlashtirish API (PR #8)
//
// Qog'oz tibbiy kartalar va xizmat hujjatlarini elektronlash:
//   upload — rasm → OCR → matn
//   stt    — ovozli diktant → STT → matn
//   text   — qo'lda kiritilgan matn
// Matn → LLM tuzilgan maydonlarga ajratadi (best-effort).
//
// DOKTRINA: AI natijasi kartaga avtomatik tushmaydi — shifokor
// tekshirib tasdiqlaydi (review). Xom matn esa HECH QACHON yo'qolmaydi.
// ============================================================
import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { q, qGet, getPool } from '../db.js';
import { authMiddleware, validate } from '../shared.js';
import { requirePermission } from '../rbac.js';
import { llm, isLLMReady } from '../../ai/engines/llm.js';
import { transcribe, isSTTReady } from '../../ai/engines/stt.js';
import { recognizeImage, isOCRReady } from '../../ai/engines/ocr.js';
import { saveRecording } from '../services/voice-store.js';
import {
  DOC_TYPES, DOC_TYPE_LABEL, buildExtractionPrompt,
  sanitizeRawText, parseStructured, decideStatus,
} from '../services/ocr-pipeline.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hujjat fayllari public/ ostida EMAS — bemor ma'lumoti ochilmaydi
const OCR_DIR = process.env.OCR_DIR || path.join(process.cwd(), 'ocr-documents');
// LLM 7B modelga juda uzun matn bermaymiz — boshi yetarli
const LLM_INPUT_LIMIT = 12_000;

const IMAGE_MIMES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/bmp': 'bmp' };

const createSchema = z.object({
  doc_type: z.enum(DOC_TYPES).default('tibbiy_karta'),
  patient_id: z.string().uuid().optional(),
  language: z.enum(['uz', 'ru']).default('uz'),
});

const textSchema = createSchema.extend({
  raw_text: z.string().trim().min(3).max(100_000),
});

const patchSchema = z.object({
  patient_id: z.string().uuid().nullable().optional(),
  doc_type: z.enum(DOC_TYPES).optional(),
  raw_text: z.string().trim().min(3).max(100_000).optional(),
  ai_summary: z.string().trim().max(2000).nullable().optional(),
  structured: z.record(z.any()).nullable().optional(),
  review_note: z.string().trim().max(2000).nullable().optional(),
});

async function validatePatient(tenantId, patientId) {
  if (!patientId) return null;
  const p = await qGet('SELECT id FROM patients WHERE id = $1 AND tenant_id = $2', [patientId, tenantId]);
  return p ? patientId : undefined; // undefined = berilgan, lekin topilmadi
}

export default function ocrRoutes(upload) {
  const router = Router();

  // ── Pipeline: matn → AI ajratma → status ───────────────────────
  async function runPipeline(doc) {
    let rawText = doc.raw_text || '';
    let hardError = null;

    // 1. Rasm bo'lsa va matn hali yo'q bo'lsa — OCR
    if (!rawText.trim() && doc.source === 'upload') {
      if (!doc.file_path) {
        hardError = "Rasm fayli saqlanmagan — qayta yuklab ko'ring";
      } else {
        try {
          const buf = await fs.readFile(path.join(OCR_DIR, doc.file_path));
          const ocrRes = await recognizeImage(buf, doc.original_filename || 'image.jpg');
          if (ocrRes.error) hardError = ocrRes.error;
          else rawText = ocrRes.text;
        } catch (e) {
          hardError = `Rasm faylini o'qib bo'lmadi: ${e.message}`;
        }
      }
    }

    // 2. AI ajratma — best-effort: LLM ishlamasa ham matn saqlanadi
    const clean = sanitizeRawText(rawText);
    let structured = null;
    let aiSummary = null;
    if (clean && !hardError && isLLMReady()) {
      const { system } = buildExtractionPrompt(doc.doc_type);
      const out = await llm(system, clean.slice(0, LLM_INPUT_LIMIT), { maxTokens: 1200 });
      structured = parseStructured(out);
      aiSummary = structured?.summary || null;
    }

    const { status, error } = decideStatus({ rawText: clean, structured, hardError });
    const updated = await qGet(
      `UPDATE ocr_documents
          SET raw_text = $2, ai_summary = $3, structured = $4, status = $5,
              error = $6, updated_at = now()
        WHERE id = $1 AND tenant_id = $7 RETURNING *`,
      [doc.id, clean || null, aiSummary, structured ? JSON.stringify(structured) : null,
       status, error, doc.tenant_id]
    );
    return updated;
  }

  // ── GET /api/ocr/status — dvigatellar holati ───────────────────
  router.get('/status', authMiddleware, requirePermission('documents.read'), async (_req, res) => {
    res.json({ success: true, engines: { ocr: isOCRReady(), stt: isSTTReady(), llm: isLLMReady() } });
  });

  // ── GET /api/ocr/documents — ro'yxat ───────────────────────────
  router.get('/documents', authMiddleware, requirePermission('documents.read'), async (req, res) => {
    try {
      let sql = `SELECT d.id, d.doc_type, d.source, d.status, d.original_filename,
                        d.patient_id, d.ai_summary, d.error, d.created_at, d.reviewed_at,
                        TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS patient_name
                   FROM ocr_documents d
                   LEFT JOIN patients p ON p.id = d.patient_id
                  WHERE d.tenant_id = $1`;
      const params = [req.user.tenant_id];
      if (req.query.patient_id && UUID_RE.test(String(req.query.patient_id))) {
        params.push(req.query.patient_id); sql += ` AND d.patient_id = $${params.length}`;
      }
      if (req.query.doc_type && DOC_TYPES.includes(req.query.doc_type)) {
        params.push(req.query.doc_type); sql += ` AND d.doc_type = $${params.length}`;
      }
      if (req.query.status && ['pending', 'processing', 'done', 'failed'].includes(req.query.status)) {
        params.push(req.query.status); sql += ` AND d.status = $${params.length}`;
      }
      sql += ' ORDER BY d.created_at DESC LIMIT 200';
      const rows = await q(sql, params);
      res.json({ success: true, total: rows.length, documents: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: "Hujjatlar ro'yxatini olib bo'lmadi", details: e.message });
    }
  });

  // ── GET /api/ocr/documents/:id — batafsil ──────────────────────
  router.get('/documents/:id', authMiddleware, requirePermission('documents.read'), async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: "Noto'g'ri id" });
      const doc = await qGet(
        `SELECT d.*, TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS patient_name
           FROM ocr_documents d LEFT JOIN patients p ON p.id = d.patient_id
          WHERE d.id = $1 AND d.tenant_id = $2`,
        [req.params.id, req.user.tenant_id]
      );
      if (!doc) return res.status(404).json({ success: false, error: 'Hujjat topilmadi' });
      res.json({ success: true, document: doc, doc_type_label: DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type });
    } catch (e) {
      res.status(500).json({ success: false, error: "Hujjatni o'qib bo'lmadi", details: e.message });
    }
  });

  // ── POST /api/ocr/documents — rasm yuklash (OCR keyin process) ─
  router.post('/documents', authMiddleware, requirePermission('documents.write'),
    upload.single('file'), validate(createSchema), async (req, res) => {
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ success: false, error: "Rasm fayli kerak (maydon: 'file')" });
        const ext = IMAGE_MIMES[file.mimetype];
        if (!ext) return res.status(400).json({ success: false, error: 'Faqat JPG/PNG/WEBP/BMP rasmlar qabul qilinadi' });

        const patientId = await validatePatient(req.user.tenant_id, req.body.patient_id);
        if (patientId === undefined) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });

        // Diskka yozish — matn olinmasa ham asl nusxa yo'qolmasin
        const day = new Date().toISOString().slice(0, 10);
        const dir = path.join(OCR_DIR, req.user.tenant_id, day);
        await fs.mkdir(dir, { recursive: true });
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const rel = path.join(req.user.tenant_id, day, `${id}.${ext}`);
        await fs.writeFile(path.join(OCR_DIR, rel), file.buffer);

        const doc = await qGet(
          `INSERT INTO ocr_documents (tenant_id, patient_id, doc_type, source, original_filename,
                                      mime, size_bytes, file_path, language, created_by)
           VALUES ($1, $2, $3, 'upload', $4, $5, $6, $7, $8, $9) RETURNING *`,
          [req.user.tenant_id, patientId || null, req.body.doc_type,
           file.originalname || `rasm.${ext}`, file.mimetype, file.size, rel,
           req.body.language, req.user.id]
        );
        res.status(201).json({ success: true, document: doc });
      } catch (e) {
        res.status(500).json({ success: false, error: "Hujjatni saqlab bo'lmadi", details: e.message });
      }
    });

  // ── POST /api/ocr/voice — ovozli diktant (STT) ─────────────────
  router.post('/voice', authMiddleware, requirePermission('documents.write'),
    upload.single('audio'), validate(createSchema), async (req, res) => {
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ success: false, error: "Audio fayli kerak (maydon: 'audio')" });

        const patientId = await validatePatient(req.user.tenant_id, req.body.patient_id);
        if (patientId === undefined) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });

        // "Hech bir diktant yo'qolmasin": avval diskka + bazaga, keyin STT
        await saveRecording(getPool(), {
          tenantId: req.user.tenant_id, userId: req.user.id, source: 'ocr-dictation',
          patientId: patientId || null, buffer: file.buffer, mime: file.mimetype,
          originalName: file.originalname, language: req.body.language,
        });

        const stt = await transcribe(file.buffer, file.originalname || 'dictation.webm', { language: req.body.language });
        if (stt.error) {
          return res.status(503).json({ success: false, error: stt.error, code: 'STT_FAILED' });
        }

        const doc = await qGet(
          `INSERT INTO ocr_documents (tenant_id, patient_id, doc_type, source, original_filename,
                                      mime, size_bytes, language, raw_text, created_by)
           VALUES ($1, $2, $3, 'stt', $4, $5, $6, $7, $8, $9) RETURNING *`,
          [req.user.tenant_id, patientId || null, req.body.doc_type,
           file.originalname || 'diktant', file.mimetype, file.size,
           req.body.language, sanitizeRawText(stt.text) || null, req.user.id]
        );
        res.status(201).json({ success: true, document: doc });
      } catch (e) {
        res.status(500).json({ success: false, error: "Diktantni saqlab bo'lmadi", details: e.message });
      }
    });

  // ── POST /api/ocr/text — qo'lda kiritilgan matn ────────────────
  router.post('/text', authMiddleware, requirePermission('documents.write'),
    validate(textSchema), async (req, res) => {
      try {
        const patientId = await validatePatient(req.user.tenant_id, req.body.patient_id);
        if (patientId === undefined) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
        const doc = await qGet(
          `INSERT INTO ocr_documents (tenant_id, patient_id, doc_type, source, language, raw_text, created_by)
           VALUES ($1, $2, $3, 'text', $4, $5, $6) RETURNING *`,
          [req.user.tenant_id, patientId || null, req.body.doc_type,
           req.body.language, sanitizeRawText(req.body.raw_text), req.user.id]
        );
        res.status(201).json({ success: true, document: doc });
      } catch (e) {
        res.status(500).json({ success: false, error: "Hujjatni saqlab bo'lmadi", details: e.message });
      }
    });

  // ── POST /api/ocr/documents/:id/process — OCR + AI yurish ──────
  router.post('/documents/:id/process', authMiddleware, requirePermission('documents.write'), async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: "Noto'g'ri id" });
      const doc = await qGet(
        'SELECT * FROM ocr_documents WHERE id = $1 AND tenant_id = $2',
        [req.params.id, req.user.tenant_id]
      );
      if (!doc) return res.status(404).json({ success: false, error: 'Hujjat topilmadi' });
      await q('UPDATE ocr_documents SET status = $2, error = NULL, updated_at = now() WHERE id = $1', [doc.id, 'processing']);
      const updated = await runPipeline(doc);
      res.json({ success: true, document: updated });
    } catch (e) {
      res.status(500).json({ success: false, error: "Hujjatni qayta ishlab bo'lmadi", details: e.message });
    }
  });

  // ── PATCH /api/ocr/documents/:id — tuzatish va tasdiq ──────────
  router.patch('/documents/:id', authMiddleware, requirePermission('documents.write'),
    validate(patchSchema), async (req, res) => {
      try {
        if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: "Noto'g'ri id" });
        const doc = await qGet(
          'SELECT * FROM ocr_documents WHERE id = $1 AND tenant_id = $2',
          [req.params.id, req.user.tenant_id]
        );
        if (!doc) return res.status(404).json({ success: false, error: 'Hujjat topilmadi' });

        const b = req.body;
        if (b.patient_id) {
          const ok = await validatePatient(req.user.tenant_id, b.patient_id);
          if (ok === undefined) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
        }
        const updated = await qGet(
          `UPDATE ocr_documents SET
             patient_id = COALESCE($2, patient_id),
             doc_type = COALESCE($3, doc_type),
             raw_text = COALESCE($4, raw_text),
             ai_summary = COALESCE($5, ai_summary),
             structured = COALESCE($6, structured),
             review_note = COALESCE($7, review_note),
             reviewed_by = $8, reviewed_at = now(),
             updated_at = now()
           WHERE id = $1 AND tenant_id = $9 RETURNING *`,
          [doc.id,
           b.patient_id === undefined ? null : b.patient_id,
           b.doc_type || null,
           b.raw_text ? sanitizeRawText(b.raw_text) : null,
           b.ai_summary === undefined ? null : b.ai_summary,
           b.structured === undefined ? null : JSON.stringify(b.structured),
           b.review_note === undefined ? null : b.review_note,
           req.user.id, req.user.tenant_id]
        );
        res.json({ success: true, document: updated });
      } catch (e) {
        res.status(500).json({ success: false, error: "Hujjatni yangilab bo'lmadi", details: e.message });
      }
    });

  // ── DELETE /api/ocr/documents/:id — faqat rahbar ───────────────
  router.delete('/documents/:id', authMiddleware, requirePermission('documents.write'), async (req, res) => {
    try {
      if (!['ceo', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: "Hujjatni o'chirish faqat rahbarda" });
      }
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: "Noto'g'ri id" });
      const doc = await qGet(
        'DELETE FROM ocr_documents WHERE id = $1 AND tenant_id = $2 RETURNING file_path',
        [req.params.id, req.user.tenant_id]
      );
      if (!doc) return res.status(404).json({ success: false, error: 'Hujjat topilmadi' });
      if (doc.file_path) {
        try { await fs.unlink(path.join(OCR_DIR, doc.file_path)); } catch { /* fayl allaqachon yo'q */ }
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: "Hujjatni o'chirib bo'lmadi", details: e.message });
    }
  });

  return router;
}
