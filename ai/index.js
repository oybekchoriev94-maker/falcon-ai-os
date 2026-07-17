import { getAgent, getAllAgents, searchAgents, getAgentsByCategory, getAgentCount } from './agents/registry.js';
import { executeAgent, executePipeline, getExecutionLog, multiQuery, analyzeWithContext, getSystemStatus } from './orchestrator.js';
import { llm, llmStream, isLLMReady } from './engines/llm.js';
import { transcribe, translate, isSTTReady } from './engines/stt.js';
import { speak, speakStreaming, isTTSReady } from './engines/tts.js';

export default {
  getAgent, getAllAgents, searchAgents, getAgentsByCategory, getAgentCount,
  executeAgent, executePipeline, getExecutionLog, multiQuery, analyzeWithContext, getSystemStatus,
  llm, llmStream, isLLMReady,
  transcribe, translate, isSTTReady,
  speak, speakStreaming, isTTSReady
};
