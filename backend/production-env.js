const SECRET_MINIMUMS = {
  JWT_SECRET: 32,
  INTERNAL_SECRET: 32,
  ADMIN_PASSWORD: 12,
  SEED_CEO_PASSWORD: 12,
  SEED_ADMIN_PASSWORD: 12,
  SEED_RECEPTION_PASSWORD: 12,
  SEED_DOCTOR_PASSWORD: 12,
};

function parsePostgresUrl(name, value, errors) {
  if (!value) {
    errors.push(`${name} talab qilinadi`);
    return null;
  }
  try {
    const parsed = new URL(value);
    if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
      errors.push(`${name} PostgreSQL URL bo'lishi kerak`);
      return null;
    }
    if (!parsed.username || !parsed.password || !parsed.hostname || !parsed.pathname.slice(1)) {
      errors.push(`${name} username, password, host va database nomiga ega bo'lishi kerak`);
      return null;
    }
    return parsed;
  } catch {
    errors.push(`${name} yaroqli URL emas`);
    return null;
  }
}

export function validateProductionEnvironment(env = process.env) {
  if (env.NODE_ENV !== 'production') return true;

  const errors = [];
  for (const [name, minimum] of Object.entries(SECRET_MINIMUMS)) {
    const value = String(env[name] || '');
    if (value.length < minimum) errors.push(`${name} kamida ${minimum} belgi bo'lishi kerak`);
    if (/your[-_]|change[-_]?me|example/i.test(value)) errors.push(`${name} placeholder qiymat bo'lishi mumkin emas`);
  }

  const applicationUrl = parsePostgresUrl('DATABASE_URL', env.DATABASE_URL, errors);
  const platformUrl = parsePostgresUrl('PLATFORM_DATABASE_URL', env.PLATFORM_DATABASE_URL, errors);
  if (applicationUrl && platformUrl && applicationUrl.username === platformUrl.username) {
    errors.push('DATABASE_URL va PLATFORM_DATABASE_URL turli DB rollaridan foydalanishi kerak');
  }
  if (env.RLS_ENFORCE_APP_ROLE !== 'true') {
    errors.push('RLS_ENFORCE_APP_ROLE production muhitida true bo\'lishi kerak');
  }

  try {
    const publicUrl = new URL(String(env.PUBLIC_URL || ''));
    if (publicUrl.protocol !== 'https:') errors.push('PUBLIC_URL production muhitida HTTPS bo\'lishi kerak');
  } catch {
    errors.push('PUBLIC_URL yaroqli HTTPS URL bo\'lishi kerak');
  }

  if (errors.length) {
    throw new Error(`Production environment xavfsiz emas:\n- ${errors.join('\n- ')}`);
  }
  return true;
}
