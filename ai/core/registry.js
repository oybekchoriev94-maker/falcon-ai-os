// ============================================================
// Falcon AI OS — Agent registri
// Agentlar shu yerda ro'yxatdan o'tadi; runtime ularni shu yerdan oladi.
// ============================================================

const agents = new Map();

/**
 * Agent moduli talablari:
 *   name        {string}   — unikal nom
 *   description {string}
 *   version     {string}
 *   category    {string}   — clinical | logistics | analytics | referral | patient
 *   schema      {ZodType}  — input validatsiyasi (ixtiyoriy, lekin tavsiya etiladi)
 *   handler     {Function} — async (input, ctx) => data   |  ctx = { tenantId, db, user }
 *   timeoutMs   {number}   — ixtiyoriy
 */
export function registerAgent(mod) {
  if (!mod?.name || typeof mod.handler !== 'function') {
    console.warn('[REGISTRY] Yaroqsiz agent moduli o\'tkazib yuborildi:', mod?.name || '(nomsiz)');
    return;
  }
  if (agents.has(mod.name)) {
    console.warn(`[REGISTRY] "${mod.name}" agenti qayta ro'yxatdan o'tkazilmoqda`);
  }
  agents.set(mod.name, {
    name: mod.name,
    description: mod.description || '',
    version: mod.version || '1.0.0',
    category: mod.category || 'general',
    schema: mod.schema || null,
    handler: mod.handler,
    timeoutMs: mod.timeoutMs || null,
    loadedAt: new Date().toISOString(),
  });
}

export function getAgent(name) {
  return agents.get(name) || null;
}

export function getAllAgents() {
  return [...agents.values()];
}

export function getAgentCount() {
  return agents.size;
}

export function getAgentsByCategory(category) {
  return [...agents.values()].filter((a) => a.category === category);
}

export function searchAgents(query) {
  const q = String(query || '').toLowerCase();
  return [...agents.values()].filter(
    (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
  );
}
