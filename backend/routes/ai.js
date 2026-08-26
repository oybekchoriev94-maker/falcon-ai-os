// ============================================================
// BACKEND ROUTES — AI Orchestrator Agent tizimi
// AI agentlarni ishga tushirish, pipeline, transcribe, LLM, TTS
// ============================================================

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { safeError } from '../services/safe-error.js';
import { checkSubscription, checkAiLimit } from '../subscription-middleware.js';

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'AI so\'rovlar soni cheklangan, 1 daqiqa kuting' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  validate: { trustProxy: false },
});

export default function aiRoutes(db, authMiddleware, checkRole, validate, schemas, orchestrator) {
  const router = Router();
  const { transcribe, llm, speak } = orchestrator;

  // ─── GET /api/ai/status — orchestrator va agentlar holati ──────────
  router.get('/status', (req, res) => {
    res.json({ success: true, ...orchestrator.getSystemStatus() });
  });

  // ─── GET /api/ai/agents — barcha agentlar ro'yxati ────────────────
  router.get('/agents', (req, res) => {
    const { category, search } = req.query;
    let agents;
    if (category) agents = orchestrator.getAgentsByCategory(category);
    else if (search) agents = orchestrator.searchAgents(search);
    else agents = orchestrator.getAllAgents();
    res.json({ success: true, total: agents.length, agents });
  });

  // ─── GET /api/ai/agents/canonical — 12 kanonik agent xartiyasi ────
  router.get('/agents/canonical', authMiddleware, checkRole('admin', 'ceo'), (req, res) => {
    const registered = orchestrator.getAllAgents().map((a) => a.name);
    res.json({
      success: true,
      total: orchestrator.CANONICAL_AGENTS.length,
      coverage: orchestrator.getCanonicalCoverage(registered),
      agents: orchestrator.CANONICAL_AGENTS,
    });
  });

  // ─── POST /api/ai/execute — agentni ishga tushirish ───────────────
  router.post('/execute', aiLimiter, authMiddleware, checkRole('admin', 'doctor', 'ceo', 'receptionist'), checkSubscription, checkAiLimit, validate(schemas.aiExecute), async (req, res) => {
    try {
      const { agent, input } = req.body;
      const ctx = {
        tenantId: req.user?.tenant_id || req.tenant_id,
        user: req.user,
        requestId: req.correlationId || null,
      };
      const result = await orchestrator.executeAgent(agent, input || {}, ctx);
      res.status(result.success ? 200 : (result.code === 'AGENT_NOT_FOUND' ? 404 : 400)).json(result);
    } catch (e) { safeError(res, e); }
  });

  // ─── POST /api/ai/pipeline — ko'p agentli pipeline ────────────────
  router.post('/pipeline', aiLimiter, authMiddleware, checkRole('admin', 'ceo'), checkSubscription, checkAiLimit, validate(schemas.aiPipeline), async (req, res) => {
    try {
      const { steps } = req.body;
      const ctx = {
        tenantId: req.user?.tenant_id || req.tenant_id,
        user: req.user,
        requestId: req.correlationId || null,
      };
      const result = await orchestrator.executePipeline(steps, ctx);
      res.json(result);
    } catch (e) { safeError(res, e); }
  });

  // ─── GET /api/ai/logs — ijro loglari ───────────────────────────────
  router.get('/logs', authMiddleware, checkRole('admin'), (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    res.json({ success: true, logs: orchestrator.getExecutionLog(limit) });
  });

  // ─── POST /api/ai/transcribe — audio transkripsiya (Whisper) ──────
  router.post('/transcribe', authMiddleware, checkSubscription, checkAiLimit, async (req, res) => {
    try {
      if (!req.is('application/json')) return res.status(400).json({ error: 'JSON formatida yuboring' });
      const { audio_base64, language, filename } = req.body;
      if (!audio_base64) return res.status(400).json({ error: 'audio_base64 talab qilinadi' });
      const buffer = Buffer.from(audio_base64, 'base64');
      const result = await transcribe(buffer, filename || 'audio.webm', { language: language || 'uz' });
      res.json({ success: !result.error, ...result });
    } catch (e) { safeError(res, e); }
  });

  // ─── POST /api/ai/llm — pure LLM query ─────────────────────────────
  router.post('/llm', authMiddleware, checkSubscription, checkAiLimit, async (req, res) => {
    try {
      const { system_prompt, user_text, temperature, max_tokens } = req.body;
      if (!system_prompt || !user_text) return res.status(400).json({ error: 'system_prompt va user_text talab qilinadi' });
      const result = await llm(system_prompt, user_text, { temperature, maxTokens: max_tokens });
      res.json({ success: !result.error, result });
    } catch (e) { safeError(res, e); }
  });

  // ─── POST /api/ai/tts — matndan ovoz ──────────────────────────────
  router.post('/tts', authMiddleware, checkSubscription, checkAiLimit, async (req, res) => {
    try {
      const { text, voice, speed } = req.body;
      if (!text) return res.status(400).json({ error: 'text talab qilinadi' });
      const audio = await speak(text, { voice: voice || 'alloy', speed: speed || 1.0 });
      if (!audio) return res.status(503).json({ error: 'TTS mavjud emas (API_KEY)' });
      res.set('Content-Type', 'audio/mpeg');
      res.send(audio);
    } catch (e) { safeError(res, e); }
  });

  return router;
}
