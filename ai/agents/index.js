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

console.log(`[AI] ${ALL.length} ta agent ro'yxatdan o'tdi`);
