// ============================================================
// FALCON AI OS — Shifokor ish stoli.
// Bugungi navbat, ko'rikni yakunlash, ichki yo'llanma.
// Barcha yozuvlar bir bemor kartasiga (patient_id) bog'lanadi.
// ============================================================
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

// DIQQAT: server.js bu faylni FAQAT 4 argument bilan chaqiradi —
//   doctorViewRoutes(getPool(), authMiddleware, checkRole, serverError)
// Ilgari signatura 7 ta parametr kutar edi (_validate, _schemas,
// _telegramOrJwtAuth kabi hech qachon kelmaydigan o'lik parametrlar),
// shuning uchun `upload` (7-o'rin) doim undefined bo'lib, ovozli ko'rik
// endpointi `upload.single is not a function` bilan butun serverni
// ishga tushmay qo'yardi (production'da sinab ko'rilganda topildi).
// Endi signatura chaqiruv bilan AYNAN mos: 4-o'rin — upload.
export default function doctorRoutes(pool, authMiddleware, checkRole, upload) {
  const serverError = (res, e) => {
    console.error('[DOCTOR]', e);
    res.status(500).json({ success: false, error: e?.message || 'Server xatosi' });
  };
  const router = Router();

  async function q(sql, params = []) {
    const r = await pool.query(sql, params);
    return /^SELECT/i.test(sql.trim()) ? r.rows : r;
  }
  async function qGet(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
  }
  const tenantOf = (req) => req.user?.tenant_id || req.tenant_id || 'default';

  /**
   * Ko'rikda buyurilgan dorilarni allergiya va faol dorilar bilan tekshiradi.
   *
   * `medicines` — erkin matn ("Amoksitsillin 500mg 3 mahal, Ibuprofen 200mg").
   * Agent bitta dori kutadi, shuning uchun ro'yxatni ajratamiz: aks holda
   * butun satr bitta "dori nomi" deb solishtirilib, allergiya mosligi
   * o'tkazib yuborilishi mumkin edi.
   */
  async function runDrugSafety(tenantId, patientId, consultationId, medicinesText) {
    if (!patientId) return; // Kartaga bog'lanmagan yozuvda tekshiradigan tarix yo'q
    const { drugInteraction } = await import('../../ai/agents/safety-agents.js');
    const { saveAlerts, fetchAllergies, fetchActiveMeds } = await import('../services/alerts.js');

    const drugs = String(medicinesText)
      .split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length >= 3)
      .slice(0, 10); // Bir ko'rikda 10 tadan ortiq dori — LLM sarfini cheklaymiz
    if (!drugs.length) return;

    const [allergies, activeMeds] = await Promise.all([
      fetchAllergies(pool, tenantId, patientId),
      fetchActiveMeds(pool, tenantId, patientId),
    ]);

    const all = [];
    for (const d of drugs) {
      const di = await drugInteraction.handler({ new_drug: d, allergies, active_meds: activeMeds });
      if (di?.alerts?.length) all.push(...di.alerts);
    }
    if (all.length) {
      await saveAlerts(pool, {
        tenantId, patientId, sourceKind: 'consultation',
        sourceId: consultationId, agentName: 'drug-interaction',
      }, all);
    }
  }

  // ── ESKI ENDPOINTLAR (dashboard kartalarga kerak — buzmasdan qoldirdik) ──
  router.get('/my-patients', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const patients = await q(
        "SELECT * FROM patient_consultations WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY created_at DESC LIMIT 50",
        [tenantId, req.user.id]
      );
      const appointments = await q(
        "SELECT * FROM appointments WHERE tenant_id = $1 AND doctor_name = $2 ORDER BY created_at DESC LIMIT 20",
        [tenantId, req.user.name]
      );
      res.json({ success: true, patients: patients.length, consultations: patients, appointments });
    } catch (e) { serverError(res, e); }
  });

  router.get('/my-stats', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const stats = await qGet(
        "SELECT * FROM doctor_analytics WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY period_start DESC LIMIT 1",
        [tenantId, req.user.id]
      );
      const recent = await qGet(
        "SELECT COUNT(*) as c FROM patient_consultations WHERE tenant_id = $1 AND doctor_id = $2 AND date(created_at) = CURRENT_DATE",
        [tenantId, req.user.id]
      );
      res.json({ success: true, stats: stats || { patients_count: 0, total_revenue: 0 }, today_patients: parseInt(recent?.c || 0) });
    } catch (e) { serverError(res, e); }
  });

  // ── YANGI: BUGUNGI NAVBAT ──
  // Shifokor kirganda birinchi ko'rishi kerak bo'lgan narsa —
  // bugungi bronlar, holati bilan (kutmoqda / ko'rilmoqda / tugadi).
  router.get('/queue', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const date = String(req.query.date || '').trim() || null;
      const dateFilter = date
        ? "AND date(a.scheduled_at) = $3"
        : "AND date(a.scheduled_at) = CURRENT_DATE";
      const params = date ? [tenantId, req.user.id, date] : [tenantId, req.user.id];

      const rows = await q(
        `SELECT a.id, a.appointment_id, a.patient_id, a.patient_name, a.phone,
                a.scheduled_at, a.status, a.payment_status, a.amount::float8 AS amount,
                a.notes, s.name AS service_name,
                p.medical_record_number, p.district, p.address,
                a.forwarded_from_appointment_id,
                a.forwarded_from_doctor_id,
                fwd_doc.first_name || ' ' || COALESCE(fwd_doc.last_name, '') AS forwarded_from_doctor_name,
                fwd_doc.specialization                AS forwarded_from_doctor_spec,
                EXISTS(SELECT 1 FROM patient_consultations c
                       WHERE c.tenant_id = a.tenant_id AND c.appointment_id = a.id) AS has_consultation
         FROM appointments a
         LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
         LEFT JOIN patients p         ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
         LEFT JOIN doctors fwd_doc    ON fwd_doc.id = a.forwarded_from_doctor_id
                                      AND fwd_doc.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1 AND a.doctor_id = $2 ${dateFilter}
           AND a.status NOT IN ('cancelled', 'no_show')
         ORDER BY a.scheduled_at ASC`,
        params
      );
      res.json({ success: true, date: date || new Date().toISOString().slice(0, 10), queue: rows });
    } catch (e) { serverError(res, e); }
  });

  // ── OVOZLI KO'RIK ──
  // Shifokor ko'rik natijasini gapiradi; STT matnga o'giradi, orkestrator
  // `visit-scribe` agenti maydonlarga ajratadi va TAKLIF qaytaradi.
  //
  // BAZAGA HECH NARSA YOZMAYDI — bu ataylab. `/api/scribe/transcribe`
  // har diktantda alohida `patient_consultations` yozuvi yaratadi va u
  // `appointment_id` siz bo'ladi; qabul oqimida ishlatilsa bitta tashrifga
  // ikkita karta yozilardi. Bu yerda yozuvni faqat shifokor tasdiqlagach
  // `/complete` yozadi — bitta tashrif, bitta karta.
  router.post('/visit/:appointmentId/voice', authMiddleware, checkRole('doctor'),
    upload.single('audio'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const appointmentId = req.params.appointmentId;

      // Boshqa shifokorning bemori diktant qilinmasin
      const appt = await qGet(
        `SELECT a.id, a.patient_id, a.patient_name, d.specialization
           FROM appointments a
           LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1 AND a.id = $2 AND a.doctor_id = $3`,
        [tenantId, appointmentId, req.user.id]
      );
      if (!appt) {
        return res.status(404).json({ success: false, error: 'Bron topilmadi yoki sizga tegishli emas' });
      }

      const { transcribe } = await import('../../ai/orchestrator.js');
      let text;
      if (req.file) {
        const stt = await transcribe(req.file.buffer, req.file.originalname || 'audio.webm',
          { language: req.body?.language });
        if (stt.error) {
          return res.status(stt.code === 'UNSUPPORTED_LANGUAGE' ? 400 : 502)
            .json({ success: false, error: stt.error, code: stt.code });
        }
        text = stt.text;
      } else if (req.body?.raw_text) {
        text = String(req.body.raw_text);
      } else {
        return res.status(400).json({ success: false, error: 'Audio yoki matn talab qilinadi' });
      }

      // Bo'sh transkripsiya hech qachon o'tmaydi (scribe.js bilan bir xil qoida):
      // VAD nutq topmasa STT xatosiz "" qaytaradi va LLM bo'sh matndan
      // javob "o'ylab topardi" — tibbiy kartaga soxta yozuv tushardi.
      if (!String(text || '').trim()) {
        return res.status(422).json({
          success: false, code: 'EMPTY_TRANSCRIPT',
          error: 'Ovoz aniqlanmadi. Mikrofonni tekshirib, qaytadan yozing.',
        });
      }

      const { executeAgent } = await import('../../ai/orchestrator.js');
      const run = await executeAgent('visit-scribe', {
        text,
        specialty: req.body?.specialty || appt.specialization || null,
        patient_name: appt.patient_name || null,
      }, { tenantId, user: req.user });

      // Agent yiqilsa ham diktant YO'QOLMASIN — shifokor xom matnni ko'radi.
      if (!run.success) {
        return res.json({
          success: true, transcription: text, fields: {}, structured: false,
          note: `AI matnni ajrata olmadi (${run.error}). Diktant matni saqlangan, maydonlarni qo'lda to'ldiring.`,
        });
      }

      res.json({
        success: true,
        transcription: text,
        fields: run.data.fields,
        next_step: run.data.next_step,
        structured: run.data.structured,
        note: run.data.note || null,
      });
    } catch (e) { serverError(res, e); }
  });

  // ── YANGI: KO'RIKNI YAKUNLASH ──
  // Shifokor xulosa (diagnoz, muolaja, dori) yozadi va appointment yopiladi.
  // Xulosa patient_consultations ga tushadi (patient_id + appointment_id bilan).
  // Doktor qaroriga qarab keyingi qadam turlari:
  //  - 'home'      — uyga (oqim tugadi)
  //  - 'labs'      — tekshiruvlar (lab_types massivi → lab_orders avto yaratiladi)
  //  - 'admission' — statsionarga (appointment status='pending_admission' bo'ladi)
  //  - 'referral'  — boshqa doktor/bo'limga (VisitDialog referral tugmasi ishlatiladi)
  const completeSchema = z.object({
    diagnosis: z.string().max(2000).optional(),
    procedure: z.string().max(1000).optional(),
    medicines: z.string().max(2000).optional(),
    notes: z.string().max(2000).optional(),
    raw_text: z.string().max(10000).optional(),
    next_step: z.enum(['home', 'labs', 'admission', 'referral']).optional(),
    // labs uchun: tanlangan tekshiruv turlari (lab_orders da test_type)
    lab_types: z.array(z.string().max(50)).max(15).optional(),
    // admission uchun: yotqizish sababi va bo'lim (ma'lumot uchun)
    admission_reason: z.string().max(500).optional(),
    admission_department: z.string().max(100).optional(),
  });

  router.post('/visit/:appointmentId/complete', authMiddleware, checkRole('doctor'), async (req, res) => {
    const validated = completeSchema.safeParse(req.body || {});
    if (!validated.success) {
      return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: validated.error.flatten().fieldErrors });
    }
    const b = validated.data;

    const client = await pool.connect();
    try {
      const tenantId = tenantOf(req);
      const appointmentId = req.params.appointmentId;

      await client.query('BEGIN');

      // Bron mavjudmi va shu shifokornikimi?
      const appt = (await client.query(
        `SELECT id, patient_id, patient_name, status FROM appointments
         WHERE tenant_id = $1 AND id = $2 AND doctor_id = $3 FOR UPDATE`,
        [tenantId, appointmentId, req.user.id]
      )).rows[0];
      if (!appt) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Bron topilmadi yoki sizga tegishli emas' });
      }

      const consId = uuidv4();
      const dataJson = {
        diagnosis: b.diagnosis || '',
        procedure: b.procedure || '',
        medicines: b.medicines || '',
        notes: b.notes || '',
      };
      const nextStep = b.next_step || 'home';
      const nextStepData = {
        lab_types: b.lab_types || [],
        admission_reason: b.admission_reason || '',
        admission_department: b.admission_department || '',
      };

      await client.query(
        `INSERT INTO patient_consultations
           (id, tenant_id, doctor_id, patient_id, appointment_id, patient_name,
            raw_text, data_json, next_step, next_step_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [consId, tenantId, req.user.id, appt.patient_id, appt.id, appt.patient_name,
         b.raw_text || '', JSON.stringify(dataJson), nextStep, JSON.stringify(nextStepData)]
      );

      // Appointment holatini keyingi qadamga qarab belgilaymiz
      const newApptStatus = nextStep === 'admission' ? 'pending_admission' : 'completed';
      await client.query(
        `UPDATE appointments SET status = $1 WHERE id = $2 AND tenant_id = $3`,
        [newApptStatus, appt.id, tenantId]
      );

      // Avto lab_orders yaratamiz — bemor kassaga savat bilan boradi
      const createdLabs = [];
      if (nextStep === 'labs' && b.lab_types && b.lab_types.length > 0) {
        for (const t of b.lab_types) {
          const labId = uuidv4();
          const row = (await client.query(
            `INSERT INTO lab_orders
               (id, tenant_id, patient_id, appointment_id, doctor_id, test_type, reason, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'ordered', NOW())
             RETURNING id, test_type`,
            [labId, tenantId, appt.patient_id, appt.id, req.user.id, t, b.diagnosis || null]
          )).rows[0];
          createdLabs.push(row);
        }
      }

      await client.query('COMMIT');

      // AUTO-AGENT: dori xavfsizligi. Shifokor dori buyurgan bo'lsa,
      // bemor allergiyasi va faol dorilari bilan tekshiriladi; xavf topilsa
      // `ai_alerts` ga yoziladi va UI'da qizil ogohlantirish chiqadi.
      //
      // JAVOB KUTILMAYDI (fire-and-forget): tekshiruv LLM'ga borishi mumkin,
      // shifokorni kutdirish qabul oqimini sekinlashtiradi. Xavfsizlik
      // tekshiruvi ko'rik yozuvini BLOKLAMAYDI — u qo'shimcha qatlam.
      if (dataJson.medicines) {
        runDrugSafety(tenantId, appt.patient_id, consId, dataJson.medicines)
          .catch((e) => console.warn('[SAFETY drug-interaction]', e.message));
      }

      res.json({
        success: true,
        consultation_id: consId,
        appointment_id: appt.id,
        next_step: nextStep,
        appointment_status: newApptStatus,
        lab_orders: createdLabs,
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      serverError(res, e);
    } finally {
      client.release();
    }
  });

  // ── YANGI: ICHKI YO'LLANMA ──
  // Ginekolog roddomga, terapevt xirurgiyaga jo'natadi.
  // to_doctor_id yoki to_department dan bittasi majburiy.
  const referralSchema = z.object({
    patient_id: z.string().uuid().optional(),
    patient_name: z.string().max(200).optional(),
    to_doctor_id: z.string().uuid().optional(),
    to_department: z.string().max(100).optional(),
    service_required: z.string().min(1).max(500),
    notes: z.string().max(2000).optional(),
  }).refine((d) => d.to_doctor_id || d.to_department, {
    message: 'to_doctor_id yoki to_department kerak',
  }).refine((d) => d.patient_id || d.patient_name, {
    message: 'patient_id yoki patient_name kerak',
  });

  router.post('/referral', authMiddleware, checkRole('doctor'), async (req, res) => {
    const validated = referralSchema.safeParse(req.body || {});
    if (!validated.success) {
      return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: validated.error.flatten().fieldErrors });
    }
    const b = validated.data;
    try {
      const tenantId = tenantOf(req);
      // Bemor ismini kartadan olamiz (patient_id bo'lsa)
      let patientName = b.patient_name || '';
      if (b.patient_id && !patientName) {
        const p = await qGet(
          'SELECT first_name, last_name, middle_name FROM patients WHERE tenant_id = $1 AND id = $2',
          [tenantId, b.patient_id]
        );
        if (p) patientName = `${p.last_name || ''} ${p.first_name} ${p.middle_name || ''}`.replace(/\s+/g, ' ').trim();
      }

      const id = uuidv4();
      const referralId = 'R' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
      const qrToken = uuidv4().replace(/-/g, '');

      await q(
        `INSERT INTO referrals
           (id, tenant_id, referral_id, kind, patient_id, patient_name,
            service_required, status, qr_code_token,
            from_doctor_id, to_doctor_id, to_department,
            referring_doctor, notes)
         VALUES ($1,$2,$3,'internal',$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12)`,
        [id, tenantId, referralId, b.patient_id || null, patientName || "Noma'lum",
         b.service_required, qrToken,
         req.user.id, b.to_doctor_id || null, b.to_department || null,
         req.user.name || req.user.username || null, b.notes || null]
      );

      res.status(201).json({ success: true, referral: { id, referral_id: referralId, status: 'pending' } });
    } catch (e) { serverError(res, e); }
  });

  // ── YANGI: KELGAN YO'LLANMALAR ──
  // Roddom/xirurgiya qabuli boshqa shifokordan kelgan yo'llanmalarni ko'radi.
  router.get('/referrals/incoming', authMiddleware, checkRole('doctor', 'admin', 'receptionist'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      // Shifokor uchun — o'ziga kelganlar; qabulxona/admin uchun — bo'limga kelganlar
      const status = String(req.query.status || 'pending');
      let rows;
      if (req.user.role === 'doctor') {
        rows = await q(
          `SELECT r.id, r.referral_id, r.patient_id, r.patient_name, r.service_required,
                  r.status, r.referring_doctor, r.notes, r.to_department, r.created_at,
                  p.medical_record_number, p.phone
           FROM referrals r
           LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
           WHERE r.tenant_id = $1 AND r.kind = 'internal'
             AND r.to_doctor_id = $2 AND r.status = $3
           ORDER BY r.created_at DESC LIMIT 100`,
          [tenantId, req.user.id, status]
        );
      } else {
        const dept = String(req.query.department || '').trim();
        const deptFilter = dept ? 'AND r.to_department ILIKE $3' : '';
        const params = dept ? [tenantId, status, `%${dept}%`] : [tenantId, status];
        rows = await q(
          `SELECT r.id, r.referral_id, r.patient_id, r.patient_name, r.service_required,
                  r.status, r.referring_doctor, r.notes, r.to_department, r.created_at,
                  p.medical_record_number, p.phone
           FROM referrals r
           LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
           WHERE r.tenant_id = $1 AND r.kind = 'internal' AND r.status = $2 ${deptFilter}
           ORDER BY r.created_at DESC LIMIT 100`,
          params
        );
      }
      res.json({ success: true, referrals: rows });
    } catch (e) { serverError(res, e); }
  });

  // ── YANGI: BEMORNING OLDINGI DOKTOR XULOSALARI ──
  // Ko'rik dialogi ochilganda "Bu bemor bugungi/oxirgi kunlarda kim ko'rgan?"
  // — 2-doktor 1-doktor xulosasini shu tufayli darrov ko'radi.
  router.get('/visit/:appointmentId/prior', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const appt = await qGet(
        `SELECT patient_id FROM appointments WHERE tenant_id = $1 AND id = $2`,
        [tenantId, req.params.appointmentId]
      );
      if (!appt) return res.status(404).json({ success: false, error: 'Bron topilmadi' });
      if (!appt.patient_id) return res.json({ success: true, prior: [] });

      // Oxirgi 30 kun ichida shu bemor bo'yicha barcha yakunlangan konsultatsiyalar
      // (o'zining bugungi bronidan tashqari). Doktor ismi bilan.
      const rows = await q(
        `SELECT c.id, c.created_at, c.appointment_id, c.doctor_id, c.data_json,
                d.first_name || ' ' || COALESCE(d.last_name, '') AS doctor_name,
                d.specialization AS doctor_spec,
                a.appointment_id AS appt_code,
                s.name AS service_name
         FROM patient_consultations c
         LEFT JOIN doctors d ON d.id = c.doctor_id AND d.tenant_id = c.tenant_id
         LEFT JOIN appointments a ON a.id = c.appointment_id AND a.tenant_id = c.tenant_id
         LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = c.tenant_id
         WHERE c.tenant_id = $1 AND c.patient_id = $2
           AND c.id NOT IN (
             SELECT id FROM patient_consultations
             WHERE appointment_id = $3
           )
           AND c.created_at > NOW() - INTERVAL '30 days'
         ORDER BY c.created_at DESC LIMIT 20`,
        [tenantId, appt.patient_id, req.params.appointmentId]
      );

      const prior = rows.map((r) => {
        const dj = typeof r.data_json === 'string'
          ? (() => { try { return JSON.parse(r.data_json); } catch { return {}; } })()
          : (r.data_json || {});
        return {
          id: r.id,
          created_at: r.created_at,
          appointment_code: r.appt_code,
          doctor_name: r.doctor_name?.trim() || 'Noma\'lum',
          doctor_spec: r.doctor_spec || null,
          service_name: r.service_name || null,
          diagnosis: dj.diagnosis || '',
          procedure: dj.procedure || '',
          medicines: dj.medicines || '',
          notes: dj.notes || '',
        };
      });
      res.json({ success: true, prior });
    } catch (e) { serverError(res, e); }
  });

  // ── YANGI: BOSHQA SHIFOKORGA YO'NALTIRISH ──
  // Doktor "Boshqa shifokorga yubor" bosgach:
  //  1) Yangi appointment yaratiladi (payment_status='pending') — kassa ko'radi.
  //  2) forwarded_from_appointment_id — hozirgi tashrifga havola.
  //     Bemor to'lagach, 2-doktor navbatida ko'rinadi va uning ko'rik dialogida
  //     1-doktor xulosasi darrov ochiladi.
  //  3) Hozirgi ko'rik (agar hali yakunlanmagan bo'lsa) tegilmaydi — doktor
  //     istasa keyin yakunlaydi.
  const forwardSchema = z.object({
    to_doctor_id: z.string().uuid(),
    service_id:   z.string().uuid(),
    scheduled_at: z.string().datetime().optional(), // bo'lmasa hozirdan +1 daqiqa
    notes:        z.string().max(1000).optional(),
    payment_method: z.enum(['cashier', 'online']).optional(),
  });

  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function shortCode(len = 6) {
    const buf = new Uint8Array(len);
    (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(buf);
    let s = '';
    for (let i = 0; i < len; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    return s;
  }

  router.post('/visit/:appointmentId/forward', authMiddleware, checkRole('doctor'), async (req, res) => {
    const validated = forwardSchema.safeParse(req.body || {});
    if (!validated.success) {
      return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: validated.error.flatten().fieldErrors });
    }
    const b = validated.data;
    const client = await pool.connect();
    try {
      const tenantId = tenantOf(req);
      await client.query('BEGIN');

      // Hozirgi bron shu doktornikimi
      const src = (await client.query(
        `SELECT id, patient_id, patient_name, phone, region, district, mahalla, doctor_id
         FROM appointments WHERE tenant_id = $1 AND id = $2 AND doctor_id = $3`,
        [tenantId, req.params.appointmentId, req.user.id]
      )).rows[0];
      if (!src) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Bron topilmadi yoki sizga tegishli emas' });
      }

      // Target shifokor va xizmat mavjudmi
      const toDoc = (await client.query(
        `SELECT id, first_name, last_name, specialization FROM doctors
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, b.to_doctor_id]
      )).rows[0];
      if (!toDoc) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Yuborilayotgan shifokor topilmadi' });
      }
      const svc = (await client.query(
        `SELECT id, name, price::float8 AS price FROM services_catalog
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, b.service_id]
      )).rows[0];
      if (!svc) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Xizmat topilmadi' });
      }

      const scheduledAt = b.scheduled_at || new Date(Date.now() + 60_000).toISOString();
      const apptCode = 'A' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
      const accessCode = shortCode(6);

      const newRow = (await client.query(
        `INSERT INTO appointments
           (tenant_id, appointment_id, patient_id, patient_name, phone,
            doctor_id, doctor_name, service_id, scheduled_at, amount,
            department, source, status, payment_status, payment_method,
            access_code, notes, region, district, mahalla,
            forwarded_from_appointment_id, forwarded_from_doctor_id, forwarded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'doctor_forward','scheduled','pending',$12,
                 $13,$14,$15,$16,$17,$18,$19, NOW())
         RETURNING id, appointment_id, access_code, amount::float8 AS amount`,
        [
          tenantId, apptCode, src.patient_id, src.patient_name, src.phone,
          toDoc.id, `${toDoc.first_name} ${toDoc.last_name || ''}`.trim(),
          svc.id, scheduledAt, svc.price,
          toDoc.specialization || 'therapy',
          b.payment_method || 'cashier', accessCode, b.notes || null,
          src.region || null, src.district || null, src.mahalla || null,
          src.id, req.user.id,
        ]
      )).rows[0];

      // Ma'lumot uchun ichki referral yozuvi ham qo'shamiz (audit)
      try {
        const refId = uuidv4();
        const referralCode = 'R' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
        await client.query(
          `INSERT INTO referrals
             (id, tenant_id, referral_id, kind, patient_id, patient_name,
              service_required, status, qr_code_token,
              from_doctor_id, to_doctor_id, referring_doctor, notes)
           VALUES ($1,$2,$3,'internal',$4,$5,$6,'pending',$7,$8,$9,$10,$11)`,
          [refId, tenantId, referralCode, src.patient_id, src.patient_name,
           svc.name, uuidv4().replace(/-/g, ''),
           req.user.id, toDoc.id,
           req.user.name || req.user.username || null,
           b.notes || null]
        );
      } catch (_) { /* referral yozuvi audit uchun; asosiy oqim ishlaydi */ }

      await client.query('COMMIT');
      res.status(201).json({
        success: true,
        appointment: newRow,
        message: `Bemor kassaga yuborildi. Kirish kodi: ${newRow.access_code}. To'lovdan keyin ${toDoc.first_name} ${toDoc.last_name || ''} navbatiga tushadi.`,
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      serverError(res, e);
    } finally {
      client.release();
    }
  });

  return router;
}
