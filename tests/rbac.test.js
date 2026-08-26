import { describe, it, expect } from 'vitest';
import { ROLES, PERMISSIONS, hasPermission, requirePermission } from '../backend/rbac.js';

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

describe('RBAC matritsasi yaxlitligi', () => {
  it('barcha matritsadagi rollar ROLES ro\'yxatida', () => {
    for (const [permission, roles] of Object.entries(PERMISSIONS)) {
      expect(roles.length, `${permission} bo'sh bo'lmasligi kerak`).toBeGreaterThan(0);
      for (const role of roles) {
        expect(ROLES, `${permission} -> "${role}" ROLES ichida emas`).toContain(role);
      }
    }
  });

  it('har bir ruxsat nomi domain.action formatida', () => {
    for (const permission of Object.keys(PERMISSIONS)) {
      expect(permission).toMatch(/^[a-z]+\.(read|write|manage)$/);
    }
  });

  it('platform.manage faqat superadmin uchun', () => {
    expect(PERMISSIONS['platform.manage']).toEqual(['superadmin']);
  });

  it('doctor moliya va omborga kira olmaydi', () => {
    for (const p of ['finance.read', 'finance.write', 'inventory.read', 'inventory.write']) {
      expect(PERMISSIONS[p]).not.toContain('doctor');
    }
  });

  it('cashier xodim boshqaruvi va sozlamalarga kira olmaydi', () => {
    for (const p of ['staff.manage', 'settings.manage', 'structure.manage', 'audit.read']) {
      expect(PERMISSIONS[p]).not.toContain('cashier');
    }
  });
});

describe('hasPermission', () => {
  it('superadmin har doim o\'tadi', () => {
    for (const p of Object.keys(PERMISSIONS)) {
      expect(hasPermission({ role: 'superadmin' }, p)).toBe(true);
    }
  });

  it('noma\'lum ruxsat hech kimga berilmaydi', () => {
    expect(hasPermission({ role: 'ceo' }, 'nonexistent.read')).toBe(false);
    expect(hasPermission({ role: 'superadmin' }, 'nonexistent.read')).toBe(true); // superadmin istisno
  });

  it('user yo\'q bo\'lsa false', () => {
    expect(hasPermission(null, 'patients.read')).toBe(false);
    expect(hasPermission({}, 'patients.read')).toBe(false);
  });

  it('rol bo\'yicha to\'g\'ri ishlaydi', () => {
    expect(hasPermission({ role: 'receptionist' }, 'patients.write')).toBe(true);
    expect(hasPermission({ role: 'doctor' }, 'patients.write')).toBe(false);
    expect(hasPermission({ role: 'doctor' }, 'medical.write')).toBe(true);
    expect(hasPermission({ role: 'cashier' }, 'finance.write')).toBe(true);
  });
});

describe('requirePermission middleware', () => {
  it('token yo\'q bo\'lsa 401', () => {
    const mw = requirePermission('patients.read');
    const res = mockRes();
    let nextCalled = false;
    mw({}, res, () => { nextCalled = true; });
    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it('ruxsat yetishmasa 403 + missing_permissions', () => {
    const mw = requirePermission('staff.manage', 'audit.read');
    const res = mockRes();
    let nextCalled = false;
    mw({ user: { role: 'receptionist' } }, res, () => { nextCalled = true; });
    expect(res.statusCode).toBe(403);
    expect(res.body.missing_permissions).toEqual(['staff.manage', 'audit.read']);
    expect(nextCalled).toBe(false);
  });

  it('barcha ruxsatlar bo\'lsa o\'tadi', () => {
    const mw = requirePermission('patients.read', 'appointments.write');
    const res = mockRes();
    let nextCalled = false;
    mw({ user: { role: 'receptionist' } }, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(null);
  });
});
