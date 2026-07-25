// ============================================================
// Falcon AI OS — Orkestrator
// Agentlar, LLM/STT/TTS dvigatellari uchun yagona kirish nuqtasi.
// ============================================================

import './agents/index.js'; // agentlarni registrga ulaydi

import { llm, llmStream, isLLMReady } from './engines/llm.js';
import { transcribe, translate, isSTTReady } from './engines/stt.js';
import { speak, speakStreaming, isTTSReady } from './engines/tts.js';
import { FalconTTSStreamer, agentTextToSpeech } from './engines/voice-streamer.js';

import { executeAgent, executePipeline, getExecutionLog, getSystemStatus as runtimeStatus } from './core/runtime.js';
import { getAgent, getAllAgents, getAgentCount, getAgentsByCategory, searchAgents } from './core/registry.js';
import { isLLMConfigured } from './core/tools.js';
import { getPool } from '../backend/db.js';

export {
  // Agentlar
  executeAgent,
  executePipeline,
  getExecutionLog,
  getAgent,
  getAllAgents,
  getAgentCount,
  getAgentsByCategory,
  searchAgents,
  // Dvigatellar
  llm,
  llmStream,
  isLLMReady,
  transcribe,
  translate,
  isSTTReady,
  speak,
  speakStreaming,
  isTTSReady,
  FalconTTSStreamer,
  agentTextToSpeech,
};

function isDBReady() {
  try { return !!getPool(); } catch { return false; }
}

export function getSystemStatus() {
  return {
    ...runtimeStatus(),
    database: isDBReady() ? 'connected' : 'disconnected',
    engines: {
      llm: isLLMConfigured() ? 'ready' : 'not_configured',
      stt: isSTTReady() ? 'ready' : 'not_configured',
      tts: isTTSReady() ? 'ready' : 'not_configured',
    },
  };
}
