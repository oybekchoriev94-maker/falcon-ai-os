// ============================================================
// Barcha agentlarni registrga ulash
// ============================================================

import { registerAgent } from '../core/registry.js';

import * as medicalScribe from './medical-scribe.js';
import * as receptionist from './receptionist.js';
import * as inventoryManager from './inventory-manager.js';
import * as analyticsAgent from './analytics-agent.js';
import * as medicationCoach from './medication-coach.js';
import * as b2bReferral from './b2b-referral.js';
import * as referralAgent from './referral-agent.js';
// Klinika oqimi agentlari (obhod, anomaliya, epikriz, lab, tashxis) — bundle
import { AGENTS as CLINICAL_WORKFLOW } from './clinical-workflow.js';
// Xavfsizlik agentlari (Bosqich M): obhod/lab/retsept yozilganda avto ishga tushadi
import { SAFETY_AGENTS } from './safety-agents.js';
// Vaqt tejash agentlari (Bosqich N): karta ochilishi, reception voice, lab natija
import { TIME_SAVER_AGENTS } from './time-savers.js';

const ALL = [
  medicalScribe,
  receptionist,
  inventoryManager,
  analyticsAgent,
  medicationCoach,
  b2bReferral,
  referralAgent,
];

for (const mod of ALL) registerAgent(mod);
for (const mod of CLINICAL_WORKFLOW) registerAgent(mod);
for (const mod of SAFETY_AGENTS) registerAgent(mod);
for (const mod of TIME_SAVER_AGENTS) registerAgent(mod);

console.log(`[AI] ${ALL.length + CLINICAL_WORKFLOW.length + SAFETY_AGENTS.length + TIME_SAVER_AGENTS.length} ta agent ro'yxatdan o'tdi ` +
            `(${CLINICAL_WORKFLOW.length} klinika oqimi + ${SAFETY_AGENTS.length} xavfsizlik + ${TIME_SAVER_AGENTS.length} vaqt tejash)`);
