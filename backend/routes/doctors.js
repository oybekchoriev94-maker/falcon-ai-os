// ============================================================
// FALCON AI OS — Doctor Management Routes
// Shifokorlarni boshqarish, ro'yxatga olish, kampaniya
// sozlamalari va reception endpointlari
// ============================================================

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { safeError } from '../services/safe-error.js';
import { optionalAuth } from '../shared.js';
import { SURXONDARYO_DISTRICTS } from '../constants/regions.js';
import { llm, transcribe } from '../../ai/orchestrator.js';
// PR #15: shifokorlar soni tarif rejasi bilan cheklanadi
import { checkSubscription, checkDoctorLimit } from '../subscription-middleware.js';

export default function doctorRoutes(pool, authMiddleware, checkRole, validate, schemas, telegramOrJwtAuth, upload) {
  const router = Router();
  router.use(authMiddleware);

  async function q(sql, params = []) {
    const result = await pool.query(sql, params);
    if (/^SELECT/i.test(sql.trim())) return result.rows;
    return result;
  }
  async function qGet(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] || null;
  }

  // ============================================================
  // DOCTORS ENDPOINTS
  // ============================================================

  // GET /api/doctors/specializations — mavjud yo'nalishlar ro'yxati.
  //
  // MANBA: ai/protocols/medical-skills.js — ovozli diktant shablonlari
  // aynan shu kalitlar bo'yicha tanlanadi. Ilgari /onboarding sahifasida
  // ro'yxat QO'LDA yozilgan edi va u shablonlardan orqada qolgan:
  // "reproduktolog" (klinikaning eng katta yo'nalishi, 7 shifokor)
  // ro'yxatda yo'q edi, ya'ni yangi shifokorni to'g'ri yo'nalish bilan
  // qo'shib bo'lmasdi. Endi bitta manba.
  //
  // /api/scribe/specialties ham shu ma'lumotni beradi, lekin u AI
  // limitlari ostida (checkAiLimit) — oddiy ro'yxat uchun kvota
  // sarflash noto'g'ri bo'lardi.
  router.get('/doctors/specializations', authMiddleware, async (req, res) => {
    try {
      const { listSpecializations } = await import('../../ai/protocols/medical-skills.js');
      // Faqat kalit va yorliq — prompt va sxema mijozga kerak emas
      res.json({
        success: true,
        specializations: listSpecializations().map(({ key, label }) => ({ key, label })),
      });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/doctors/:id/credentials — MAVJUD shifokorga tizimga kirish
  // huquqini berish (yoki parolini almashtirish).
  //
  // NEGA KERAK: shifokorlar `users` emas, `doctors` jadvali orqali kiradi
  // va buning uchun username + password_hash shart. Migratsiya bilan
  // qo'shilgan shifokorlarda ular bo'sh — bronlarda ko'rinadi, lekin ish
  // stoliga kira olmaydi.
  //
  // NEGA register-doctor YARAMAYDI: u YANGI yozuv yaratadi. Mavjud
  // shifokor uchun ishlatilsa dublikat paydo bo'ladi va yangi yozuvda
  // bronlar bo'lmagani uchun shifokor BO'SH navbat ko'radi — buni
  // sezish qiyin, chunki xato chiqmaydi.
  router.post('/doctors/:id/credentials',
    authMiddleware, checkRole('admin', 'ceo', 'superadmin'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const username = String(req.body?.username || '').trim().toLowerCase();
      const password = String(req.body?.password || '');

      if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
        return res.status(400).json({
          success: false,
          error: 'Username 3-50 belgi: kichik lotin harflari, raqam, nuqta, tire',
        });
      }
      if (password.length < 6) {
        return res.status(400).json({ success: false, error: 'Parol kamida 6 belgi bo\'lishi kerak' });
      }

      // TENANT TEKSHIRUVI MAJBURIY: aks holda bir klinika administratori
      // boshqa klinikaning shifokoriga parol qo'yib, uning ma'lumotlariga
      // kira olardi.
      const doc = await qGet(
        'SELECT id, first_name, last_name, specialization FROM doctors WHERE id = $1 AND tenant_id = $2',
        [req.params.id, tenantId]
      );
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });

      // username butun tizim bo'ylab unique (jadvalda ham) — oldindan
      // aniq xato beramiz, 23505 xatosini kutmasdan
      const taken = await qGet('SELECT id FROM doctors WHERE username = $1 AND id <> $2',
        [username, doc.id]);
      if (taken) {
        return res.status(409).json({ success: false, error: 'Bu username band' });
      }

      await q('UPDATE doctors SET username = $1, password_hash = $2 WHERE id = $3 AND tenant_id = $4',
        [username, await bcrypt.hash(password, 10), doc.id, tenantId]);

      // Parol javobda QAYTARILMAYDI — uni administrator o'zi kiritdi.
      res.json({
        success: true,
        doctor: {
          id: doc.id, username,
          name: `${doc.last_name || ''} ${doc.first_name}`.trim(),
          specialization: doc.specialization,
        },
        message: 'Kirish huquqi berildi',
      });
    } catch (e) { safeError(res, e); }
  });

  // GET /api/doctors — shifokorlar ro'yxati (faqat xodimlar; tenant JWT dan)
  router.get('/doctors', optionalAuth, async (req, res) => {
    try {
      // x-tenant-id sarlavhasi tenant vakolati EMAS — uni mijoz
      // soxtalashtira oladi. Tenant faqat tekshirilgan JWT dan olinadi;
      // anonim so'rov rad etiladi (barcha haqiqiy chaqiruvchilar —
      // autentifikatsiyalangan dashboard sahifalari).
      const tenantId = req.user?.tenant_id;
      if (!tenantId) return res.status(401).json({ error: 'Autentifikatsiya talab qilinadi' });
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
      const offset = (page - 1) * limit;
      const total = await qGet("SELECT COUNT(*) as c FROM doctors WHERE tenant_id = $1", [tenantId]);

      // XAVFSIZLIK: ilgari bu yerda `SELECT *` turardi va endpoint
      // `optionalAuth` bilan ochiq — ya'ni x-tenant-id sarlavhasini
      // yuborgan istalgan kishi PAROL HASHLARI va FACE_DESCRIPTOR
      // (biometrik ma'lumot) ni yuklab olardi.
      //
      // Endi ustunlar aniq sanaladi va ikki darajaga bo'linadi:
      // bemorga ko'rinadigan minimum, xodimga esa ish uchun keraklisi.
      // Parol hashi va biometrika HECH QACHON qaytarilmaydi.
      const isStaff = ['admin', 'ceo', 'superadmin', 'receptionist', 'doctor']
        .includes(req.user?.role);

      const cols = isStaff
        ? `id, first_name, last_name, specialty, specialization, category, phone,
           status, reception_price, referrer_bonus_percent, balance, created_at,
           username, (password_hash IS NOT NULL) AS has_login`
        : `id, first_name, last_name, specialty, specialization, status`;

      const docs = await q(
        `SELECT ${cols} FROM doctors WHERE tenant_id = $1
          ORDER BY first_name LIMIT $2 OFFSET $3`,
        [tenantId, limit, offset]
      );
      res.json({ success: true, total: total.c, page, limit, total_pages: Math.ceil(total.c / limit), doctors: docs });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/auth/register-doctor — admin yangi shifokor qo'shishi
  // Klinika rahbari (ceo) ham shifokor qo'sha olishi kerak — yangi klinika
  // ro'yxatdan o'tganda birinchi hisob aynan 'ceo' bo'ladi.
  router.post('/auth/register-doctor', authMiddleware, checkRole('admin', 'ceo', 'superadmin'), checkSubscription, checkDoctorLimit, validate(schemas.registerDoctor), async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const { name, username, password, specialization } = req.body;
      const existing = await qGet("SELECT id FROM doctors WHERE username = $1", [username]);
      if (existing) return res.status(409).json({ success: false, error: 'Bu username allaqachon mavjud' });
      const id = uuidv4();
      const hash = await bcrypt.hash(password, 10);
      const nameParts = name.trim().split(/\s+/);
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(' ') || '';
      await q(
        "INSERT INTO doctors (id, tenant_id, first_name, last_name, specialty, username, password_hash, specialization, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Faol')",
        [id, tenantId, firstName, lastName, name, username, hash, specialization]
      );
      res.status(201).json({
        success: true,
        doctor: {
          id, first_name: firstName, last_name: lastName,
          username, specialization, specialty: name, status: 'Faol'
        }
      });
    } catch (e) { safeError(res, e); }
  });

  // ── Shifokor ish jadvali ──────────────────────────────────────────────
  // Busiz /api/booking/slots hech qachon bo'sh vaqt qaytarmaydi ("jadval yo'q").
  // day_of_week: PostgreSQL/JS konventsiyasi — 0=Yakshanba .. 6=Shanba
  // (booking.js computeSlots getUTCDay() bilan bir xil).

  router.get('/doctors/:id/schedule', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const rows = await q(
        'SELECT day_of_week, start_time, end_time, slot_duration FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY day_of_week',
        [tenantId, req.params.id]
      );
      res.json({ success: true, schedule: rows });
    } catch (e) { safeError(res, e); }
  });

  // PUT — haftalik jadvalni to'liq almashtiradi (eski yozuvlar o'chadi)
  router.put('/doctors/:id/schedule', authMiddleware, checkRole('admin', 'ceo', 'superadmin'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const doctorId = req.params.id;
      const { days, start_time, end_time, slot_duration } = req.body || {};

      if (!Array.isArray(days) || days.length === 0) {
        return res.status(400).json({ success: false, error: 'Kamida bitta ish kuni tanlanishi kerak' });
      }
      const uniqDays = [...new Set(days.map(Number))];
      if (uniqDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        return res.status(400).json({ success: false, error: 'Kun 0 (Yakshanba) dan 6 (Shanba) gacha bo\'lishi kerak' });
      }
      const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!timeRe.test(String(start_time)) || !timeRe.test(String(end_time))) {
        return res.status(400).json({ success: false, error: 'Vaqt HH:MM formatida bo\'lishi kerak' });
      }
      const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      if (toMin(end_time) <= toMin(start_time)) {
        return res.status(400).json({ success: false, error: 'Tugash vaqti boshlanishdan keyin bo\'lishi kerak' });
      }
      const slot = Number(slot_duration) || 30;
      if (slot < 5 || slot > 240) {
        return res.status(400).json({ success: false, error: 'Qabul davomiyligi 5-240 daqiqa oralig\'ida' });
      }

      const doctor = await qGet('SELECT id FROM doctors WHERE tenant_id = $1 AND id = $2', [tenantId, doctorId]);
      if (!doctor) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });

      await q('DELETE FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2', [tenantId, doctorId]);
      for (const d of uniqDays) {
        await q(
          'INSERT INTO doctor_schedules (tenant_id, doctor_id, day_of_week, start_time, end_time, slot_duration) VALUES ($1,$2,$3,$4,$5,$6)',
          [tenantId, doctorId, d, start_time, end_time, slot]
        );
      }
      res.json({ success: true, days: uniqDays.sort(), start_time, end_time, slot_duration: slot });
    } catch (e) { safeError(res, e); }
  });

  // GET /api/doctors/manage — admin uchun shifokorlar ro'yxati (login ma'lumotlari bilan)
  router.get('/doctors/manage', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const docs = await q("SELECT id, first_name, last_name, specialty, username, specialization, status, balance, referrer_bonus_percent, created_at FROM doctors WHERE tenant_id = $1 ORDER BY created_at DESC", [tenantId]);
      res.json({ success: true, total: docs.length, doctors: docs });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/doctors/toggle-status — admin shifokor faolligini o'zgartirishi
  router.post('/doctors/toggle-status', authMiddleware, checkRole('admin'), validate(schemas.doctorToggleStatus), async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const { doctor_id } = req.body;
      const doc = await qGet("SELECT id, status FROM doctors WHERE id = $1 AND tenant_id = $2", [doctor_id, tenantId]);
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const newStatus = doc.status === 'Faol' ? 'Bloklangan' : 'Faol';
      await q("UPDATE doctors SET status = $1 WHERE id = $2 AND tenant_id = $3", [newStatus, doctor_id, tenantId]);
      res.json({ success: true, doctor_id, previous_status: doc.status, new_status: newStatus });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/doctors/update-bonus-percent — admin shifokorning referral bonus foizini o'zgartirishi
  router.post('/doctors/update-bonus-percent', authMiddleware, checkRole('admin'), validate(schemas.doctorUpdateBonusPercent), async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const { doctor_id, referrer_bonus_percent } = req.body;
      const percent = Math.max(0, Math.min(100, parseFloat(referrer_bonus_percent)));
      const doc = await qGet("SELECT id, first_name, last_name, referrer_bonus_percent FROM doctors WHERE id = $1 AND tenant_id = $2", [doctor_id, tenantId]);
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const previous = doc.referrer_bonus_percent || 10.0;
      await q("UPDATE doctors SET referrer_bonus_percent = $1 WHERE id = $2 AND tenant_id = $3", [percent, doctor_id, tenantId]);
      res.json({ success: true, doctor_id, doctor_name: `${doc.first_name} ${doc.last_name || ''}`.trim(), previous_percent: previous, new_percent: percent });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/doctors/topup-balance — admin shifokor balansini to'ldirishi
  router.post('/doctors/topup-balance', authMiddleware, checkRole('admin'), validate(schemas.doctorTopupBalance), async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const { doctor_id, amount } = req.body;
      const amt = Math.round(parseFloat(amount) * 100) / 100;
      const doc = await qGet("SELECT id, first_name, last_name, balance FROM doctors WHERE id = $1 AND tenant_id = $2", [doctor_id, tenantId]);
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const oldBalance = doc.balance || 0;
      const newBalance = oldBalance + amt;
      await q("UPDATE doctors SET balance = $1 WHERE id = $2 AND tenant_id = $3", [newBalance, doctor_id, tenantId]);
      await q(`INSERT INTO platform_ledger (tenant_id, doctor_id, total_amount, platform_fee_percent, platform_amount, referrer_bonus_percent, referrer_amount, clinic_amount, remaining_balance, status) VALUES ($1, $2, $3, 0, 0, 0, 0, $4, $5, 'topup')`,
        [tenantId, doctor_id, amt, amt, newBalance]);
      res.json({ success: true, doctor_id, doctor_name: `${doc.first_name} ${doc.last_name || ''}`.trim(), previous_balance: oldBalance, new_balance: newBalance, topped_up: amt });
    } catch (e) { safeError(res, e); }
  });

  // GET /api/doctors/balance — joriy shifokorning balansini qaytarish (dashboard/doctor uchun)
  router.get('/doctors/balance', authMiddleware, async (req, res) => {
    try {
      const doc = await qGet(
        "SELECT id, first_name, last_name, balance FROM doctors WHERE tenant_id = $1 AND id = $2",
        [req.user.tenant_id, req.user.id]
      );
      if (!doc) return res.json({ success: true, balance: 0, message: 'Doctor topilmadi, 0 qaytarildi' });
      res.json({ success: true, doctor_id: doc.id, doctor_name: `${doc.first_name} ${doc.last_name || ''}`.trim(), balance: doc.balance || 0 });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // DOCTOR SELF-SERVICE ENDPOINTS (o'z ma'lumotlari)
  // ============================================================

  // GET /api/doctor/my-patients — shifokorning o'z patientlari va qabullari
  router.get('/doctor/my-patients', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const patients = await q("SELECT * FROM patient_consultations WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY created_at DESC LIMIT 50", [tenantId, req.user.id]);
      const appointments = await q("SELECT * FROM appointments WHERE tenant_id = $1 AND doctor_name = $2 ORDER BY created_at DESC LIMIT 20", [tenantId, req.user.name]);
      res.json({ success: true, patients: patients.length, consultations: patients, appointments });
    } catch (e) { safeError(res, e); }
  });

  // GET /api/doctor/my-stats — shifokorning statistikasi
  router.get('/doctor/my-stats', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const stats = await q("SELECT * FROM doctor_analytics WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY period_start DESC LIMIT 1", [tenantId, req.user.id]);
      const recent = await qGet("SELECT COUNT(*) as c FROM patient_consultations WHERE tenant_id = $1 AND doctor_id = $2 AND DATE(created_at) = CURRENT_DATE", [tenantId, req.user.id]);
      res.json({ success: true, stats: stats || { patients_count: 0, total_revenue: 0 }, today_patients: recent ? recent.c : 0 });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // PATIENT CAMPAIGN SETTINGS (Admin panel)
  // ============================================================

  // GET /api/campaign/settings — joriy kampaniya sozlamalarini olish (tenant bo'yicha)
  router.get('/campaign/settings', optionalAuth, async (req, res) => {
    try {
      // JWT ustun. Anonim so'rov (mini-app bemor sahifasi) bitta klinikali
      // rejimda bemor boti tenantiga tushadi. x-tenant-id sarlavhasiga ENDI
      // ishonch yo'q — tenant-context.js uni qabul qilmaydi.
      const tenantId = req.user?.tenant_id || process.env.TMA_TENANT_ID || 'default';
      const mode = await qGet("SELECT value FROM clinic_settings WHERE tenant_id = $1 AND key = 'patient_campaign_mode'", [tenantId]);
      const pct = await qGet("SELECT value FROM clinic_settings WHERE tenant_id = $1 AND key = 'patient_referral_percent'", [tenantId]);
      res.json({
        success: true,
        campaign_mode: mode ? mode.value : 'always',
        referral_percent: pct ? parseFloat(pct.value) : 3.0,
        platform_fee_percent: 3.0
      });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/campaign/settings — kampaniya rejimini o'zgartirish (faqat admin/ceo)
  router.post('/campaign/settings', authMiddleware, checkRole('admin', 'ceo'), validate(schemas.campaignSettings), async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const { campaign_mode } = req.body;
      await q(
        "INSERT INTO clinic_settings (tenant_id, key, value, updated_at) VALUES ($1, 'patient_campaign_mode', $2, NOW()) ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
        [tenantId, campaign_mode]
      );
      res.json({ success: true, message: 'Kampaniya rejimi yangilandi', campaign_mode });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // RECEPTION ENDPOINTS
  // ============================================================

  // GET /api/reception/voice-register — ovozli ro'yxatdan o'tkazish (faqat POST)
  router.get('/reception/voice-register', authMiddleware, checkRole('receptionist', 'admin', 'doctor', 'ceo'), (req, res) => {
    res.status(405).json({ error: 'POST method ishlatilsin' });
  });

  // POST /api/reception/voice-register — ovozli ro'yxatdan o'tkazish
  router.post('/reception/voice-register', authMiddleware, checkRole('receptionist', 'admin', 'doctor', 'ceo'), upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Audio fayl majburiy' });

      const tenantIdEarly = req.user?.tenant_id || req.tenant_id || 'default';
      const { saveRecording, markTranscribed, markFailed } =
        await import('../services/voice-store.js');
      // AVVAL DISKKA — registrator bemor yonida gapiradi, xato bo'lsa
      // bemorni ikkinchi marta so'roqqa tutish kerak bo'lardi.
      const rec = await saveRecording(pool, {
        tenantId: tenantIdEarly, userId: req.user?.id, source: 'reception_register',
        refId: null, patientId: null,
        buffer: req.file.buffer, mime: req.file.mimetype,
        originalName: req.file.originalname, language: req.body?.language,
      });

      const { text, error, code } = await transcribe(req.file.buffer, req.file.originalname || 'audio.webm', { language: req.body?.language });
      // Til siyosati buzilgan bo'lsa — 400 (mijoz xatosi), aks holda 500
      if (error) {
        await markFailed(pool, rec?.id, error);
        return res.status(code === 'UNSUPPORTED_LANGUAGE' ? 400 : 500)
          .json({ success: false, error, code, recording_saved: !!rec });
      }
      if (!text || !text.trim()) {
        await markFailed(pool, rec?.id, 'EMPTY_TRANSCRIPT');
        return res.status(400).json({
          success: false, error: 'Ovoz tushunarli emas, qaytadan urinib ko\'ring',
          recording_saved: !!rec,
        });
      }
      await markTranscribed(pool, rec?.id, text);
      // Imlo tuzatish faqat o'zbekcha diktant uchun — ruscha matnni buzmasligi kerak
      const isRu = String(req.body?.language || '').toLowerCase().startsWith('ru');
      let cleaned = text;
      if (!isRu) {
        const fixed = await llm(
          `Quyidagi matnni o'zbek lotin alifbosiga to'g'rilang (faqat matn qaytaring, izohsiz):
        • ö,õ→o'  ü→u'  ğ,ģ→g'  ş→sh  ç→ch  ý→y  ı→i  â→a  ê→e  î→i
        • Turkcha so'zlarni o'zbekchasiga almashtiring`,
          text,
          { temperature: 0.0 }
        );
        // DIQQAT: llm() BO'SH satr qaytarishi mumkin (model bo'sh javob
        // berdi, kvota tugadi, javob JSON deb noto'g'ri talqin qilindi).
        // Ilgari shu bo'sh satr `cleaned` ga o'tib ketardi va DIKTANT
        // BUTUNLAY YO'QOLARDI: transkripsiya bo'sh, ajratish bo'sh matn
        // ustida ishlaydi, natijada hech nima to'lmaydi — lekin so'rov
        // "muvaffaqiyatli" hisoblanib, registratura "Ma'lumot to'ldirildi"
        // degan xabarni ko'rardi. Aynan shu production'da sodir bo'ldi.
        //
        // Imlo tuzatish — YAXSHILASH, majburiy qadam emas. Ishonchsiz
        // bo'lsa asl STT matnini saqlaymiz: imlosi biroz noto'g'ri matn
        // yo'q matndan ko'ra ancha foydali.
        const f = typeof fixed === 'string' ? fixed.trim() : '';
        // Uzunlik keskin qisqargan bo'lsa — model matnni tuzatmay, kesib
        // yuborgan yoki javob berishdan bosh tortgan. Bunday natijaga
        // ishonmaymiz.
        if (f && f.length >= text.trim().length * 0.5) cleaned = f;
        else if (f) console.warn('[VOICE-REG] LLM tuzatishi shubhali (qisqarib ketdi) — asl matn saqlandi');
        else console.warn('[VOICE-REG] LLM bo\'sh qaytardi — asl matn saqlandi');
      }
      // Klinikaning HAQIQIY ro'yxatlari — LLM taxmin qilmasin, shulardan tanlasin
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const [docs, svcs] = await Promise.all([
        q("SELECT id, first_name, last_name, specialty, specialization FROM doctors WHERE tenant_id = $1 AND (status IS NULL OR status = 'Faol') ORDER BY first_name", [tenantId]),
        q("SELECT id, name, category FROM services_catalog WHERE tenant_id = $1 AND active = TRUE ORDER BY category NULLS LAST, name", [tenantId]),
      ]);
      const docLines = docs.map((d, i) =>
        `${i + 1}. ${d.first_name} ${d.last_name || ''}${d.specialty ? ' — ' + d.specialty : ''}`.trim()).join('\n');
      const svcLines = svcs.map((s, i) => `${i + 1}. ${s.name}`).join('\n');

      const raw = await llm(
        `Siz klinika qabulxonasi yordamchisisiz. Bemor haqidagi gapdan ma'lumot ajratib, FAQAT JSON qaytaring.
Matn o'zbek yoki rus tilida bo'lishi mumkin — ikkalasini ham tushunasiz.

KLINIKA SHIFOKORLARI (faqat shu ro'yxatdan tanlang, raqamini yozing):
${docLines || '(yo\'q)'}

KLINIKA XIZMATLARI (faqat shu ro'yxatdan tanlang, raqamlarini yozing):
${svcLines || '(yo\'q)'}

SURXONDARYO TUMANLARI (faqat shulardan biri):
${SURXONDARYO_DISTRICTS.join(', ')}

JSON format:
{
  "patient_name": "bemor ismi familiyasi",
  "phone": "faqat 9 raqam, masalan 901234567",
  "district": "yuqoridagi tumanlardan biri yoki bo'sh",
  "mahalla": "mahalla/qishloq nomi yoki bo'sh",
  "doctor_index": shifokor raqami yoki null,
  "service_indexes": [xizmat raqamlari] yoki [],
  "preferred_time": "vaqt yoki bo'sh",
  "notes": "qo'shimcha yoki bo'sh"
}

QOIDALAR:
- Sonlarni RAQAMDA yozing, so'z bilan emas.
- TELEFON: 9 ta raqam. Odatda raqam-raqam aytiladi ("to'qqiz uch besh besh besh
  ikki bir nol to'qqiz" -> 935552109). Guruh bilan aytilsa ham o'giring
  ("to'qson uch" -> 93, "yigirma bir" -> 21, "nol to'qqiz" -> 09).
  Agar 9 ta raqam to'liq eshitilmasa — BOR RAQAMLARNIGINA yozing, yetmaganini
  O'YLAB TOPMANG (noto'g'ri raqam bo'sh maydondan yomonroq).
- Shifokor ismi aytilsa o'sha shifokorni, faqat yo'nalish aytilsa (masalan "UZI ga") o'sha yo'nalishdagi birinchi shifokorni tanlang.
- Bemor bir nechta xizmat aytishi mumkin — hammasini service_indexes ga qo'shing.
- Xizmat nomi to'liq aytilmasa ham ma'nosiga qarab mos keladiganini toping ("qorin UZI" -> "UZI Брюшная полость").
- Ishonchingiz komil bo'lmasa null yoki bo'sh qoldiring — TAXMIN QILMANG.`,
        cleaned,
        { temperature: 0.0 }
      );

      const transcript = cleaned;
      const r = (typeof raw === 'object' && raw !== null && !raw.error) ? raw : {};
      // AI ajratish ishlamagan bo'lsa buni YASHIRMAYMIZ. Ilgari bu holat
      // bo'sh `extraction` bilan "muvaffaqiyat" sifatida qaytardi va
      // registratura "Ovoz tahlil qilindi" degan xabarni ko'rib, aslida
      // hech nima to'lmaganini keyin sezardi. Endi frontend aniq ayta oladi.
      const aiFailed = !(typeof raw === 'object' && raw !== null && !raw.error);

      // Indekslarni haqiqiy yozuvlarga aylantiramiz (chegaradan chiqsa e'tiborsiz)
      const di = Number(r.doctor_index);
      const doctor = Number.isInteger(di) && di >= 1 && di <= docs.length ? docs[di - 1] : null;
      const svcIdx = Array.isArray(r.service_indexes) ? r.service_indexes : [];
      const pickedSvcs = [...new Set(svcIdx.map(Number))]
        .filter((i) => Number.isInteger(i) && i >= 1 && i <= svcs.length)
        .map((i) => svcs[i - 1]);
      const district = SURXONDARYO_DISTRICTS.includes(String(r.district || '').trim())
        ? String(r.district).trim() : '';

      const extraction = {
        patient_name: r.patient_name || '',
        phone: String(r.phone || '').replace(/\D/g, '').slice(-9),
        district,
        mahalla: String(r.mahalla || '').trim(),
        // Frontend to'g'ridan-to'g'ri qo'llashi uchun tayyor id lar
        doctor_id: doctor?.id || null,
        doctor_name: doctor ? `${doctor.first_name} ${doctor.last_name || ''}`.trim() : '',
        service_ids: pickedSvcs.map((s) => s.id),
        service_names: pickedSvcs.map((s) => s.name),
        // Eski maydonlar — orqaga moslik uchun saqlanadi
        doctor_specialty: doctor?.specialty || doctor?.specialization || '',
        preferred_time: r.preferred_time || '',
        notes: r.notes || '',
      };
      res.json({ success: true, transcript, extraction, ai_failed: aiFailed });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/reception/confirm — receptionist tomonidan qabulni tasdiqlash
  router.post('/reception/confirm', authMiddleware, checkRole('receptionist', 'admin', 'doctor', 'ceo'), validate(schemas.receptionConfirm), async (req, res) => {
    try {
      const { patient_name, phone, doctor_name, department, notes, appointment_time, status } = req.body;
      const tenantId = req.user.tenant_id;
      // Agar status berilgan bo'lsa, queue statusini yangilash
      if (status && req.body.id) {
        await q(
          "UPDATE patient_queue SET status = $1 WHERE id = $2 AND tenant_id = $3",
          [status, req.body.id, tenantId]
        );
        return res.json({ success: true, status });
      }
      const aptId = 'apt-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
      await q("INSERT INTO appointments (appointment_id, tenant_id, patient_name, phone, doctor_name, department, notes, source) VALUES ($1, $2, $3, $4, $5, $6, $7, 'reception')",
        [aptId, tenantId, patient_name, phone || '', doctor_name || '', department || 'therapy', notes || '']);
      // Queue — navbat raqami har bir klinika ichida alohida sanaladi.
      // patient_queue'da department/appointment_time ustunlari yo'q — ma'lumot notes'ga yoziladi.
      const queueNotes = [department, appointment_time, notes].filter(Boolean).join(' · ') || null;
      const maxQ = await qGet("SELECT COALESCE(MAX(queue_number),0) + 1 as n FROM patient_queue WHERE status='waiting' AND tenant_id = $1", [tenantId]);
      await q("INSERT INTO patient_queue (queue_number, patient_name, phone, doctor, notes, tenant_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [maxQ.n, patient_name, phone || '', doctor_name || '', queueNotes, tenantId]);
      // Doctor analytics — faqat shifokor nomi bo'yicha topilsa (analitika asosiy oqimni buzmasligi kerak)
      if (doctor_name) {
        try {
          const period = new Date().toISOString().slice(0, 10);
          const doc = await qGet(
            "SELECT id FROM doctors WHERE tenant_id = $1 AND (LOWER(first_name || ' ' || COALESCE(last_name,'')) LIKE LOWER($2) OR LOWER(COALESCE(specialty,'')) LIKE LOWER($2)) ORDER BY created_at LIMIT 1",
            [tenantId, `%${doctor_name}%`]
          );
          if (doc) {
            await q(
              `INSERT INTO doctor_analytics (tenant_id, doctor_id, doctor_name, patients_count, period_start, period_end) VALUES ($1, $2, $3, 1, $4, $5)
               ON CONFLICT (tenant_id, doctor_id, period_start) DO UPDATE SET patients_count = doctor_analytics.patients_count + 1`,
              [tenantId, doc.id, doctor_name, period, period]
            );
          }
        } catch (aErr) { /* analitika ixtiyoriy — xatosi qabulni bekor qilmasin */ }
      }
      res.json({ success: true, appointment: { appointment_id: aptId, patient_name, phone, doctor_name, queue: maxQ.n } });
    } catch (e) { safeError(res, e); }
  });

  // GET /voice/queues — navbatdagi bemorlar ro'yxati
  router.get('/voice/queues', authMiddleware, async (req, res) => {
    try {
      const queues = await q(
        `SELECT id, patient_name, doctor as doctor_name, department,
                status, appointment_time, notes, created_at,
                row_number() OVER (ORDER BY
                  CASE status
                    WHEN 'in_progress' THEN 0
                    WHEN 'waiting' THEN 1
                    WHEN 'completed' THEN 2
                    WHEN 'cancelled' THEN 3
                    ELSE 4
                  END, created_at ASC
                ) as queue_number
         FROM patient_queue
         WHERE tenant_id = $1
         ORDER BY
           CASE status
             WHEN 'in_progress' THEN 0
             WHEN 'waiting' THEN 1
             WHEN 'completed' THEN 2
             WHEN 'cancelled' THEN 3
             ELSE 4
           END, created_at ASC`,
        [req.user.tenant_id]
      );
      res.json({ success: true, queues });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
