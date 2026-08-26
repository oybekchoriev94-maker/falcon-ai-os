// ============================================================
// Falcon AI OS — Agent Runtime
//
// Har bir agent ijrosi shu yerdan o'tadi:
//   tenant konteksti → input validatsiya → timeout → metering → tuzilgan natija
// ============================================================

import { createTenantDb } from './db-context.js';
import { getAgent, getAllAgents, getAgentCount } from './registry.js';
import { canonicalForAgent, CANONICAL_AGENTS } from './canonical.js';

const DEFAULT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || '45000');
const MAX_LOG = 100;
const EXECUTION_LOG = [];

function log(entry) {
  EXECUTION_LOG.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (EXECUTION_LOG.length > MAX_LOG) EXECUTION_LOG.length = MAX_LOG;
}

export function getExecutionLog(limit = 20) {
  return EXECUTION_LOG.slice(0, limit);
}

function fail(agent, code, error, meta = {}) {
  return { success: false, agent, code, error, ...meta };
}

async function withTimeout(promise, ms, agentName) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`"${agentName}" agenti ${ms / 1000}s ichida javob bermadi`), { code: 'AGENT_TIMEOUT' })), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** AI ishlatilishini tenant bo'yicha hisobga olish (SaaS billing uchun) */
async function meterUsage(db, agentName) {
  try {
    await db.qExec(
      `INSERT INTO usage_metering (tenant_id, metric, count, date)
       VALUES ($1, 'ai_requests', 1, CURRENT_DATE)
       ON CONFLICT (tenant_id, metric, date) DO UPDATE SET count = usage_metering.count + 1`,
      [db.tenantId]
    );
  } catch (e) {
    // Metering asosiy ishni buzmasligi kerak
    console.warn(`[AGENT] Metering xatosi (${agentName}):`, e.message);
  }
}

/** Agent qaysi kanonik agentga tegishli ekanini aniqlaydi */
function resolveCanonical(agentName, agent) {
  if (agent?.canonical) return agent.canonical;
  return canonicalForAgent(agentName)?.id || null;
}

/**
 * Doimiy audit: har ijro agent_executions jadvaliga yoziladi.
 * Best-effort — audit xatosi agent natijasiga ta'sir qilmasligi kerak.
 */
async function persistAudit(db, { agentName, canonicalId, status, code, durationMs, user, requestId, error }) {
  try {
    await db.qExec(
      `INSERT INTO agent_executions
         (tenant_id, agent, canonical_id, status, code, duration_ms, user_id, request_id, error_summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        db.tenantId,
        agentName,
        canonicalId,
        status,
        code || null,
        durationMs ?? null,
        user?.id || null,
        requestId || null,
        error ? String(error).slice(0, 500) : null,
      ]
    );
  } catch (e) {
    console.warn(`[AGENT] Audit xatosi (${agentName}):`, e.message);
  }
}

/**
 * Agentni ishga tushirish.
 *
 * @param {string} agentName
 * @param {Object} input
 * @param {Object} ctx           - { tenantId, user, requestId }
 * @returns {Promise<{success, agent, data?, error?, code?, duration_ms}>}
 */
export async function executeAgent(agentName, input = {}, ctx = {}) {
  const started = Date.now();
  const tenantId = ctx.tenantId || ctx.tenant_id;

  const agent = getAgent(agentName);
  if (!agent) {
    log({ agent: agentName, status: 'error', error: 'not_found' });
    return fail(agentName, 'AGENT_NOT_FOUND', `"${agentName}" agenti topilmadi`);
  }

  if (!tenantId) {
    log({ agent: agentName, status: 'error', error: 'no_tenant' });
    return fail(agentName, 'TENANT_REQUIRED', 'Agent ijrosi uchun klinika (tenant) konteksti majburiy');
  }

  // Input validatsiyasi (zod sxemasi bo'lsa)
  let validInput = input;
  if (agent.schema?.safeParse) {
    const parsed = agent.schema.safeParse(input);
    if (!parsed.success) {
      const details = parsed.error.flatten().fieldErrors;
      log({ agent: agentName, status: 'error', error: 'validation' });
      return fail(agentName, 'VALIDATION_ERROR', 'Kiritilgan ma\'lumot noto\'g\'ri', { details });
    }
    validInput = parsed.data;
  }

  const db = createTenantDb(tenantId);
  const canonicalId = resolveCanonical(agentName, agent);
  const agentCtx = {
    tenantId,
    db,
    user: ctx.user || null,
    requestId: ctx.requestId || null,
    canonical: canonicalId,
  };

  try {
    const data = await withTimeout(
      Promise.resolve(agent.handler(validInput, agentCtx)),
      agent.timeoutMs || DEFAULT_TIMEOUT_MS,
      agentName
    );

    // Agent o'zi xato qaytargan bo'lsa (handler ichida { error: ... })
    if (data && typeof data === 'object' && data.error && Object.keys(data).length <= 2) {
      const duration_ms = Date.now() - started;
      log({ agent: agentName, status: 'error', duration: duration_ms, error: data.error, tenant: tenantId });
      await persistAudit(db, { agentName, canonicalId, status: 'error', code: data.code || 'AGENT_ERROR', durationMs: duration_ms, user: ctx.user, requestId: ctx.requestId, error: data.error });
      return fail(agentName, data.code || 'AGENT_ERROR', data.error, { duration_ms });
    }

    await meterUsage(db, agentName);
    const duration_ms = Date.now() - started;
    log({ agent: agentName, status: 'success', duration: duration_ms, tenant: tenantId });
    await persistAudit(db, { agentName, canonicalId, status: 'success', durationMs: duration_ms, user: ctx.user, requestId: ctx.requestId });
    return { success: true, agent: agentName, data, duration_ms };
  } catch (e) {
    const duration_ms = Date.now() - started;
    log({ agent: agentName, status: 'error', duration: duration_ms, error: e.message, tenant: tenantId });
    await persistAudit(db, { agentName, canonicalId, status: 'error', code: e.code || 'AGENT_EXCEPTION', durationMs: duration_ms, user: ctx.user, requestId: ctx.requestId, error: e.message });
    return fail(agentName, e.code || 'AGENT_EXCEPTION', e.message, { duration_ms });
  }
}

/**
 * Bir nechta agentni ketma-ket ishga tushirish; oldingi natija keyingisiga kontekst bo'ladi.
 */
export async function executePipeline(steps, ctx = {}) {
  const results = [];
  let carried = {};

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const input = { ...(step.input || {}), ...carried };
    const result = await executeAgent(step.agent, input, ctx);
    results.push({ step: i, agent: step.agent, result });

    if (!result.success && !step.optional) {
      return {
        success: false, completed: i, total: steps.length, results,
        error: `${step.agent} agentida xatolik: ${result.error}`,
      };
    }
    if (result.success && result.data && typeof result.data === 'object') {
      carried = { ...carried, ...result.data };
    }
  }

  return { success: true, total: steps.length, results, context: carried };
}

export function getSystemStatus() {
  return {
    agents: getAgentCount(),
    canonical_agents: CANONICAL_AGENTS.length,
    agents_list: getAllAgents().map((a) => ({ name: a.name, description: a.description, version: a.version, canonical: resolveCanonical(a.name, a) })),
    execution_log_count: EXECUTION_LOG.length,
    last_executions: getExecutionLog(5),
  };
}
