import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { MEDICAL_SKILLS, listSpecializations, resolveSpecialization } from '../../ai/protocols/medical-skills.js';
import { SUPPORTED_LANGUAGES } from '../../ai/engines/stt.js';

// Whisper sonlarni so'z bilan chiqaradi ("qirq besh"). LLM ajratishda raqamga o'giramiz.
const NUMBER_RULE =
  "\nMUHIM: barcha sonlarni RAQAMLARDA yozing, so'z bilan emas. " +
  "Masalan: \"qirq besh\" -> 45, \"o'ttiz yetti nuqta besh\" -> 37.5, \"yuz yigirma\" -> 120, " +
  "\"to'qson\" -> 90, \"besh yuz ming\" -> 500000. Yosh, harorat, bosim, puls, doza, " +
  "telefon raqami, miqdor, narx — hammasi raqamda bo'lsin.";

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
      let text;
      let sttLanguage = null;
      if (req.file) {
        const stt = await transcribe(req.file.buffer, req.file.originalname || 'audio.webm', { language: req.body?.language });
        if (stt.error) {
          // Til siyosati buzilgan bo'lsa — 400 (mijoz xatosi), aks holda 500
          return res.status(stt.code === 'UNSUPPORTED_LANGUAGE' ? 400 : 500).json({ success: false, error: stt.error, code: stt.code });
        }
        text = stt.text;
        sttLanguage = stt.language || null;
      } else if (req.body?.raw_text) {
        text = req.body.raw_text;
      } else {
        return res.status(400).json({ success: false, error: 'Audio fayl yoki diktant matni talab qilinadi' });
      }
      // Mutaxassislik: so'rovda tanlangani ustun, aks holda shifokor profilidagi qiymat.
      // /upload bilan bir xil qoida — UI qaysi endpointga yuborsa ham shablon bir xil.
      const specialization =
        resolveSpecialization(req.body?.specialty) ||
        resolveSpecialization(req.user?.specialization) ||
        null;
      const basePrompt = specialization
        ? MEDICAL_SKILLS[specialization].systemPrompt
        : 'Siz shifokor yordamchisisiz. Ovozli matndan: bemor ismi, tashxis, muolaja nomi, ' +
          'buyurilgan dorilarni ajratib, faqat JSON qaytaring: ' +
          '{"patient_name":"...","diagnosis":"...","procedure":"...","medicines":"..."}';
      const result = await llm(
        basePrompt +
        "\n\nDiktant o'zbek yoki rus tilida bo'lishi mumkin — ikkalasini ham tushunasiz va JSON kalitlarini o'zgartirmasdan to'ldirasiz." +
        NUMBER_RULE +
        // procedure maydoni ombor sarfini avtomatik hisoblash uchun kerak —
        // yo'nalish shablonida bo'lmasa ham qo'shimcha kalit sifatida so'raymiz.
        "\nAgar diktantda biror muolaja/protsedura nomi aytilsa, JSONga qo'shimcha \"procedure\" kalitini ham qo'shing.",
        text
      );
      const consId = uuidv4();
      await q("INSERT INTO patient_consultations (id, tenant_id, doctor_id, patient_name, raw_text, data_json) VALUES ($1, $2, $3, $4, $5, $6)",
        [consId, tenantId, req.body?.doctor_id || req.user?.id || null, result.patient_name || "Noma'lum", text, JSON.stringify(result)]);
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
      res.json({ success: true, transcription: text, language: sttLanguage, data: result, consultation_id: consId, auto_consumption: consumption });
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
      if (req.file) {
        const stt = await transcribe(req.file.buffer, req.file.originalname || 'audio.webm', { language: req.body?.language });
        if (stt.error) {
          // Til siyosati buzilgan bo'lsa — 400 (mijoz xatosi), aks holda 500
          return res.status(stt.code === 'UNSUPPORTED_LANGUAGE' ? 400 : 500).json({ success: false, error: stt.error, code: stt.code });
        }
        text = stt.text;
        sttLanguage = stt.language || null;
      } else {
        text = String(req.body.raw_text).trim();
      }
      if (!text) return res.status(400).json({ success: false, error: 'Diktant matni bo\'sh' });
      // Diktant ruscha bo'lishi mumkin — LLM ikkala tilni ham tushunishi kerak
      const result = await llm(prompt + "\n\nDiktant o'zbek yoki rus tilida bo'lishi mumkin — ikkalasini ham tushunasiz va JSON kalitlarini o'zgartirmasdan to'ldirasiz." + NUMBER_RULE, text);
      const consId = uuidv4();
      await q("INSERT INTO patient_consultations (id, tenant_id, doctor_id, patient_name, raw_text, data_json) VALUES ($1, $2, $3, $4, $5, $6)",
        [consId, tenantId, req.user?.id || null, result.patient_name || "Noma'lum", text, JSON.stringify(result)]);
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
      res.json({ success: true, transcription: text, language: sttLanguage || null, data: result, consultation_id: consId, specialization, report_id: reportId, pdf_url: pdfUrl, telegram_notified: !!telegramId });
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
      const tenantId = req.user?.tenant_id || req.tenant_id;
      let consultations;
      if (req.user.role === 'doctor') {
        consultations = await q("SELECT * FROM patient_consultations WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY created_at DESC LIMIT $3", [tenantId, req.user.id, limit]);
      } else {
        consultations = await q("SELECT * FROM patient_consultations WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2", [tenantId, limit]);
      }
      res.json({ success: true, total: consultations.length, consultations });
    } catch (e) { serverError(res, e); }
  });

  return router;
}
