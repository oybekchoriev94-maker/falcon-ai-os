// ============================================================
// FALCON AI OS — Bemor Telegram bot webhook (Bosqich R)
//
// XAVFSIZLIK QATLAMLARI:
//  1) Webhook secret (X-Telegram-Bot-Api-Secret-Token) — Telegram
//     dashboard'da sozlangan secret bilan solishtiriladi.
//  2) Rate limit — har telegram_id soatiga 60 xabar.
//  3) Bemor identifikatsiya: telegram_id -> patients.telegram_id JOIN.
//     Bemor ro'yxatdan o'tmagan bo'lsa — cheklangan javob.
//  4) Emergency detection — LLM'siz darrov 112 javobi.
//  5) Chatbot javobi patient_id + tenant_id bilan yoziladi (audit).
//  6) PII protection — bemor F.I.O LLM ga o'tmaydi (agent handler ichida
//     ochilgan patient_context bo'lsa ham, faqat isim + yosh + allergiya).
// ============================================================
import { Router } from 'express';
import crypto from 'node:crypto';
// Chatbot agenti orkestrator orqali chaqiriladi (executeAgent) —
// validatsiya, timeout, AI hisobi va audit uchun.

const TG_API = 'https://api.telegram.org';

async function tgSendMessage(token, chatId, text, opts = {}) {
  const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...opts,
    }),
  });
  return res.ok;
}

// Rate limiter (in-memory, per telegram_id per hour)
const rateBuckets = new Map();
function checkRate(tgId, limitPerHour = 60) {
  const now = Date.now();
  const b = rateBuckets.get(tgId) || { count: 0, resetAt: now + 3600_000 };
  if (now > b.resetAt) { b.count = 0; b.resetAt = now + 3600_000; }
  b.count += 1;
  rateBuckets.set(tgId, b);
  return b.count <= limitPerHour;
}

export default function patientBotRoutes(pool) {
  const router = Router();

  // POST /api/patient-bot/webhook
  // Telegram Bot API webhook. Secret solishtiriladi.
  router.post('/webhook', async (req, res) => {
    // 1) Secret tekshirish — FAIL-CLOSED.
    //
    // Ilgari shart `if (expected && provided !== expected)` edi: sozlama
    // bo'lmasa tekshiruv BUTUNLAY o'tkazib yuborilardi va istalgan kishi
    // soxta Telegram xabarlarini yuborib, bemor nomidan ish qila olardi.
    // Sozlamani unutish oson, va uni unutganda tizim JIM ravishda
    // himoyasiz qolardi — eng xavfli turdagi nosozlik.
    //
    // Endi sozlama yo'q bo'lsa so'rov RAD ETILADI. Uni o'rnatish uchun:
    //   1) .env ga TELEGRAM_PATIENT_WEBHOOK_SECRET=<tasodifiy satr>
    //   2) Telegram'ga aytish: setWebhook?secret_token=<o'sha satr>
    const expected = process.env.TELEGRAM_PATIENT_WEBHOOK_SECRET || '';
    if (!expected) {
      console.error(
        '[BOT] TELEGRAM_PATIENT_WEBHOOK_SECRET sozlanmagan — webhook rad etildi. ' +
        'Soxta xabarlarni oldini olish uchun uni .env ga qo\'shing va ' +
        'Telegram setWebhook da secret_token sifatida bering.'
      );
      return res.status(503).json({ ok: false, error: 'Webhook not configured' });
    }

    // Vaqt bo'yicha hujumga qarshi: oddiy `!==` solishtiruvi belgi-belgi
    // to'xtaydi va javob vaqti orqali secretni bit-bit topish mumkin.
    const provided = String(req.headers['x-telegram-bot-api-secret-token'] || '');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ ok: false, error: 'Invalid secret' });
    }

    const update = req.body || {};
    const msg = update.message;
    if (!msg || !msg.chat) return res.json({ ok: true });

    const chatId = String(msg.chat.id);
    const telegramId = String(msg.from?.id || chatId);
    const text = String(msg.text || msg.caption || '').trim();

    // 2) Rate limit
    if (!checkRate(telegramId, 60)) {
      return res.json({ ok: true });   // 200 qaytaramiz — Telegram qayta yubormasin
    }

    // Har xabarni javob yubormaslik uchun oldindan 200 qaytaramiz
    // (Telegram 15s ichida javob kutadi)
    res.json({ ok: true });

    // Async: bemorni topamiz + chatbot chaqiramiz + javob yuboramiz
    (async () => {
      const token = process.env.TELEGRAM_TOKEN_PATIENT || '';
      if (!token) return;

      try {
        // 3) Bemorni topamiz (telegram_id -> patients)
        const { rows } = await pool.query(
          `SELECT p.id AS patient_id, p.tenant_id, p.first_name, p.last_name,
                  p.birth_date, p.gender, p.allergies,
                  t.name AS clinic_name
           FROM patients p
           LEFT JOIN tenants t ON t.id = p.tenant_id
           WHERE p.telegram_id = $1
           LIMIT 1`,
          [telegramId]
        );
        const patient = rows[0];
        const tenantId = patient?.tenant_id || null;

        // 4) /start yoki /help komandalari
        if (text === '/start' || text === '/help') {
          const greeting = patient
            ? `Salom, *${patient.first_name || 'bemor'}*!\n\n` +
              `Men *${patient.clinic_name || 'klinika'}* AI yordamchisiman. ` +
              `Sizga qanday yordam bera olaman?\n\n` +
              `📞 Shikoyatingizni yozing yoki savol bering.\n\n` +
              `_Eslatma: men tashxis qo'ymayman va dori yozmayman — faqat ma'lumot beraman._`
            : `Salom! Siz hali klinikada ro'yxatdan o'tmagansiz.\n\n` +
              `Iltimos, klinikaga bir marta bo'lsa ham keling — biz sizga karta ochamiz. ` +
              `Shundan so'ng bu botdan to'liq foydalanishingiz mumkin.`;
          await tgSendMessage(token, chatId, greeting);
          return;
        }

        if (!text) return;   // Faqat matn (yoki caption) — rasm/audio hozircha keyingi bosqichda

        // 5) Suhbat tarixi (oxirgi 6 xabar)
        const { rows: history } = await pool.query(
          `SELECT role, content FROM chatbot_conversations
           WHERE telegram_id = $1
           ORDER BY created_at DESC LIMIT 6`,
          [telegramId]
        );
        const historyArr = history.reverse().map((r) => ({ role: r.role, content: r.content }));

        // 6) User xabarni yozib qo'yamiz (audit)
        await pool.query(
          `INSERT INTO chatbot_conversations (tenant_id, patient_id, telegram_id, role, content)
           VALUES ($1, $2, $3, 'user', $4)`,
          [tenantId, patient?.patient_id || null, telegramId, text.slice(0, 4000)]
        );

        // 7) Chatbot agentini chaqiramiz
        const age = patient?.birth_date
          ? Math.floor((Date.now() - new Date(patient.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
          : null;

        // Orkestrator orqali — LLM chaqiruvi, audit va hisob kerak.
        // Bemor bilan bevosita gaplashadigan agent, shuning uchun
        // uning har ishga tushishi qayd etilishi ayniqsa muhim.
        const { executeAgent } = await import('../../ai/orchestrator.js');
        const run = await executeAgent('patient-chatbot', {
          message: text,
          history: historyArr,
          patient_context: patient ? {
            first_name: patient.first_name,
            age,
            known_allergies: patient.allergies,
          } : undefined,
          clinic_name: patient?.clinic_name,
        }, { tenantId });
        const result = run.success ? run.data : { reply: null, error: run.error };

        // 8) Bot javobini yozib qo'yamiz
        await pool.query(
          `INSERT INTO chatbot_conversations (tenant_id, patient_id, telegram_id, role, content, intent, urgency)
           VALUES ($1, $2, $3, 'assistant', $4, $5, $6)`,
          [tenantId, patient?.patient_id || null, telegramId,
           result.reply.slice(0, 4000), result.intent || null, result.urgency || null]
        );

        // 9) Bemorga javob yuboramiz
        await tgSendMessage(token, chatId, result.reply);

        // 10) Kritik holat — klinika xodimlariga ai_alerts orqali xabar
        if (result.should_notify_staff && tenantId && patient?.patient_id) {
          try {
            const { v4: uuidv4 } = await import('uuid');
            await pool.query(
              `INSERT INTO ai_alerts
                 (id, tenant_id, patient_id, source_kind, source_id,
                  agent_name, severity, title, details, data_json)
               VALUES ($1, $2, $3, 'chatbot', $4, 'patient-chatbot', 'critical',
                       'Bemor botdа shoshilinch simptom aytdi', $5, $6::jsonb)`,
              [uuidv4(), tenantId, patient.patient_id, telegramId,
               `Bemor xabari: "${text.slice(0, 300)}"`,
               JSON.stringify({ telegram_id: telegramId, urgency: result.urgency })]
            );
          } catch (_) { /* alert failsa asosiy oqim buzilmasin */ }
        }
      } catch (e) {
        console.error('[PATIENT_BOT]', e.message);
      }
    })();
  });

  return router;
}
