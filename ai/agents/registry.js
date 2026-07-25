import * as medicalScribe from './medical-scribe.js';
import * as receptionist from './receptionist.js';
import * as inventoryManager from './inventory-manager.js';
import * as analyticsAgent from './analytics-agent.js';
import * as b2bReferral from './b2b-referral.js';
import * as medicationCoach from './medication-coach.js';
import * as referralAgent from './referral-agent.js';

const agents = {};

function register(agentModule) {
  if (!agentModule.name || !agentModule.handler) {
    console.warn(`[REGISTRY] Skipping invalid agent module`);
    return;
  }
  agents[agentModule.name] = {
    name: agentModule.name,
    description: agentModule.description || '',
    version: agentModule.version || '1.0.0',
    handler: agentModule.handler,
    inputSchema: agentModule.inputSchema || {},
    loadedAt: new Date().toISOString()
  };
}

register(medicalScribe);
register(receptionist);
register(inventoryManager);
register(analyticsAgent);
register(b2bReferral);
register(medicationCoach);
register(referralAgent);

export function getAgent(name) {
  if (!agents[name]) return null;
  return agents[name];
}

export function getAllAgents() {
  return Object.values(agents);
}

export function getAgentsByCategory(category) {
  const categories = {
    clinical: ['medical-scribe', 'receptionist'],
    logistics: ['inventory-manager'],
    analytics: ['analytics-agent'],
    referral: ['b2b-referral', 'referral-agent'],
    patient: ['medication-coach']
  };
  const names = categories[category] || [];
  return names.map(n => agents[n]).filter(Boolean);
}

export function searchAgents(query) {
  const q = query.toLowerCase();
  return Object.values(agents).filter(a =>
    a.name.toLowerCase().includes(q) ||
    a.description.toLowerCase().includes(q)
  );
}

export function getAgentCount() {
  return Object.keys(agents).length;
}

console.log(`[AI REGISTRY] ${Object.keys(agents).length} agents registered`);
