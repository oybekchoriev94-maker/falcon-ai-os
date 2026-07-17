import { llm, llmStream, isLLMReady } from './engines/llm.js';
import { transcribe, translate, isSTTReady } from './engines/stt.js';
import { speak, speakStreaming, isTTSReady } from './engines/tts.js';
import { FalconTTSStreamer, agentTextToSpeech } from './engines/voice-streamer.js';
import { getAgent, getAllAgents, searchAgents, getAgentsByCategory, getAgentCount } from './agents/registry.js';
import { isReady as isDBReady, q, qGet, qExec, TABLES } from './agents/db.js';

export { getAgent, getAllAgents, searchAgents, getAgentsByCategory, getAgentCount, isLLMReady, isSTTReady, isTTSReady, llm, llmStream, transcribe, translate, speak, speakStreaming, FalconTTSStreamer, agentTextToSpeech, isDBReady, q, qGet, qExec, TABLES };

const EXECUTION_LOG = [];
const MAX_LOG = 100;

function log(ctx) {
  EXECUTION_LOG.unshift({ ...ctx, timestamp: new Date().toISOString() });
  if (EXECUTION_LOG.length > MAX_LOG) EXECUTION_LOG.length = MAX_LOG;
}

export function getExecutionLog(limit = 20) {
  return EXECUTION_LOG.slice(0, limit);
}

export async function executeAgent(agentName, input, context = {}) {
  const agent = getAgent(agentName);
  if (!agent) {
    log({ agent: agentName, status: 'error', error: 'Agent not found' });
    return { success: false, error: `"${agentName}" agenti topilmadi` };
  }

  const enrichedContext = {
    ...context,
    db: { isReady: isDBReady, q, qGet, qExec, tables: TABLES },
    __db_available: isDBReady()
  };

  const startTime = Date.now();
  try {
    const result = await agent.handler(input, { ...enrichedContext });
    const duration = Date.now() - startTime;
    log({ agent: agentName, status: 'success', duration, input: JSON.stringify(input).slice(0, 200) });
    return { success: true, agent: agentName, duration, data: result };
  } catch (e) {
    const duration = Date.now() - startTime;
    log({ agent: agentName, status: 'error', duration, error: e.message });
    return { success: false, error: e.message, agent: agentName };
  }
}

export async function executePipeline(steps) {
  const results = [];
  let context = {};

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const input = { ...(step.input || {}), ...context };
    const result = await executeAgent(step.agent, input, context);
    results.push({ step: i, agent: step.agent, result });

    if (!result.success && !step.optional) {
      return { success: false, completed: i, total: steps.length, results, error: `${step.agent} agentida xatolik: ${result.error}` };
    }

    if (result.success && result.data) {
      context = { ...context, ...result.data };
    }
  }

  return { success: true, total: steps.length, results, context };
}

export async function multiQuery(agentName, queries) {
  const results = [];
  for (const query of queries) {
    const result = await executeAgent(agentName, query);
    results.push(result);
  }
  return results;
}

export async function analyzeWithContext(agentName, primaryInput, contextSources = []) {
  const context = {};
  for (const source of contextSources) {
    if (source.agent) {
      const r = await executeAgent(source.agent, source.input || {});
      if (r.success) Object.assign(context, r.data);
    }
  }
  return await executeAgent(agentName, { ...primaryInput, _context: context });
}

export function getSystemStatus() {
  return {
    agents: getAgentCount(),
    agents_list: getAllAgents().map(a => ({ name: a.name, description: a.description, version: a.version })),
    database: isDBReady() ? 'connected' : 'disconnected',
    engines: {
      llm: isLLMReady() ? 'ready' : 'not_configured',
      stt: isSTTReady() ? 'ready' : 'not_configured',
      tts: isTTSReady() ? 'ready' : 'not_configured'
    },
    execution_log_count: EXECUTION_LOG.length,
    last_executions: getExecutionLog(5)
  };
}
