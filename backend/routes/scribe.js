import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { MEDICAL_SKILLS, listSpecializations, resolveSpecialization } from '../../ai/protocols/medical-skills.js';
import { SUPPORTED_LANGUAGES } from '../../ai/engines/stt.js';
import { validateMedications } from '../services/medication-check.js';

// Whisper sonlarni so'z bilan chiqaradi ("qirq besh"). LLM ajratishda raqamga o'giramiz.
const NUMBER_RULE =
  "\nMUHIM: barcha sonlarni RAQAMLARDA yozing, so'z bilan emas. " +
  "Masalan: \"qirq besh\" -> 45, \"o'ttiz yetti nuqta besh\" -> 37.5, \"yuz yigirma\" -> 120, " +
  "\"to'qson\" -> 90, \"besh yuz ming\" -> 500000. Yosh, harorat, bosim, puls, doza, " +
  "telefon raqami, miqdor, narx — hammasi raqamda bo'lsin.";

// Tuzilmali qabul shabloni (roadmap PR #7): shikoyat, anamnez, tekshiruv,
// tashxis, tavsiya va dorilar ALOHIDA maydonlarda. Eski kalitlar (medicines,
// procedure) saqlanadi — eski UI va ombor sarfi shabloniga tayanadi.
const INTAKE_PROMPT =
  "Siz shifokor yordamchisisiz. Diktantdan qabul ma'lumotlarini ajratib, faqat JSON qaytaring:\n" +
  '{"patient_name":"...","complaints":"...","anamnesis":"...","examination":"...",' +
  '"diagnosis":"...","recommendations":"...",' +
  '"medications":[{"name":"...","dose":"...","frequency":"..."}],' +
  '"medicines":"...","procedure":"..."}\n' +
  "medications — har bir dori alohida obyekt (nom, doza, qabul chastotasi). " +
  "medicines — xuddi shu dorilarning qisqa satr ko'rinishi. " +
  "Diktantda aytilmagan maydonni BO'SH satr qoldiring — o'ylab topmang.";

export default function scribeRoutes(pool, authMiddleware, checkRole, upload, serverError, logger) {
  const router = Router();

  async function q(sql, params = []) {
    const r = await pool.query(sql, params);
    return /^SELECT/i.test(sql.trim()) ? r.rows : r;
  }
  async function qGet(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
  }

  router.post('/transcribe', authMiddleware, checkRole('doctor', 'admin'), upload.single('audio'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const { transcribe, llm } = await import('../../ai/orchestrator.js');
      const { saveRecording, markTranscribed, markFailed } =
        await import('../services/voice-store.js');
      let text;
      let sttLanguage = null;
      let rec = null;
      if (req.file) {
        // AVVAL DISKKA — transkripsiya yiqilsa diktant yo'qolmasin
        rec = await saveRecording(pool, {
          tenantId, userId: req.user?.id, source: 'scribe',
          refId: null, patientId: req.body?.patient_id || null,
          buffer: req.file.buffer, mime: req.file.mimetype,
          originalName: req.file.originalname, language: req.body?.language,
        });
        const stt = await transcribe(req.file.buffer, req.file.originalname || 'audio.webm', { language: req.body?.language });
        if (stt.error) {
          // Til siyosati buzilgan bo'lsa — 400 (mijoz xatosi), aks holda 500
          await markFailed(pool, rec?.id, stt.error);
          return res.status(stt.code === 'UNSUPPORTED_LANGUAGE' ? 400 : 500).json({ success: false, error: stt.error, code: stt.code, recording_saved: !!rec });
        }
        text = stt.text;
        sttLanguage = stt.language || null;
      } else if (req.body?.raw_text) {
        text = req.body.raw_text;
      } else {
        return res.status(400).json({ success: false, error: 'Audio fayl yoki diktant matni talab qilinadi' });
      }

      // BO'SH MATNNI HECH QACHON SAQLAMAYMIZ.
      // VAD nutq topmasa (mikrofon o'chiq, noto'g'ri qurilma tanlangan,
      // shifokor uzoqda gapirgan) STT xatosiz "" qaytaradi. Ilgari shu
      // holatda LLM bo'sh matndan javob "o'ylab topar", tibbiy kartaga
      // bo'sh yozuv tushar va shifokorga "muvaffaqiyatli" deb ko'rsatilardi.
      if (!String(text || '').trim()) {
        await markFailed(pool, rec?.id, 'EMPTY_TRANSCRIPT');
        return res.status(422).json({
          success: false,
          code: 'EMPTY_TRANSCRIPT',
          error: 'Ovoz aniqlanmadi. Mikrofonni va tanlangan qurilmani tekshirib, qaytadan yozing.',
          recording_saved: !!rec,
        });
      }
      await markTranscribed(pool, rec?.id, text);
      // Mutaxassislik: so'rovda tanlangani ustun, aks holda shifokor profilidagi qiymat.
      // /upload bilan bir xil qoida — UI qaysi endpointga yuborsa ham shablon bir xil.
      const specialization =
        resolveSpecialization(req.body?.specialty) ||
        resolveSpecialization(req.user?.specialization) ||
        null;
      const basePrompt = specialization
        ? MEDICAL_SKILLS[specialization].systemPrompt
        : INTAKE_PROMPT;
      const result = await llm(
        basePrompt +
        "\n\nDiktant o'zbek yoki rus tilida bo'lishi mumkin — ikkalasini ham tushunasiz va JSON kalitlarini o'zgartirmasdan to'ldirasiz." +
        NUMBER_RULE +
        // procedure maydoni ombor sarfini avtomatik hisoblash uchun kerak —
        // yo'nalish shablonida bo'lmasa ham qo'shimcha kalit sifatida so'raymiz.
        "\nAgar diktantda biror muolaja/protsedura nomi aytilsa, JSONga qo'shimcha \"procedure\" kalitini ham qo'shing.",
        text
      );
      // Dori/doza tekshiruvi — LLM ishonchsiz joyda deterministic himoya (PR #7).
      // Ehtiyot: llm() JSON topilmasa SATR qaytarishi mumkin — primitivga
      // maydon qo'shib bo'lmaydi (strict mode TypeError).
      const medCheck = validateMedications(result);
      if (result && typeof result === 'object' && !result.error) {
        result.medication_check = medCheck.medications;
      }
      const consId = uuidv4();
      // patient_id — UI kartani oldindan tanlagan bo'lsa yoziladi, aks holda NULL
      // (istoriya keyin qo'lda biriktirish uchun ochiq).
      // status='draft' — shifokor tasdig'idan keyingina yakuniy bo'ladi (PR #7).
      await q("INSERT INTO patient_consultations (id, tenant_id, doctor_id, patient_id, patient_name, raw_text, data_json, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')",
        [consId, tenantId, req.body?.doctor_id || req.user?.id || null, req.body?.patient_id || null, result.patient_name || "Noma'lum", text, JSON.stringify(result)]);
      let consumption = null;
      if (result.procedure) {
        consumption = await q(
          `SELECT pn.*, inv.name as item_name, inv.current_stock FROM procedure_material_norms pn JOIN inventory_items inv ON inv.id = pn.item_id WHERE pn.tenant_id = $1 AND pn.procedure_name LIKE $2`,
          [tenantId, `%${result.procedure}%`]
        );
      }
      await q(`INSERT INTO usage_metering (tenant_id, metric, count, date) VALUES ($1, 'ai_requests', 1, CURRENT_DATE) ON CONFLICT (tenant_id, metric, date) DO UPDATE SET count = usage_metering.count + 1`, [tenantId]);
      const { trackAiRequest } = await import('../metrics.js');
      trackAiRequest('scribe', tenantId);
      res.json({ success: true, transcription: text, language: sttLanguage, data: result, consultation_id: consId, status: 'draft', medication_warnings: medCheck.warnings, auto_consumption: consumption });
    } catch (e) { serverError(res, e); }
  });

  router.post('/upload', authMiddleware, upload.single('audio'), async (req, res) => {
    try {
      // Audio yoki tayyor matn (shifokor diktantni yozib kiritishi yoki
      // transkriptni tahrirlab qayta yuborishi mumkin — shablon baribir qo'llanadi)
      if (!req.file && !req.body?.raw_text) {
        return res.status(400).json({ success: false, error: 'Audio fayl yoki diktant matni talab qilinadi' });
      }
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const { transcribe, llm } = await import('../../ai/orchestrator.js');
      // Balans/billing tekshiruvi faqat AI_SCRIBE_BILLING=true bo'lganda qo'llanadi.
      // Sukut bo'yicha o'chiq — klinika AI Scribe'dan darhol foydalana oladi;
      // pullik metering kerak bo'lsa .env da yoqiladi.
      if (process.env.AI_SCRIBE_BILLING === 'true' && req.user?.id) {
        const docCheck = await qGet("SELECT balance FROM doctors WHERE id = $1", [req.user.id]);
        if (docCheck && (docCheck.balance === null || docCheck.balance <= 0)) {
          return res.status(403).json({ success: false, error: 'Xizmat to\'xtatilgan. Platforma balansini to\'ldiring!', balance: docCheck.balance || 0 });
        }
      }
      // Mutaxassislik: so'rovda tanlangani ustun (shifokor bir necha yo'nalishda
      // diktant qilishi mumkin), aks holda profilidagi qiymat.
      const specialization =
        resolveSpecialization(req.body?.specialty) ||
        resolveSpecialization(req.user?.specialization) ||
        'doctor';
      const prompt = (MEDICAL_SKILLS[specialization]?.systemPrompt) ||
        "Siz shifokor yordamchisisiz. Ovozli matndan: bemor ismi, tashxis, muolaja nomi, buyurilgan dorilarni ajratib, faqat JSON qaytaring: {\"patient_name\":\"...\",\"diagnosis\":\"...\",\"procedure\":\"...\",\"medicines\":\"...\"}";
      let text, sttLanguage = null;
      let rec = null;
      const { saveRecording, markTranscribed, markFailed } =
        await import('../services/voice-store.js');
      if (req.file) {
        // AVVAL DISKKA — transkripsiya yiqilsa diktant yo'qolmasin
        rec = await saveRecording(pool, {
          tenantId, userId: req.user?.id, source: 'scribe',
          refId: null, patientId: req.body?.patient_id || null,
          buffer: req.file.buffer, mime: req.file.mimetype,
          originalName: req.file.originalname, language: req.body?.language,
        });
        const stt = await transcribe(req.file.buffer, req.file.originalname || 'audio.webm', { language: req.body?.language });
        if (stt.error) {
          // Til siyosati buzilgan bo'lsa — 400 (mijoz xatosi), aks holda 500
          await markFailed(pool, rec?.id, stt.error);
          return res.status(stt.code === 'UNSUPPORTED_LANGUAGE' ? 400 : 500).json({ success: false, error: stt.error, code: stt.code, recording_saved: !!rec });
        }
        text = stt.text;
        sttLanguage = stt.language || null;
      } else {
        text = String(req.body.raw_text).trim();
      }
      // /transcribe bilan bir xil qoida — bo'sh matn hech qachon saqlanmaydi
      if (!String(text || '').trim()) {
        await markFailed(pool, rec?.id, 'EMPTY_TRANSCRIPT');
        return res.status(422).json({
          success: false,
          code: 'EMPTY_TRANSCRIPT',
          error: req.file
            ? 'Ovoz aniqlanmadi. Mikrofonni va tanlangan qurilmani tekshirib, qaytadan yozing.'
            : 'Diktant matni bo\'sh',
          recording_saved: !!rec,
        });
      }
      await markTranscribed(pool, rec?.id, text);
      // Diktant ruscha bo'lishi mumkin — LLM ikkala tilni ham tushunishi kerak
      const result = await llm(prompt + "\n\nDiktant o'zbek yoki rus tilida bo'lishi mumkin — ikkalasini ham tushunasiz va JSON kalitlarini o'zgartirmasdan to'ldirasiz." + NUMBER_RULE, text);
      const medCheck = validateMedications(result);
      if (result && typeof result === 'object' && !result.error) {
        result.medication_check = medCheck.medications;
      }
      const consId = uuidv4();
      await q("INSERT INTO patient_consultations (id, tenant_id, doctor_id, patient_id, patient_name, raw_text, data_json) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [consId, tenantId, req.user?.id || null, req.body?.patient_id || null, result.patient_name || "Noma'lum", text, JSON.stringify(result)]);
      const specLabel = MEDICAL_SKILLS[specialization]?.label || specialization;
      const reportId = uuidv4();
      const telegramId = req.body?.telegram_id || null;
      await q("INSERT INTO medical_reports (id, tenant_id, patient_name, doctor_name, specialization, specialization_label, data_json, telegram_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [reportId, tenantId, result.patient_name || "Noma'lum", req.user?.name || req.user?.username || 'Noma\'lum', specialization, specLabel, JSON.stringify(result), telegramId]);

      let pdfUrl = null;
      try {
        const { generateReportPdf } = await import('../services/pdfGenerator.js');
        const pdf = await generateReportPdf({
          id: reportId, patient_name: result.patient_name || "Noma'lum",
          doctor_name: req.user?.name || req.user?.username || 'Noma\'lum',
          specialization, specialization_label: specLabel, data_json: result, created_at: new Date().toISOString()
        });
        await q("UPDATE medical_reports SET pdf_path = $1 WHERE id = $2", [pdf.filename, reportId]);
        pdfUrl = pdf.url;
      } catch (pdfErr) { logger.warn({ err: pdfErr }, '[PDF] Xatolik'); }

      if (telegramId && req.app.locals.patientBot) {
        try {
          const miniAppUrl = `${process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`}/mini-app.html?report_id=${reportId}`;
          let summary = 'AI tahlil natijalari\n\n';
          if (result.diagnosis) summary += `Tashxis: ${result.diagnosis}\n`;
          if (result.conclusion) summary += `Xulosa: ${result.conclusion}\n`;
          if (result.medicines) summary += `Dorilar: ${result.medicines}\n`;
          summary += `\nShifokor: ${req.user?.name || req.user?.username || 'Noma\'lum'}`;
          await req.app.locals.patientBot.telegram.sendMessage(telegramId, summary, {
            reply_markup: { inline_keyboard: [[{ text: 'Natijalarni korish', web_app: { url: miniAppUrl } }]] }
          }).catch(e => logger.warn({ err: e }, '[BOT] xatolik'));
        } catch (botErr) { logger.warn({ err: botErr }, '[BOT] Xabarnoma xatosi'); }
      }

      await q(`INSERT INTO usage_metering (tenant_id, metric, count, date) VALUES ($1, 'ai_requests', 1, CURRENT_DATE) ON CONFLICT (tenant_id, metric, date) DO UPDATE SET count = usage_metering.count + 1`, [tenantId]);
      const { trackAiRequest } = await import('../metrics.js');
      trackAiRequest('scribe', tenantId);
      res.json({ success: true, transcription: text, language: sttLanguage || null, data: result, consultation_id: consId, specialization, report_id: reportId, pdf_url: pdfUrl, telegram_notified: !!telegramId, medication_warnings: medCheck.warnings });
    } catch (e) { serverError(res, e); }
  });

  // GET /specialties — mavjud yo'nalish shablonlari va tillar (UI uchun yagona manba)
  router.get('/specialties', authMiddleware, (req, res) => {
    res.json({
      success: true,
      languages: SUPPORTED_LANGUAGES.map((code) => ({
        code,
        label: code === 'uz' ? "🇺🇿 O'zbekcha" : '🇷🇺 Ruscha',
      })),
      specialties: listSpecializations(),
      current: resolveSpecialization(req.user?.specialization),
    });
  });

  router.get('/history', authMiddleware, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const status = req.query.status === 'draft' || req.query.status === 'confirmed' ? req.query.status : null;
      const tenantId = req.user?.tenant_id || req.tenant_id;
      let consultations;
      if (req.user.role === 'doctor') {
        consultations = status
          ? await q("SELECT * FROM patient_consultations WHERE tenant_id = $1 AND doctor_id = $2 AND status = $3 ORDER BY created_at DESC LIMIT $4", [tenantId, req.user.id, status, limit])
          : await q("SELECT * FROM patient_consultations WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY created_at DESC LIMIT $3", [tenantId, req.user.id, limit]);
      } else {
        consultations = status
          ? await q("SELECT * FROM patient_consultations WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3", [tenantId, status, limit])
          : await q("SELECT * FROM patient_consultations WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2", [tenantId, limit]);
      }
      res.json({ success: true, total: consultations.length, consultations });
    } catch (e) { serverError(res, e); }
  });

  // ─── Shifokor tasdig'i oqimi (roadmap PR #7) ─────────────────────
  // AI diktantni DRAFT sifatida saqlaydi; shifokor ko'rib chiqib,
  // kerak bo'lsa tahrirlaydi va TASDIQLAYDI — faqat shundan keyin
  // yozuv bemor tarixining yakuniy qismiga aylanadi.

  /** Bitta konsultatsiya. Shifokor faqat o'zinikini ko'radi. */
  router.get('/consultations/:id', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const cons = await qGet("SELECT * FROM patient_consultations WHERE id = $1 AND tenant_id = $2", [req.params.id, tenantId]);
      if (!cons) return res.status(404).json({ success: false, error: 'Konsultatsiya topilmadi' });
      if (req.user.role === 'doctor' && cons.doctor_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Access Denied' });
      }
      res.json({ success: true, consultation: cons });
    } catch (e) { serverError(res, e); }
  });

  /** Draftni tahrirlash (tasdiqlangunga qadar). */
  router.put('/consultations/:id', authMiddleware, checkRole('doctor', 'admin'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const cons = await qGet("SELECT * FROM patient_consultations WHERE id = $1 AND tenant_id = $2", [req.params.id, tenantId]);
      if (!cons) return res.status(404).json({ success: false, error: 'Konsultatsiya topilmadi' });
      if (req.user.role === 'doctor' && cons.doctor_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Access Denied' });
      }
      if (cons.status === 'confirmed') {
        return res.status(409).json({ success: false, error: 'Tasdiqlangan yozuvni tahrirlab bo\'lmaydi' });
      }
      const { raw_text, data_json, patient_name } = req.body || {};
      if (raw_text === undefined && data_json === undefined && patient_name === undefined) {
        return res.status(400).json({ success: false, error: 'O\'zgartiriladigan maydon yo\'q' });
      }
      const updated = await qGet(
        `UPDATE patient_consultations SET
           raw_text = COALESCE($1, raw_text),
           data_json = COALESCE($2, data_json),
           patient_name = COALESCE($3, patient_name)
         WHERE id = $4 AND tenant_id = $5
         RETURNING id, status, patient_name, raw_text, data_json`,
        [
          raw_text === undefined ? null : String(raw_text),
          data_json === undefined ? null : JSON.stringify(data_json),
          patient_name === undefined ? null : String(patient_name),
          req.params.id, tenantId,
        ]
      );
      res.json({ success: true, consultation: updated });
    } catch (e) { serverError(res, e); }
  });

  /** Tasdiqlash — draft bemor tarixining yakuniy yozuviga aylanadi. */
  router.post('/consultations/:id/confirm', authMiddleware, checkRole('doctor', 'admin'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const cons = await qGet("SELECT * FROM patient_consultations WHERE id = $1 AND tenant_id = $2", [req.params.id, tenantId]);
      if (!cons) return res.status(404).json({ success: false, error: 'Konsultatsiya topilmadi' });
      if (req.user.role === 'doctor' && cons.doctor_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Access Denied' });
      }
      if (cons.status === 'confirmed') {
        return res.status(409).json({ success: false, error: 'Konsultatsiya allaqachon tasdiqlangan' });
      }
      await q("UPDATE patient_consultations SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = $1 WHERE id = $2 AND tenant_id = $3",
        [req.user.id, req.params.id, tenantId]);
      res.json({ success: true, consultation_id: cons.id, status: 'confirmed' });
    } catch (e) { serverError(res, e); }
  });

  /**
   * Qabuldan OLDINGI AI xulosa (roadmap PR #7): bemorning tasdiqlangan
   * konsultatsiyalari asosida qisqa xulosa. LLM ishlamasa (Ollama o'chiq,
   * kalit yo'q) DETERMINISTIK ro'yxatga qaytadi — xulosa hech qachon
   * xato bilan to'xtamaydi.
   */
  router.get('/patient-summary/:patientId', authMiddleware, checkRole('doctor', 'admin', 'ceo'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const rows = await q(
        `SELECT created_at, patient_name, data_json FROM patient_consultations
         WHERE tenant_id = $1 AND patient_id = $2 AND status = 'confirmed'
         ORDER BY created_at DESC LIMIT 5`,
        [tenantId, req.params.patientId]
      );
      if (rows.length === 0) {
        return res.json({ success: true, patient_id: req.params.patientId, summary: "Bemor uchun oldingi qabul yozuvlari topilmadi.", source: 'none', consultations: 0 });
      }
      // Deterministik zaxira — har doim tayyor
      const lines = rows.map((r) => {
        let data = {};
        try { data = typeof r.data_json === 'string' ? JSON.parse(r.data_json) : (r.data_json || {}); } catch { /* buzilgan JSON — o'tkazamiz */ }
        const date = new Date(r.created_at).toISOString().slice(0, 10);
        const parts = [date];
        if (data.diagnosis) parts.push(`Tashxis: ${data.diagnosis}`);
        if (data.medicines) parts.push(`Dorilar: ${data.medicines}`);
        return parts.join(' — ');
      });
      const deterministic = lines.join('\n');
      try {
        const { llm } = await import('../../ai/orchestrator.js');
        const ai = await llm(
          "Siz klinik yordamchisiz. Bemorning oldingi qabul yozuvlaridan qisqa, faktga asoslangan xulosa tuzing (3-5 jumla). Yangi ma'lumot o'ylab topmang. Faqat matn qaytaring.",
          deterministic
        );
        if (typeof ai === 'string' && ai.trim()) {
          return res.json({ success: true, patient_id: req.params.patientId, summary: ai.trim(), source: 'ai', consultations: rows.length });
        }
      } catch (e) { logger.warn({ err: e }, '[SUMMARY] LLM xatosi — deterministic xulosaga o\'tildi'); }
      res.json({ success: true, patient_id: req.params.patientId, summary: deterministic, source: 'deterministic', consultations: rows.length });
    } catch (e) { serverError(res, e); }
  });

  return router;
}
