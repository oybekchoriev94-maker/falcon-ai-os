import { describe, expect, it } from 'vitest';
import { validateProductionEnvironment } from '../backend/production-env.js';

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://falcon_app:application-password@db:5432/falcon',
    PLATFORM_DATABASE_URL: 'postgresql://falcon_owner:platform-password@db:5432/falcon',
    RLS_ENFORCE_APP_ROLE: 'true',
    JWT_REFRESH_WINDOW_DAYS: '7',
    PUBLIC_URL: 'https://falconmedai.uz',
    JWT_SECRET: 'jwt-secret-with-at-least-32-characters',
    INTERNAL_SECRET: 'internal-secret-with-at-least-32-chars',
    ADMIN_PASSWORD: 'admin-password-strong',
    SEED_CEO_PASSWORD: 'seed-ceo-password',
    SEED_ADMIN_PASSWORD: 'seed-admin-password',
    SEED_RECEPTION_PASSWORD: 'seed-reception-password',
    SEED_DOCTOR_PASSWORD: 'seed-doctor-password',
    ...overrides,
  };
}

describe('production environment validation', () => {
  it('accepts separated DB roles and strong secrets', () => {
    expect(validateProductionEnvironment(productionEnv())).toBe(true);
  });

  it('rejects owner credentials reused by the application pool', () => {
    expect(() => validateProductionEnvironment(productionEnv({
      DATABASE_URL: 'postgresql://falcon_owner:application-password@db:5432/falcon',
    }))).toThrow('turli DB rollaridan');
  });

  it('rejects disabled RLS enforcement and insecure public URLs', () => {
    expect(() => validateProductionEnvironment(productionEnv({
      RLS_ENFORCE_APP_ROLE: 'false',
      PUBLIC_URL: 'http://falconmedai.uz',
    }))).toThrow('Production environment xavfsiz emas');
  });

  it('does not enforce production requirements in development and tests', () => {
    expect(validateProductionEnvironment({ NODE_ENV: 'test' })).toBe(true);
  });

  it('rejects an excessive JWT refresh window', () => {
    expect(() => validateProductionEnvironment(productionEnv({
      JWT_REFRESH_WINDOW_DAYS: '31',
    }))).toThrow('JWT_REFRESH_WINDOW_DAYS');
  });
});
