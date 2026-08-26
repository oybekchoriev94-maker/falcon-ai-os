// ============================================================
// Tizim salomatligi agregatori testlari (PR #15)
// Sof funksiyalar — DB kerak emas.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  parseBackupStatus,
  backupHealth,
  aggregateHealth,
  BACKUP_MAX_AGE_HOURS,
} from '../backend/services/system-health.js';

const NOW = new Date('2026-08-26T12:00:00Z');

describe('parseBackupStatus', () => {
  it('to\'g\'ri JSON ni talqin qiladi', () => {
    const r = parseBackupStatus('{"ok":true,"timestamp":"2026-08-26T02:30:00Z"}');
    expect(r.ok).toBe(true);
    expect(r.timestamp).toBe('2026-08-26T02:30:00Z');
  });

  it('buzilgan JSON uchun null (istisno emas)', () => {
    expect(parseBackupStatus('{buzilgan')).toBe(null);
    expect(parseBackupStatus('')).toBe(null);
    expect(parseBackupStatus(null)).toBe(null);
    expect(parseBackupStatus(undefined)).toBe(null);
  });

  it('JSON bo\'lmagan qiymatlar xavfsiz', () => {
    expect(parseBackupStatus('null')).toBe(null);
    expect(parseBackupStatus('"matn"')).toBe(null);
  });
});

describe('backupHealth', () => {
  it('status yo\'q bo\'lsa missing', () => {
    expect(backupHealth(null, 26, NOW)).toEqual({ state: 'missing', ageHours: null });
  });

  it('ok=false — backup XATO bilan tugagan', () => {
    const r = backupHealth({ ok: false, error: 'pg_dump failed' }, 26, NOW);
    expect(r.state).toBe('failed');
    expect(r.error).toBe('pg_dump failed');
  });

  it('yangi backup — ok, yoshi soatda', () => {
    const r = backupHealth({ ok: true, timestamp: '2026-08-26T02:30:00Z', file: 'f.dump' }, 26, NOW);
    expect(r.state).toBe('ok');
    expect(r.ageHours).toBe(9.5);
    expect(r.file).toBe('f.dump');
  });

  it('chegaradan oshgan backup — stale', () => {
    const r = backupHealth({ ok: true, timestamp: '2026-08-24T12:00:00Z' }, 26, NOW);
    expect(r.state).toBe('stale');
    expect(r.ageHours).toBe(48);
  });

  it('aynan chegara vaqtida hali ok', () => {
    const r = backupHealth({ ok: true, timestamp: '2026-08-25T10:00:00Z' }, 26, NOW);
    expect(r.state).toBe('ok');
    expect(r.ageHours).toBe(26);
  });

  it('vaqt formati buzilgan bo\'lsa missing', () => {
    const r = backupHealth({ ok: true, timestamp: 'kecha-ertalab' }, 26, NOW);
    expect(r.state).toBe('missing');
  });

  it('standart chegara 26 soat (kunlik rejaga zaxira)', () => {
    expect(BACKUP_MAX_AGE_HOURS).toBe(26);
  });
});

describe('aggregateHealth', () => {
  it('hammasi sog\'lom — ok', () => {
    const r = aggregateHealth([
      { name: 'database', ok: true, critical: true },
      { name: 'stt', ok: true },
      { name: 'backup', ok: true },
    ]);
    expect(r).toEqual({ overall: 'ok', problems: [] });
  });

  it('kritik komponent yiqilsa — down', () => {
    const r = aggregateHealth([
      { name: 'database', ok: false, critical: true },
      { name: 'stt', ok: true },
    ]);
    expect(r.overall).toBe('down');
    expect(r.problems).toEqual(['database']);
  });

  it('no-kritik muammo — degraded (asosiy oqim ishlaydi)', () => {
    const r = aggregateHealth([
      { name: 'database', ok: true, critical: true },
      { name: 'stt', ok: false },
      { name: 'backup', ok: false },
    ]);
    expect(r.overall).toBe('degraded');
    expect(r.problems).toEqual(['stt', 'backup']);
  });

  it('down degraded\'dan ustun', () => {
    const r = aggregateHealth([
      { name: 'database', ok: false, critical: true },
      { name: 'ocr', ok: false },
    ]);
    expect(r.overall).toBe('down');
    expect(r.problems).toEqual(['database', 'ocr']);
  });

  it('bo\'sh ro\'yxat va null elementlar xavfsiz', () => {
    expect(aggregateHealth([]).overall).toBe('ok');
    expect(aggregateHealth([null, { name: 'x', ok: true }]).overall).toBe('ok');
  });
});
