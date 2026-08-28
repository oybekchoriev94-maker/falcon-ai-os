// ============================================================
// Barcha agentlarni registrga ulash
//
// QOIDA: bu yerda FAQAT mahsulotda haqiqatan chaqiriladigan agentlar
// turadi. Ilgari 34 ta agent ro'yxatdan o'tardi, lekin ularning 13
// tasining hech qanday chaqiruvchisi yo'q edi — ular faqat
// /api/ai/agents sonini kattalashtirib, tizim imkoniyati haqida
// noto'g'ri taassurot berardi.
//
// Yangi agent qo'shishdan oldin: uni CHAQIRADIGAN kod bormi?
// Yo'q bo'lsa — avval chaqiruvni yozing, keyin registrga qo'shing.
// ============================================================

import { registerAgent } from '../core/registry.js';

// Ovozli diktantni tuzilgan kartaga aylantiruvchi agentlar
import * as visitScribe from './visit-scribe.js';         // shifokor qabuli
import * as admissionScribe from './admission-scribe.js';  // statsionar 003-forma

// Klinika oqimi (obhod diktanti, chiqarish epikrizi)
import { AGENTS as CLINICAL_WORKFLOW } from './clinical-workflow.js';
// Xavfsizlik: obhod/lab/retsept yozilganda avto ishga tushadi
import { SAFETY_AGENTS } from './safety-agents.js';
// Vaqt tejash: karta xulosasi, triaj, lab natija talqini
import { TIME_SAVER_AGENTS } from './time-savers.js';
// Bemor bilan aloqa: eslatma, natija tayyor, follow-up
import { PATIENT_NOTIFY_AGENTS } from './patient-notify.js';
// Biznes tahlili (CEO paneli): daromad, xodim, xizmat, churn
import { BUSINESS_AGENTS } from './business-intel.js';
// Shifokor copilot: ovozli buyruq, chat, smart autofill (propose-only)
import { COPILOT_AGENTS } from './doctor-copilot.js';
// Bemor Telegram chatboti
import { CHATBOT_AGENTS } from './patient-chatbot.js';

const SINGLE = [visitScribe, admissionScribe];

for (const mod of SINGLE) registerAgent(mod);
for (const mod of CLINICAL_WORKFLOW) registerAgent(mod);
for (const mod of SAFETY_AGENTS) registerAgent(mod);
for (const mod of TIME_SAVER_AGENTS) registerAgent(mod);
for (const mod of PATIENT_NOTIFY_AGENTS) registerAgent(mod);
for (const mod of BUSINESS_AGENTS) registerAgent(mod);
for (const mod of COPILOT_AGENTS) registerAgent(mod);
for (const mod of CHATBOT_AGENTS) registerAgent(mod);

const total = SINGLE.length + CLINICAL_WORKFLOW.length + SAFETY_AGENTS.length +
              TIME_SAVER_AGENTS.length + PATIENT_NOTIFY_AGENTS.length +
              BUSINESS_AGENTS.length + COPILOT_AGENTS.length + CHATBOT_AGENTS.length;

console.log(
  `[AI] ${total} ta agent ro'yxatdan o'tdi ` +
  `(${SINGLE.length} diktant + ${CLINICAL_WORKFLOW.length} klinika + ` +
  `${SAFETY_AGENTS.length} xavfsizlik + ${TIME_SAVER_AGENTS.length} vaqt tejash + ` +
  `${PATIENT_NOTIFY_AGENTS.length} bemor aloqasi + ${BUSINESS_AGENTS.length} biznes + ` +
  `${COPILOT_AGENTS.length} copilot + ${CHATBOT_AGENTS.length} chatbot)`
);
