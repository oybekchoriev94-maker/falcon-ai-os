// ============================================================
// Falcon AI OS — Agentlar uchun tool-calling qatlami
//
// LLM vositalarni (funksiyalarni) chaqira oladi: model qaysi vositani
// qanday argumentlar bilan chaqirishni aytadi, biz uni bajarib, natijani
// modelga qaytaramiz va yakuniy javobni olamiz.
// ============================================================

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

function groqKey() {
  const k = process.env.GROQ_API_KEY;
  return k && k !== '***' ? k : '';
}
function useLocalLLM() {
  return process.env.LLM_LOCAL === 'true' || (process.env.LLM_LOCAL === undefined && process.env.LOCAL_ONLY === 'true');
}

async function chat(messages, tools, { temperature = 0.1, maxTokens = 1500, timeoutMs = 30000 } = {}) {
  if (useLocalLLM()) {
    try {
      const body = { model: OLLAMA_MODEL, messages, options: { temperature, num_predict: maxTokens }, stream: false };
      if (tools) body.tools = tools;
      const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      return data.choices?.[0]?.message || null;
    } catch (e) {
      console.warn(`[TOOLS] Lokal LLM mavjud emas (${e.message}), cloud ga o'tilmoqda...`);
    }
  }

  const key = groqKey();
  if (!key) throw new Error('LLM sozlanmagan: GROQ_API_KEY yoki lokal Ollama kerak');

  const body = { model: GROQ_MODEL, messages, temperature, max_tokens: maxTokens };
  if (tools) body.tools = tools;

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'LLM xatosi');
  return data.choices?.[0]?.message || null;
}

/**
 * Tool-calling sikli: model vosita chaqirsa — bajaramiz, natijani qaytaramiz.
 *
 * @param {Object} opts
 * @param {Array}  opts.messages       - suhbat (system + user + tarix)
 * @param {Array}  opts.tools          - OpenAI formatidagi tool ta'riflari
 * @param {Object} opts.handlers       - { toolName: async (args) => natija }
 * @param {number} [opts.maxRounds=3]  - takrorlanish chegarasi (cheksiz siklga qarshi)
 * @returns {{ text: string, toolCalls: string[], messages: Array }}
 */
export async function runToolLoop({ messages, tools, handlers, maxRounds = 3, ...llmOpts }) {
  const history = [...messages];
  const usedTools = [];

  for (let round = 0; round < maxRounds; round++) {
    const reply = await chat(history, tools, llmOpts);
    if (!reply) throw new Error('LLM dan javob olinmadi');
    history.push(reply);

    const calls = reply.tool_calls || [];
    if (calls.length === 0) {
      return { text: reply.content || '', toolCalls: usedTools, messages: history };
    }

    for (const call of calls) {
      const fnName = call.function?.name;
      const handler = handlers[fnName];
      usedTools.push(fnName);

      let result;
      if (!handler) {
        result = { success: false, error: `Noma'lum vosita: ${fnName}` };
      } else {
        try {
          const args = typeof call.function.arguments === 'string'
            ? JSON.parse(call.function.arguments || '{}')
            : (call.function.arguments || {});
          result = await handler(args);
        } catch (e) {
          result = { success: false, error: e.message };
        }
      }

      history.push({
        role: 'tool',
        tool_call_id: call.id,
        name: fnName,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  }

  // Chegara tugadi — oxirgi javobni matn sifatida qaytaramiz
  const last = history[history.length - 1];
  return { text: last?.content || '', toolCalls: usedTools, messages: history, truncated: true };
}

/**
 * Oddiy LLM chaqiruvi (vositasiz), JSON qaytarishga moslashtirilgan.
 */
export async function llmJson(systemPrompt, userText, opts = {}) {
  const reply = await chat(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
    null,
    opts
  );
  const content = reply?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* matn sifatida qaytaramiz */ }
  }
  return content;
}

export function isLLMConfigured() {
  return !!groqKey() || useLocalLLM();
}
