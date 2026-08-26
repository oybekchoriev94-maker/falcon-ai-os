// ============================================================
// Kanonik agentlar xartiyasi va runtime audit wiring testlari
// (DB talab qilmaydi — faqat xartiya integriteti va runtime)
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_AGENTS,
  getCanonicalAgent,
  canonicalForAgent,
  getCanonicalCoverage,
} from '../ai/core/canonical.js';
import { registerAgent, getAgent } from '../ai/core/registry.js';
import { executeAgent } from '../ai/core/runtime.js';

const ALL_MAPPED = CANONICAL_AGENTS.flatMap((a) => a.mapped_agents);

describe('Kanonik agentlar xartiyasi', () => {
  it('roppa-rosa 12 ta kanonik agent bo\'lishi kerak', () => {
    expect(CANONICAL_AGENTS).toHaveLength(12);
  });

  it('PLATFORM-ROADMAP.md "Asosiy AI agentlar" bo\'limidagi tartib bilan mos', () => {
    expect(CANONICAL_AGENTS.map((a) => a.id)).toEqual([
      'reception', 'doctor-copilot', 'patient-history', 'document-ocr',
      'laboratory', 'pharmacy-inventory', 'hr-attendance', 'vision-security',
      'finance-anomaly', 'clinic-director', 'compliance-audit', 'patient-communication',
    ]);
  });

  it('id lar unikal bo\'lishi kerak', () => {
    const ids = CANONICAL_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('har bir agentda yo\'l xarita talab qilgan majburiy maydonlar bor', () => {
    for (const a of CANONICAL_AGENTS) {
      expect(a.id, 'id').toMatch(/^[a-z][a-z0-9-]*$/);
      expect(a.name, `${a.id}.name`).toBeTruthy();
      expect(['active', 'partial', 'planned'], `${a.id}.status`).toContain(a.status);
      expect(a.mission, `${a.id}.mission`).toMatch(/\S/);
      expect(Array.isArray(a.data_scope) && a.data_scope.length > 0, `${a.id}.data_scope`).toBe(true);
      expect(Array.isArray(a.actions) && a.actions.length > 0, `${a.id}.actions`).toBe(true);
      expect(Array.isArray(a.requires_human_approval), `${a.id}.requires_human_approval`).toBe(true);
      expect(Array.isArray(a.mapped_agents), `${a.id}.mapped_agents`).toBe(true);
    }
  });

  it('hech bir agent ikki kanonik agentga birdan bog\'lanmaydi', () => {
    const dupes = ALL_MAPPED.filter((n, i) => ALL_MAPPED.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('34 ta mavjud agent kanoniklarga bog\'langan', () => {
    expect(ALL_MAPPED).toHaveLength(34);
  });

  it('getCanonicalAgent topadi yoki null qaytaradi', () => {
    expect(getCanonicalAgent('doctor-copilot')?.name).toBeTruthy();
    expect(getCanonicalAgent('yoq-agent')).toBeNull();
  });

  it('canonicalForAgent nomi orqali kanonikni topadi', () => {
    expect(canonicalForAgent('visit-scribe')?.id).toBe('patient-history');
    expect(canonicalForAgent('revenue-forecaster')?.id).toBe('finance-anomaly');
    expect(canonicalForAgent('umuman-notanish')).toBeNull();
  });

  it('coverage: barcha mapped agentlar ro\'yxatdan o\'tgan bo\'lsa 100%', () => {
    const cov = getCanonicalCoverage(ALL_MAPPED);
    expect(cov.coverage).toBe(100);
    expect(cov.mapped_found).toBe(34);
    expect(cov.agents.every((a) => a.missing.length === 0)).toBe(true);
  });

  it('coverage: qisman ro\'yxatda missing ko\'rinadi', () => {
    const cov = getCanonicalCoverage(['inventory-manager']);
    const pharmacy = cov.agents.find((a) => a.id === 'pharmacy-inventory');
    expect(pharmacy.coverage).toBe(100);
    const history = cov.agents.find((a) => a.id === 'patient-history');
    expect(history.coverage).toBe(0);
    expect(history.missing).toContain('visit-scribe');
    // Mapped agenti yo'q kanonik (hali agent yozilmagan) coverage=null
    const hr = cov.agents.find((a) => a.id === 'hr-attendance');
    expect(hr.coverage).toBeNull();
  });
});

describe('Registry va runtime wiring', () => {
  it('registry canonical maydonini saqlaydi', () => {
    registerAgent({
      name: 'brain-test-dummy',
      description: 'test',
      handler: async () => ({ ok: true }),
      canonical: 'analytics',
    });
    expect(getAgent('brain-test-dummy').canonical).toBe('analytics');
  });

  it('executeAgent canonical ni handler ctx ga uzatadi', async () => {
    let seen = null;
    registerAgent({
      name: 'brain-test-ctx',
      description: 'test',
      handler: async (input, ctx) => { seen = ctx; return { ok: true }; },
      canonical: 'reception',
    });
    const result = await executeAgent('brain-test-ctx', {}, { tenantId: '00000000-0000-0000-0000-000000000000' });
    expect(result.success).toBe(true);
    expect(seen.canonical).toBe('reception');
    expect(seen.tenantId).toBeTruthy();
  });

  it('executeAgent mapped nomdan canonical ni avtomatik topadi', async () => {
    let seen = null;
    registerAgent({
      name: 'visit-scribe', // kanonik xartiyada 'patient-history' ga bog'langan
      description: 'test override',
      handler: async (input, ctx) => { seen = ctx; return { ok: true }; },
    });
    await executeAgent('visit-scribe', {}, { tenantId: '00000000-0000-0000-0000-000000000000' });
    expect(seen.canonical).toBe('patient-history');
  });

  it('handler xatosi structured fail bo\'lib qaytadi', async () => {
    registerAgent({
      name: 'brain-test-fail',
      description: 'test',
      handler: async () => { throw Object.assign(new Error('ichki xato'), { code: 'TEST_FAIL' }); },
    });
    const result = await executeAgent('brain-test-fail', {}, { tenantId: '00000000-0000-0000-0000-000000000000' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('TEST_FAIL');
  });
});
