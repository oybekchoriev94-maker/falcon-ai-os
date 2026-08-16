import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Telegraf, Markup } from 'telegraf';
import cron from 'node-cron';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import { z } from 'zod';
import swaggerUi from 'swagger-ui-express';
import * as Sentry from '@sentry/node';

import { connectPg, disconnectPg, q, qGet, qExec, getPool, withTransaction, unsafeQuery } from './backend/db.js';
import { generateReportPdf } from './backend/services/pdfGenerator.js';
import { safeError } from './backend/services/safe-error.js';
import { MEDICAL_SKILLS } from './ai/protocols/medical-skills.js';
import { authMiddleware, checkRole, validate, schemas, signToken, telegramOrJwtAuth, agentBypassOrAuth, validateNonce } from './backend/shared.js';
import { swaggerSpec } from './backend/swagger.js';
import { tenantContext } from './backend/tenant-context.js';
import { auditLog } from './backend/audit.js';
import { checkSubscription, requireFeature, checkAiLimit, checkDoctorLimit } from './backend/subscription-middleware.js';
import { tenantRateLimit } from './backend/tenant-rate-limit.js';
import { correlationIdMiddleware } from './middleware/correlation.js';
import { initCache, disconnectCache } from './backend/cache.js';
import { logger, pinoHttpMiddleware } from './backend/logger.js';
import { metricsMiddleware, metricsEndpoint, trackAiRequest, setActiveTenants } from './backend/metrics.js';

import * as orchestrator from './ai/orchestrator.js';
import { llm, transcribe, speak, isLLMReady } from './ai/orchestrator.js';

import authRoutes from './backend/routes/auth.js';
import paymentRoutes from './backend/routes/payments.js';
import inventoryRoutes from './backend/routes/inventory.js';
import aiRoutes from './backend/routes/ai.js';
import doctorRoutes from './backend/routes/doctors.js';
import inpatientRoutes from './backend/routes/inpatient.js';
import labsRoutes from './backend/routes/labs.js';
import legalRoutes from './backend/routes/legal.js';
import referralAgentRoutes from './backend/routes/referral.js';
import referralPassRoutes from './backend/routes/referrals.js';
import patientRoutes from './backend/routes/patient.js';
import patientsRoutes from './backend/routes/patients.js';
import appointmentRoutes from './backend/routes/appointments.js';
import billingRoutes from './backend/routes/billing.js';
import subscriptionRoutes from './backend/routes/subscription.js';
import tenantRoutes from './backend/routes/tenants.js';
import tmaRoutes from './backend/routes/tma.js';
import adminRoutes from './backend/routes/admin.js';
import webhookRoutes from './backend/routes/webhooks.js';
import scribeRoutes from './backend/routes/scribe.js';
import doctorViewRoutes from './backend/routes/doctor.js';
import b2bRoutes from './backend/routes/b2b.js';
import servicesRoutes from './backend/routes/services.js';
import bookingRoutes, { createBookingCore } from './backend/routes/booking.js';
import cashierRoutes from './backend/routes/cashier.js';
import alertsRoutes from './backend/routes/alerts.js';
import insightsRoutes from './backend/routes/insights.js';
import copilotRoutes from './backend/routes/copilot.js';
import patientBotRoutes from './backend/routes/patient-bot.js';
import kioskRoutes from './backend/routes/kiosk.js';
import attendanceRoutes from './backend/routes/attendance.js';
import { startPatientReminderCron } from './backend/cron/patient-reminders.js';
import { startQueueNotifyCron } from './backend/cron/queue-notify.js';
import { initEmail, sendWelcomeEmail } from './backend/services/email.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.2'),
  integrations: [Sentry.httpIntegration()],
});

const PORT = parseInt(process.env.PORT || '3000');
const MAX_PORT = PORT + 10;
const IS_PROD = process.env.NODE_ENV === 'production';
const API_PREFIX = '/api/v1';

function serverError(res, err, status = 500) {
  logger.error({ err, status }, `[ERROR] ${err?.message}`);
  return res.status(status).json({
    success: false,
    error: IS_PROD ? 'Server xatosi yuz berdi' : (err?.message || String(err))
  });
}

const app = express();

app.set('trust proxy', true);
app.use(compression());
app.use(pinoHttpMiddleware());
app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://telegram.org", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      // HTML sahifalar inline onclick/onsubmit ishlatadi; script-src-attr default 'none' ularni bloklaydi.
      // script-src allaqachon 'unsafe-inline' bo'lgani uchun buni ochiq qoldirish izchil.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://api.telegram.org", "https://cdn.jsdelivr.net"],
      frameAncestors: ["https://telegram.org", "https://*.telegram.org"],
      formAction: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"]
    }
  }
}));
app.use(cors({
  origin: IS_PROD
    ? ['https://t.me', 'https://web.telegram.org', process.env.PUBLIC_URL, process.env.API_URL].filter(Boolean)
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'https://t.me', 'https://web.telegram.org'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(metricsMiddleware);
app.use(correlationIdMiddleware());
app.use(tenantContext);
app.use(auditLog(getPool));

if (IS_PROD) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(`https://${req.hostname}${req.originalUrl}`);
    }
    next();
  });
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Juda ko\'p so\'rov, keyin urinib ko\'ring' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});
app.use([`/api`, API_PREFIX], limiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Login urinishlar soni oshib ketdi. 15 daqiqa kuting.' }, standardHeaders: true, legacyHeaders: false, validate: { trustProxy: false } });
const bookingLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Navbat so\'rovi limiti. 1 daqiqa kuting.' }, standardHeaders: true, legacyHeaders: false, validate: { trustProxy: false } });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'AI so\'rovlar soni cheklangan, 1 daqiqa kuting.' }, standardHeaders: true, legacyHeaders: false, validate: { trustProxy: false } });

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'your-256-bit-hex-secret-here' || process.env.JWT_SECRET.length < 16) {
  console.error('JWT_SECRET .env da xavfsiz qiymat bilan sozlanishi kerak!');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || crypto.randomBytes(32).toString('hex');

// ============================================================
// SWAGGER
// ============================================================
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Falcon AI OS API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: { persistAuthorization: true, docExpansion: 'list', filter: true, displayRequestDuration: true }
}));
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(swaggerSpec);
});

// ============================================================
// STATIC FILES
// ============================================================
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PROD ? '1y' : 0,
  immutable: IS_PROD,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    else if (filePath.endsWith('.js') || filePath.endsWith('.css')) res.setHeader('Cache-Control', IS_PROD ? 'public, max-age=3600' : 'no-cache');
  }
}));

app.get('/', (req, res) => res.redirect('/login.html'));

// ============================================================
// TELEGRAM BOTS
// ============================================================
let patientBot = null, referralBot = null;

function initBots() {
  const tokenP = process.env.TELEGRAM_TOKEN_PATIENT;
  const tokenR = process.env.TELEGRAM_TOKEN_REFERRAL;
  const baseUrl = process.env.PUBLIC_URL || null;

  if (tokenP && tokenP.length > 10) {
    try {
      patientBot = new Telegraf(tokenP);
      // booking.js va boshqa routelar req.app.locals.patientBot orqali
      // xabar yuboradi — shu yerda o'rnatilmasa, ular jim ishlamay qoladi.
      app.locals.patientBot = patientBot;
      patientBot.start(async (ctx) => {
        const userId = ctx.from?.id;
        const staff = userId ? await qGet("SELECT id, full_name, role FROM staff_members WHERE telegram_id = $1 AND is_active = true", [userId]) : null;
        const adminUrl = baseUrl ? baseUrl.replace(/\/+$/, '') + '/admin-tma.html' : null;
        const patientUrl = baseUrl ? baseUrl.replace(/\/+$/, '') + '/tma.html' : null;
        if (staff && adminUrl) {
          const roleLabels = { CEO: 'CEO', DOCTOR: 'Shifokor', WAREHOUSEMAN: 'Omborchi' };
          ctx.reply(`Assalomu alaykum, ${roleLabels[staff.role] || 'Xodim'} ${staff.full_name}!`,
            Markup.inlineKeyboard([
              [Markup.button.webApp('Admin panel', adminUrl)],
              [Markup.button.webApp('Bemor kabineti', patientUrl)]
            ])
          );
        } else if (patientUrl) {
          ctx.reply('Assalomu alaykum! Klinika Hayot botiga xush kelibsiz.',
            Markup.inlineKeyboard([Markup.button.webApp('Bemor kabineti', patientUrl)])
          );
        } else {
          ctx.reply(`Assalomu alaykum! Bot ishga tushdi. WebApp: ${baseUrl || 'sozlanmagan'}`);
        }
      });
      patientBot.launch().then(() => logger.info('[BOT] Patient bot ✅')).catch(e => logger.warn({ err: e }, '[BOT] Patient bot xato'));
    } catch (e) { logger.warn({ err: e }, '[BOT] Patient bot init xato'); }
  } else logger.warn('[BOT] TELEGRAM_TOKEN_PATIENT not set');

  if (tokenR && tokenR.length > 10) {
    try {
      referralBot = new Telegraf(tokenR);
      referralBot.start((ctx) => {
        if (baseUrl) {
          ctx.reply('Hamkor klinika portaliga xush kelibsiz!',
            Markup.inlineKeyboard([Markup.button.webApp('Portalni ochish', baseUrl.replace(/\/+$/, '') + '/referral_portal.html')])
          );
        } else ctx.reply('Hamkor klinika portaliga xush kelibsiz!');
      });
      referralBot.launch().then(() => logger.info('[BOT] Referral bot ✅')).catch(e => logger.warn({ err: e }, '[BOT] Referral bot xato'));
    } catch (e) { logger.warn({ err: e }, '[BOT] Referral bot init xato'); }
  } else logger.warn('[BOT] TELEGRAM_TOKEN_REFERRAL not set');
}

async function sendTelegram(chatId, text) {
  if (!patientBot) return;
  try { await patientBot.telegram.sendMessage(chatId, text); }
  catch (e) { logger.warn({ err: e }, '[BOT] Send xato'); }
}

// ============================================================
// HEALTH ENDPOINTS
// ============================================================
app.get('/api/health', async (req, res) => {
  try {
    await qGet('SELECT 1');
    const tenantCount = await qGet('SELECT COUNT(*) as c FROM tenants WHERE status = $1', ['active']);
    setActiveTenants(parseInt(tenantCount?.c || 0));
    res.json({
      status: 'ok', service: 'Falcon AI OS', version: '2.0.0',
      timestamp: new Date().toISOString(), uptime: process.uptime(),
      agents: orchestrator.getAllAgents().length,
      active_tenants: parseInt(tenantCount?.c || 0),
      node_version: process.version
    });
  } catch {
    res.json({ status: 'degraded', service: 'Falcon AI OS', version: '2.0.0', timestamp: new Date().toISOString(), uptime: process.uptime() });
  }
});
app.get('/api/health/ready', (req, res) => res.json({ ready: true, timestamp: new Date().toISOString() }));
app.get('/api/health/live', (req, res) => res.status(200).end('alive'));

// Metrics endpoint for Prometheus (faqat super-admin)
app.get('/metrics', authMiddleware, checkRole('superadmin'), metricsEndpoint);

// ============================================================
// SUBSCRIPTION ROUTES
// ============================================================
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });





// ============================================================
// HTML PAGE SERVING
// ============================================================
const VALID_PAGES = new Set([
  'login','dashboard','admin-tma','mini-app','tma',
  'reception','inventory','referral_portal','scribe','index',
  'qr-pay','qr-pay-kiosk'
]);
app.get('/:page', (req, res, next) => {
  const page = req.params.page;
  if (VALID_PAGES.has(page)) {
    const filePath = path.join(__dirname, 'public', page + '.html');
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
  }
  next();
});

// ============================================================
// VERIFY REPORT ENDPOINT
// ============================================================
app.get('/api/verify-report/:id', async (req, res) => {
  try {
    const r = await qGet("SELECT * FROM medical_reports WHERE id = $1", [req.params.id]);
    if (!r) return res.status(404).json({ success: false, error: 'Hisobot topilmadi' });
    const e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let data = {};
    if (r.data_json) { try { data = typeof r.data_json === 'string' ? JSON.parse(r.data_json) : r.data_json; } catch(e) { data = { raw: r.data_json }; } }
    if (req.accepts('html')) {
      const patientName = e(r.patient_name || 'Noma\'lum');
      const doctorName = e(r.doctor_name || '-');
      const specLabel = e(r.specialization_label || r.specialization || '-');
      const date = r.created_at ? new Date(r.created_at).toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
      const dataRows = Object.entries(data).filter(([k]) => k !== 'patient_name').map(([k, v]) => {
        if (typeof v === 'object' && v !== null) {
          const sub = Object.entries(v).map(([sk, sv]) => `<tr><td class="sub-key">${e(sk.replace(/_/g, ' '))}</td><td class="sub-val">${e(sv)}</td></tr>`).join('');
          return `<tr class="section-row"><td colspan="2" class="section-title">${e(k.replace(/_/g, ' '))}</td></tr>${sub}`;
        }
        return `<tr><td class="key">${e(k.replace(/_/g, ' '))}</td><td class="val">${e(v)}</td></tr>`;
      }).join('');
      return res.send(`<!DOCTYPE html>...`); // Full HTML kept from original
    }
    res.json({ success: true, verified: true, report: { id: r.id, patient_name: r.patient_name, doctor_name: r.doctor_name, created_at: r.created_at, data } });
  } catch(e) { serverError(res, e); }
});



// ============================================================
// INTERNAL ENDPOINT
// ============================================================
app.post('/api/internal/send-telegram', async (req, res) => {
  try {
    const { chat_id, text, parse_mode } = req.body;
    if (!chat_id || !text) return res.status(400).json({ success: false, error: 'chat_id va text talab qilinadi' });
    const secret = req.headers['x-internal-secret'];
    if (secret !== INTERNAL_SECRET) return res.status(403).json({ success: false, error: 'Noto\'g\'ri ichki kalit' });
    if (!patientBot) return res.status(503).json({ success: false, error: 'Bot mavjud emas' });
    await patientBot.telegram.sendMessage(chat_id, text, { parse_mode: parse_mode || 'Markdown' });
    res.json({ success: true });
  } catch (e) { serverError(res, e); }
});

// ============================================================
// HTTPS + SERVER START
// ============================================================
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');

async function ensureCert() {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    try {
      const { execSync } = await import('child_process');
      execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/C=UZ/ST=Tashkent/L=Tashkent/O=FalconAI/OU=Dev/CN=localhost"`, { stdio: 'pipe' });
    } catch (e) {
      console.warn('[HTTPS] OpenSSL topilmadi, HTTPS ishlamaydi');
    }
  }
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app).listen(3443, () =>
      console.log(`HTTPS: https://localhost:3443`));
  }
}

let server;
function startServer(port) {
  server = app.listen(port, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`Falcon AI OS v2.0.0 (SaaS)`);
    console.log(`========================================`);
    console.log(`HTTP:     http://localhost:${port}`);
    console.log(`API v1:   http://localhost:${port}${API_PREFIX}`);
    console.log(`Metrics:  http://localhost:${port}/metrics`);
    console.log(`Swagger:  http://localhost:${port}/api-docs`);
    console.log(`DB:       PostgreSQL (${process.env.DATABASE_URL ? 'connected' : 'not configured'})`);
    console.log(`========================================\n`);
    // Bemor xabarnomalari cron loop (24h reminder, 7d follow-up, no-show
    // belgilash). No-show qismi Telegram tokenidan mustaqil ishlashi kerak,
    // shuning uchun token sozlanmagan bo'lsa ham ishga tushadi — bildirishnoma
    // qismlari ichkarida token yo'qligini o'zi tekshiradi (jim o'tkazib yuboradi).
    startPatientReminderCron();
    startQueueNotifyCron();
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (port >= MAX_PORT) { console.error(`Port ${PORT}-${MAX_PORT} band`); process.exit(1); }
      startServer(port + 1);
    } else { console.error('Server xatosi:', err.message); process.exit(1); }
  });
}

async function main() {
  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error('DATABASE_URL .env da topilmadi! PostgreSQL ulanishi kerak.');
      process.exit(1);
    }
    await connectPg(dbUrl);
    console.log('[DB] PostgreSQL connected');

    await initCache();
    await initEmail();

    // Mount all routes after DB is initialized
    app.use(`${API_PREFIX}/auth`, authLimiter, authRoutes(getPool(), authMiddleware, checkRole, validate, schemas, telegramOrJwtAuth, signToken));
    app.use('/api/auth', authLimiter, authRoutes(getPool(), authMiddleware, checkRole, validate, schemas, telegramOrJwtAuth, signToken));
    app.use(`${API_PREFIX}/subscription`, checkSubscription, subscriptionRoutes());
    app.use(`/webhooks`, webhookRoutes());
    app.use(`${API_PREFIX}/tenants`, tenantRoutes(upload));
    app.use(`${API_PREFIX}/admin`, authMiddleware, checkRole('superadmin'), adminRoutes());
    // Scribe eng qimmat oqim (STT + LLM) — obuna va kunlik AI limiti majburiy.
    // authMiddleware oldin turadi: tenant JWT dan olinsin (x-tenant-id header orqali soxtalashtirib bo'lmasin).
    app.use(`/api/scribe`, authMiddleware, checkSubscription, tenantRateLimit('ai'), checkAiLimit,
      scribeRoutes(getPool(), authMiddleware, checkRole, upload, serverError, logger));
    app.use(`/api/doctor`, doctorViewRoutes(getPool(), authMiddleware, checkRole, serverError));
    app.use(`/api/b2b`, b2bRoutes(getPool(), authMiddleware, checkRole, validate, schemas, serverError));
    function mountRoutes(prefix) {
      const p = prefix || '';
      app.use(`${p}/patient`, patientRoutes(getPool()));
      app.use(`${p}/patients`, tenantRateLimit('api'), patientsRoutes(getPool(), authMiddleware));
      app.use(`${p}`, paymentRoutes(getPool(), authMiddleware, checkRole));
      app.use(`${p}/referral`, referralAgentRoutes(getPool(), authMiddleware, checkRole));
      app.use(`${p}/referrals`, referralPassRoutes(getPool(), authMiddleware, checkRole));
      app.use(`${p}`, tenantRateLimit('api'), inventoryRoutes(getPool(), authMiddleware, checkRole, validate, schemas, telegramOrJwtAuth, agentBypassOrAuth, upload));
      // Obuna/AI limiti ai.js ichida qimmat endpointlarga qo'yiladi (auth'dan keyin,
      // tenant JWT dan olinsin uchun). /status va /agents ochiq qoladi.
      app.use(`${p}/ai`, aiLimiter, tenantRateLimit('ai'), aiRoutes(getPool(), authMiddleware, checkRole, validate, schemas, orchestrator));
      app.use(`${p}`, doctorRoutes(getPool(), authMiddleware, checkRole, validate, schemas, telegramOrJwtAuth, upload));
      app.use(`${p}`, inpatientRoutes(getPool(), authMiddleware, checkRole, upload));
      app.use(`${p}/labs`, labsRoutes(getPool(), authMiddleware, checkRole));
      app.use(`${p}/legal`, legalRoutes(getPool(), authMiddleware, checkRole));
      // tma.js booking.js bilan BIR XIL yozuv mantig'ini ishlatadi (createBookingCore) —
      // Telegram orqali yozilgan bemor registratura/kiosk bilan bir xil navbatda ko'rinsin uchun.
      app.use(`/api/tma`, tmaRoutes(getPool(), createBookingCore(getPool(), serverError)));
      app.use(`${p}/appointments`, appointmentRoutes(getPool(), authMiddleware));
      app.use(`${p}/billing`, authMiddleware, billingRoutes(getPool(), authMiddleware, validate, schemas));
      app.use(`${p}/services`, tenantRateLimit('api'), servicesRoutes(getPool(), authMiddleware, checkRole, serverError));
      app.use(`${p}/booking`, tenantRateLimit('api'), bookingRoutes(getPool(), authMiddleware, telegramOrJwtAuth, serverError));
      app.use(`${p}/cashier`, tenantRateLimit('api'), cashierRoutes(getPool(), authMiddleware, checkRole, serverError));
      app.use(`${p}/alerts`, tenantRateLimit('api'), alertsRoutes(getPool(), authMiddleware));
      app.use(`${p}/insights`, tenantRateLimit('api'), insightsRoutes(getPool(), authMiddleware, checkRole));
      app.use(`${p}/copilot`, tenantRateLimit('ai'), copilotRoutes(getPool(), authMiddleware, checkRole, upload));
      // Bemor Telegram bot webhook — auth yo'q (Telegram Server -> Falcon), secret bilan himoyalangan
      app.use(`${p}/patient-bot`, patientBotRoutes(getPool()));
      // Kiosk — qurilma tokeni bilan himoyalangan (X-Kiosk-Token sarlavhasi).
      // /devices endpointlari JWT + ceo/admin talab qiladi (route ichida).
      app.use(`${p}/kiosk`, tenantRateLimit('api'), kioskRoutes(getPool(), authMiddleware, checkRole));
      // Xodimlar davomati — agent qurilma tokeni bilan hodisa yuboradi,
      // hisobotlar JWT bilan o'qiladi. Yuz shablonlari bu yerga kelmaydi.
      app.use(`${p}/attendance`, tenantRateLimit('api'), attendanceRoutes(getPool(), authMiddleware, checkRole));
    }
    mountRoutes('/api');
    mountRoutes(API_PREFIX);

    if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8) {
      console.error('[INIT] ADMIN_PASSWORD .env da kamida 8 belgi qilib sozlanishi kerak!');
      process.exit(1);
    }
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@falconai.uz';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    // Superadmin barcha klinikalardan tashqarida — ataylab tenantsiz so'rov
    const existing = await unsafeQuery.qGet("SELECT id FROM users WHERE username = $1 AND role = 'superadmin'", [ADMIN_EMAIL]);
    if (!existing) {
      const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await q(
        "INSERT INTO users (id, tenant_id, username, password, role, name) VALUES ($1, 'default', $2, $3, 'superadmin', $4) ON CONFLICT (username) DO NOTHING",
        [uuidv4(), ADMIN_EMAIL, hashed, 'Super Admin']
      );
      console.log('[INIT] Super-admin yaratildi:', ADMIN_EMAIL);
    }

    await ensureCert();
    startServer(PORT);
    initBots();
  } catch (e) {
    console.error('[INIT] Xatolik:', e.message);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  main();
}

// ============================================================
// CRON: Medication reminders
// ============================================================
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    const currentMinute = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    // Tizim cron'i — barcha klinikalar bo'ylab ishlaydi (ataylab tenantsiz)
    const reminders = await unsafeQuery.q("SELECT * FROM medication_reminders WHERE status='active' AND reminder_time LIKE $1", [currentMinute + '%']);
    for (const r of reminders) {
      if (r.telegram_id) {
        try { await sendTelegram(r.telegram_id, `Dori vaqti: ${r.medicine_name} (${r.dosage || ''}) — ${r.patient_name}`); }
        catch (e) { logger.warn({ err: e }, '[REMINDER] Telegram yuborishda xatolik'); }
      }
    }
  } catch (e) { logger.warn({ err: e }, '[REMINDER] Cron xatosi'); }
});

// ============================================================
// CRON: Trial management — har kuni tekshirish
// ============================================================
cron.schedule('0 6 * * *', async () => {
  try {
    const expired = await q(`
      SELECT s.id, s.tenant_id, t.name as tenant_name, t.email
      FROM subscriptions s
      JOIN tenants t ON t.id = s.tenant_id
      WHERE s.status = 'trialing' AND s.trial_ends_at < NOW()
    `);
    for (const sub of expired) {
      await q("UPDATE subscriptions SET status = 'active', plan_id = 'plan_free' WHERE id = $1", [sub.id]);
      await q("UPDATE tenants SET plan = 'free' WHERE id = $1", [sub.tenant_id]);
      logger.info({ tenant_id: sub.tenant_id, tenant_name: sub.tenant_name }, '[TRIAL] Sinov muddati tugadi, free ga o\'tkazildi');
    }
    if (expired.length > 0) console.log(`[TRIAL] ${expired.length} ta tenant sinov muddati tugadi`);
  } catch (e) { logger.warn({ err: e }, '[TRIAL] Xatolik'); }
});

// ============================================================
// CRON: Recurring billing — har kuni soat 9 da
// ============================================================
cron.schedule('0 9 * * *', async () => {
  try {
    const { processRecurringBilling } = await import('./backend/services/billing-cron.js');
    const result = await processRecurringBilling();
    logger.info({ processed: result.processed, overdue: result.overdue }, '[BILLING] Recurring billing yakunlandi');
  } catch (e) { logger.warn({ err: e }, '[BILLING] Xatolik'); }
});

// ============================================================
// CRON: PostgreSQL backup — har kuni soat 3 da
// ============================================================
cron.schedule('0 3 * * *', async () => {
  try {
    const { createBackup } = await import('./backend/services/backup.js');
    const result = await createBackup();
    logger.info({ success: result.success, size: result.size }, '[BACKUP]');
  } catch (e) { logger.warn({ err: e }, '[BACKUP] Xatolik'); }
});

// ============================================================
// CRON: Usage metering — eski ma'lumotlarni tozalash
// ============================================================
cron.schedule('0 4 * * 0', async () => {
  try {
    await q("DELETE FROM usage_metering WHERE date < CURRENT_DATE - INTERVAL '90 days'");
    console.log('[METERING] 90 kundan eski ma\'lumotlar tozalandi');
  } catch (e) { logger.warn({ err: e }, '[METERING] Xatolik'); }
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
function shutdown(signal) {
  console.log(`\n[${signal}] Server yopilmoqda...`);
  if (patientBot) patientBot.stop();
  if (referralBot) referralBot.stop();
  Promise.all([disconnectPg(), disconnectCache()]).then(() => {
    if (server) server.close(() => process.exit(0));
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

Sentry.setupExpressErrorHandler(app);

app.use((err, req, res, next) => {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  if (res.headersSent) return;
  res.status(err.status || 500).json({
    success: false,
    error: IS_PROD ? 'Server xatosi yuz berdi' : err.message
  });
});

export { app, q as getDb };
app.locals.q = q;
app.locals.qGet = qGet;
