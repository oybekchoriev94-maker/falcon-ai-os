// ============================================================
// Barcha agentlarni registrga ulash
// ============================================================

import { registerAgent } from '../core/registry.js';

import * as medicalScribe from './medical-scribe.js';
// Shifokor qabuli: ovozli diktantni ko'rik kartasi maydonlariga ajratadi
import * as visitScribe from './visit-scribe.js';
// Statsionar: yotqizish diktantini 003-forma maydonlariga ajratadi
import * as admissionScribe from './admission-scribe.js';
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
// Bemor bilan aloqa agentlari (Bosqich O): reminder, natija, follow-up, tayyorgarlik
import { PATIENT_NOTIFY_AGENTS } from './patient-notify.js';
// Biznes tahlili agentlari (Bosqich P): CEO uchun daromad, xodim, xizmat, churn
import { BUSINESS_AGENTS } from './business-intel.js';
// Shifokor copilot agentlari (Bosqich Q): voice command, chat, smart autofill (propose-only)
import { COPILOT_AGENTS } from './doctor-copilot.js';
// Bemor Telegram chatbot (Bosqich R): chatbot, symptom-checker, photo-triage
import { CHATBOT_AGENTS } from './patient-chatbot.js';

const ALL = [
  medicalScribe,
  visitScribe,
  admissionScribe,
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
for (const mod of PATIENT_NOTIFY_AGENTS) registerAgent(mod);
for (const mod of BUSINESS_AGENTS) registerAgent(mod);
for (const mod of COPILOT_AGENTS) registerAgent(mod);
for (const mod of CHATBOT_AGENTS) registerAgent(mod);

const totalCount = ALL.length + CLINICAL_WORKFLOW.length + SAFETY_AGENTS.length +
                   TIME_SAVER_AGENTS.length + PATIENT_NOTIFY_AGENTS.length +
                   BUSINESS_AGENTS.length + COPILOT_AGENTS.length + CHATBOT_AGENTS.length;
console.log(`[AI] ${totalCount} ta agent ro'yxatdan o'tdi ` +
            `(${CLINICAL_WORKFLOW.length} klinika + ${SAFETY_AGENTS.length} xavfsizlik + ` +
            `${TIME_SAVER_AGENTS.length} vaqt tejash + ${PATIENT_NOTIFY_AGENTS.length} bemor aloqasi + ` +
            `${BUSINESS_AGENTS.length} biznes + ${COPILOT_AGENTS.length} copilot + ` +
            `${CHATBOT_AGENTS.length} chatbot)`);
