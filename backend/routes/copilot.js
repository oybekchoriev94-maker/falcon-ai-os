// ============================================================
// FALCON AI OS — Shifokor Copilot routes (Bosqich Q)
//
// XAVFSIZLIK QATLAMLARI:
//  1) ROL: faqat 'doctor'|'admin'|'ceo' — checkRole enforce
//  2) TENANT IZOLATSIYA: barcha ma'lumot req.user.tenant_id bilan
//  3) RATE LIMIT: har foydalanuvchi soatiga 60 chaqiruv
//  4) PROPOSE-ONLY: AI harakat qilmaydi — faqat ai_action_proposals ga yozadi
//  5) CONFIRM GUARD: faqat egasi (proposed_by_user) yoki admin tasdiqlaydi
//  6) EXPIRY: 2 soatdan keyin taklif avto expired bo'ladi
//  7) AUDIT: har tasdiq/rad audit tarixida qoladi
//  8) INPUT VALIDATION: max text length, JSON schema
// ============================================================
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { voiceCommand, doctorCopilot, smartAutofill } from '../../ai/agents/doctor-copilot.js';

// In-memory rate limiter (per user, per hour)
const rateBuckets = new Map();
function checkRate(userId, limitPerHour = 60) {
  const now = Date.now();
  const b = rateBuckets.get(userId) || { count: 0, resetAt: now + 3600_000 };
  if (now > b.resetAt) { b.count = 0; b.resetAt = now + 3600_000; }
  b.count += 1;
  rateBuckets.set(userId, b);
  return b.count <= limitPerHour;
}

export default function copilotRoutes(pool, authMiddleware, checkRole, upload) {
  const router = Router();
  const tenantOf = (req) => req.user?.tenant_id || req.tenant_id || 'default';

  // Barcha endpointlar: doctor+admin+ceo
  router.use(authMiddleware, checkRole('doctor', 'admin', 'ceo'));

  // Rate limit
  router.use((req, res, next) => {
    const uid = req.user?.id || 'anon';
    if (!checkRate(uid, 60)) {
      return res.status(429).json({ success: false, error: 'Soatiga 60 chaqiruv — biroz kuting' });
    }
    next();
  });

  // ── VOICE COMMAND → propose action ──
  // Audio yoki matn — natija: ai_action_proposals (pending)
  router.post('/voice-command',
    upload ? upload.single('audio') : (req, _res, next) => next(),
    async (req, res) => {
      try {
        const tenantId = tenantOf(req);
        const input = {
          text: req.body?.text || undefined,
          language: req.body?.language || 'uz',
          patient_context: req.body?.patient_id ? { patient_id: req.body.patient_id } : undefined,
        };
        if (req.file) input.audio = req.file.buffer;

        const result = await voiceCommand.handler(input);
        if (result.error) return res.status(400).json({ success: false, error: result.error, transcript: result.transcript });

        // Har taklifni bazaga yozamiz (pending, 2h expiry)
        const patientId = req.body?.patient_id || null;
        const admissionId = req.body?.admission_id || null;
        const savedIds = [];
        for (const p of result.proposals) {
          const id = uuidv4();
          try {
            await pool.query(
              `INSERT INTO ai_action_proposals
                 (id, tenant_id, proposed_by_user, proposed_by_agent, patient_id, admission_id,
                  action_kind, action_payload, raw_input, confidence)
               VALUES ($1,$2,$3,'voice-command',$4,$5,$6,$7::jsonb,$8,$9)`,
              [id, tenantId, req.user?.id || null, patientId, admissionId,
               p.kind, JSON.stringify(p.payload), result.transcript || null, p.confidence]
            );
            savedIds.push(id);
          } catch (e) {
            console.warn('[COPILOT save proposal]', e.message);
          }
        }

        res.json({
          success: true,
          transcript: result.transcript,
          proposals: result.proposals.map((p, i) => ({ ...p, id: savedIds[i] })),
          disclaimer: 'AI takliflar — har biri shifokor tasdig\'iga muhtoj',
        });
      } catch (e) {
        console.error('[COPILOT voice-command]', e);
        res.status(500).json({ success: false, error: e.message });
      }
    }
  );

  // ── COPILOT CHAT ──
  const chatSchema = z.object({
    session_id: z.string().uuid().optional(),
    question: z.string().min(3).max(2000),
    patient_id: z.string().uuid().optional(),
  });

  router.post('/chat', async (req, res) => {
    try {
      const parsed = chatSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: parsed.error.flatten().fieldErrors });
      }
      const tenantId = tenantOf(req);
      const sessionId = parsed.data.session_id || uuidv4();

      // Sessiya tarixi (oxirgi 10 xabar)
      const { rows: history } = await pool.query(
        `SELECT role, content FROM copilot_chat_messages
         WHERE tenant_id = $1 AND session_id = $2
         ORDER BY created_at DESC LIMIT 10`,
        [tenantId, sessionId]
      );
      const historyArr = history.reverse().map((r) => ({ role: r.role, content: r.content }));

      // Bemor konteksti (agar patient_id berilgan bo'lsa)
      let patientContext;
      if (parsed.data.patient_id) {
        const { rows } = await pool.query(
          `SELECT birth_date, gender, allergies FROM patients
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, parsed.data.patient_id]
        );
        if (rows[0]) {
          const age = rows[0].birth_date
            ? Math.floor((Date.now() - new Date(rows[0].birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
            : null;
          patientContext = { age, gender: rows[0].gender, allergies: rows[0].allergies };
        }
      }

      // User xabarni yozib qo'yamiz
      await pool.query(
        `INSERT INTO copilot_chat_messages (tenant_id, session_id, user_id, role, content, patient_id)
         VALUES ($1, $2, $3, 'user', $4, $5)`,
        [tenantId, sessionId, req.user?.id || null, parsed.data.question, parsed.data.patient_id || null]
      );

      const result = await doctorCopilot.handler({
        question: parsed.data.question,
        history: historyArr,
        patient_context: patientContext,
      });

      if (result.error) return res.status(500).json({ success: false, error: result.error });

      // Assistant javobini yozib qo'yamiz
      await pool.query(
        `INSERT INTO copilot_chat_messages (tenant_id, session_id, user_id, role, content, patient_id)
         VALUES ($1, $2, $3, 'assistant', $4, $5)`,
        [tenantId, sessionId, req.user?.id || null, result.answer, parsed.data.patient_id || null]
      );

      res.json({
        success: true,
        session_id: sessionId,
        answer: result.answer,
        disclaimer: result.disclaimer,
      });
    } catch (e) {
      console.error('[COPILOT chat]', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── SMART AUTOFILL ──
  const autofillSchema = z.object({
    text: z.string().min(3).max(5000),
    context: z.enum(['visit_complete', 'daily_note', 'discharge']).optional(),
  });

  router.post('/autofill', async (req, res) => {
    try {
      const parsed = autofillSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validatsiya xatosi' });
      }
      const result = await smartAutofill.handler(parsed.data);
      res.json({
        success: true,
        ...result,
        disclaimer: 'AI tavsiya — tekshirib saqlang',
      });
    } catch (e) {
      console.error('[COPILOT autofill]', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── PROPOSALS: list + confirm/reject ──
  router.get('/proposals', async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const status = String(req.query.status || 'pending');
      const { rows } = await pool.query(
        `SELECT id, patient_id, admission_id, action_kind, action_payload,
                raw_input, confidence, proposed_by_agent, created_at, expires_at
         FROM ai_action_proposals
         WHERE tenant_id = $1 AND status = $2
           AND (proposed_by_user = $3 OR $4 IN ('admin', 'ceo'))
           AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 100`,
        [tenantId, status, req.user?.id || null, req.user?.role || '']
      );
      res.json({ success: true, proposals: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /proposals/:id/confirm  (shifokor tasdiqlaydi va harakat bajariladi)
  router.post('/proposals/:id/confirm', async (req, res) => {
    const client = await pool.connect();
    try {
      const tenantId = tenantOf(req);
      await client.query('BEGIN');

      const row = (await client.query(
        `SELECT * FROM ai_action_proposals
         WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
           AND expires_at > NOW()
         FOR UPDATE`,
        [tenantId, req.params.id]
      )).rows[0];

      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Taklif topilmadi yoki muddati o\'tgan' });
      }

      // Faqat egasi yoki admin tasdiqlaydi
      const isOwner = row.proposed_by_user === req.user?.id;
      const isAdmin = ['admin', 'ceo'].includes(req.user?.role);
      if (!isOwner && !isAdmin) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, error: 'Faqat taklif egasi tasdiqlashi mumkin' });
      }

      const payload = typeof row.action_payload === 'string' ? JSON.parse(row.action_payload) : row.action_payload;
      let resultRef = null;

      // Harakat turi bo'yicha bajarish (transactional). Har action_kind — o'z INSERT'i.
      if (row.action_kind === 'prescription' && row.admission_id) {
        const id = uuidv4();
        await client.query(
          `INSERT INTO prescriptions (id, admission_id, doctor_id, doctor_name,
             medicine_name, dosage, route, frequency, start_date, end_date)
           VALUES ($1, $2, $3, $4, $5, $6, 'ichish', $7, CURRENT_DATE,
                   CASE WHEN $8::int > 0 THEN CURRENT_DATE + ($8 || ' days')::interval ELSE NULL END)`,
          [id, row.admission_id, req.user?.id || null, req.user?.name || null,
           payload.medicine_name, payload.dosage || null, payload.frequency || null,
           payload.duration_days || 0]
        );
        resultRef = id;
      } else if (row.action_kind === 'lab_order' && row.patient_id) {
        const id = uuidv4();
        await client.query(
          `INSERT INTO lab_orders (id, tenant_id, patient_id, admission_id, doctor_id,
             test_type, reason, status, ordered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ordered', NOW())`,
          [id, tenantId, row.patient_id, row.admission_id, req.user?.id || null,
           payload.test_type || 'other', payload.reason || null]
        );
        resultRef = id;
      } else if (row.action_kind === 'admission' && row.admission_id) {
        // Faqat parhez stoli va davolash rejasi yangilanadi (yotqizish AI qilmaydi)
        const updates = [];
        const params = [row.admission_id, tenantId];
        let i = 3;
        if (payload.diet_number) { updates.push(`diet_number = $${i++}`); params.push(payload.diet_number); }
        if (payload.treatment_plan) { updates.push(`treatment_plan = $${i++}`); params.push(payload.treatment_plan); }
        if (updates.length) {
          await client.query(
            `UPDATE admissions SET ${updates.join(', ')} WHERE id = $1 AND tenant_id = $2`,
            params
          );
          resultRef = row.admission_id;
        }
      } else if (row.action_kind === 'daily_note' && row.admission_id) {
        const id = uuidv4();
        await client.query(
          `INSERT INTO daily_notes (id, tenant_id, admission_id, patient_id, doctor_id, doctor_name,
             date, shift, complaints, objective_status, treatment_plan, notes, raw_text)
           VALUES ($1, $2, $3, (SELECT patient_id FROM admissions WHERE id = $3), $4, $5,
                   CURRENT_DATE, 'ertalab', $6, $7, $8, $9, $10)`,
          [id, tenantId, row.admission_id, req.user?.id || null, req.user?.name || null,
           payload.complaints || null, payload.objective_status || null,
           payload.treatment_plan || null, payload.notes || null, row.raw_input]
        );
        resultRef = id;
      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: `Bu turdagi harakatni bajarib bo'lmaydi: ${row.action_kind}` });
      }

      await client.query(
        `UPDATE ai_action_proposals
         SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = $1, result_ref = $2
         WHERE id = $3`,
        [req.user?.id || null, String(resultRef || ''), row.id]
      );

      await client.query('COMMIT');
      res.json({ success: true, result_ref: resultRef, action_kind: row.action_kind });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[COPILOT confirm]', e);
      res.status(500).json({ success: false, error: e.message });
    } finally {
      client.release();
    }
  });

  // POST /proposals/:id/reject
  router.post('/proposals/:id/reject', async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const reason = String(req.body?.reason || '').slice(0, 500) || null;
      const { rowCount } = await pool.query(
        `UPDATE ai_action_proposals
         SET status = 'rejected', confirmed_at = NOW(), confirmed_by = $1, rejection_reason = $2
         WHERE tenant_id = $3 AND id = $4 AND status = 'pending'`,
        [req.user?.id || null, reason, tenantId, req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ success: false, error: 'Taklif topilmadi' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
