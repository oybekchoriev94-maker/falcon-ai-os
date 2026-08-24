import { randomBytes } from 'crypto';

let appPromise;
let dbModule;

/**
 * Barcha API testlari bitta to'liq mount qilingan Express ilovasidan
 * foydalanadi. TEST_DATABASE_URL alohida, migratsiya qilingan test bazasini
 * ko'rsatishi kerak.
 */
export function getTestApp() {
  if (!appPromise) {
    appPromise = initializeTestApp();
  }
  return appPromise;
}

export async function closeTestApp() {
  if (dbModule) await dbModule.disconnectPg();
  dbModule = undefined;
  appPromise = undefined;
}

async function initializeTestApp() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= randomBytes(32).toString('hex');
  process.env.INTERNAL_SECRET ||= randomBytes(32).toString('hex');
  process.env.ADMIN_PASSWORD ||= randomBytes(24).toString('base64url');
  process.env.SEED_ADMIN_PASSWORD ||= randomBytes(24).toString('base64url');
  process.env.SEED_CEO_PASSWORD ||= randomBytes(24).toString('base64url');
  process.env.SEED_RECEPTION_PASSWORD ||= randomBytes(24).toString('base64url');
  process.env.SEED_DOCTOR_PASSWORD ||= randomBytes(24).toString('base64url');

  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'API testlari uchun TEST_DATABASE_URL talab qilinadi. Avval test PostgreSQL bazasini yarating va migratsiyalarni ishga tushiring.'
    );
  }

  dbModule = await import('../../backend/db.js');
  await dbModule.connectPg(databaseUrl, process.env.PLATFORM_DATABASE_URL);

  const server = await import('../../server.js');
  await server.mountApiRoutes(server.app, dbModule.getPool());
  server.finalizeApp(server.app);
  return server.app;
}
