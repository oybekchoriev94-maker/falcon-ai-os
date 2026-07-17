import { describe, it, expect, beforeAll } from 'vitest';
import {
  calcPlatformFee, calcCommission,
  deductDoctorBalance, accruePatientCashback,
  redeemPatientCashback, topupDoctorBalance
} from '../backend/services/finance-engine.js';

const mockDb = { doctors: {}, patients: {} };
mockDb.doctors.d1 = { id: 'd1', balance: 50000 };
mockDb.patients.p1 = { id: 'p1', cashback_balance: 30000 };

const q = (sql, params = []) => {
  if (sql.includes('SELECT')) return [];
  if (sql.includes('balance')) return { changes: 1 };
  return { changes: 1 };
};
const qGet = (sql, params = []) => {
  if (sql.includes('doctors')) return mockDb.doctors[params[0]] || null;
  if (sql.includes('patients')) return mockDb.patients[params[0]] || null;
  return null;
};

describe('calcPlatformFee', () => {
  it('3% of amount', () => expect(calcPlatformFee(100000)).toBe(3000));
  it('rounds to 2 decimal', () => expect(calcPlatformFee(33333)).toBe(999.99));
  it('0 for 0', () => expect(calcPlatformFee(0)).toBe(0));
});

describe('calcCommission', () => {
  it('X% of amount', () => expect(calcCommission(100000, 10)).toBe(10000));
  it('non-integer percent', () => expect(calcCommission(200000, 3.5)).toBe(7000));
  it('0 for 0%', () => expect(calcCommission(50000, 0)).toBe(0));
});

describe('deductDoctorBalance', () => {
  it('deducts when sufficient', () => {
    expect(deductDoctorBalance(mockDb, qGet, 'd1', 10000)).toBe(true);
  });
  it('false when insufficient', () => {
    expect(deductDoctorBalance(mockDb, qGet, 'd1', 999999)).toBe(false);
  });
});

describe('accruePatientCashback', () => {
  it('increments cashback', () => {
    expect(accruePatientCashback(mockDb, qGet, 'p1', 5000)).toBe(true);
  });
});

describe('redeemPatientCashback', () => {
  it('deducts when sufficient', () => {
    expect(redeemPatientCashback(mockDb, qGet, 'p1', 10000)).toBe(true);
  });
});

describe('topupDoctorBalance', () => {
  it('increments balance', () => {
    expect(topupDoctorBalance(mockDb, q, 'd1', 20000)).toBe(true);
  });
});
