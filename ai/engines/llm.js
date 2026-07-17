// ============================================================
// Falcon AI OS — Local LLM Engine (Ollama + Fallback Cloud)
// RTX 5070 12GB → Qwen 2.5 7B (Q8_0) @ http://localhost:11434
// ============================================================

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function groqKey() { return (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== '***') ? process.env.GROQ_API_KEY : ''; }
function isLocal() { return process.env.LOCAL_ONLY !== 'false'; }

// ─── Asosiy LLM chaqiruvi ─────────────────────────────────
export async function llm(systemPrompt, userText, options = {}) {
  // 1-URINISH: Lokal Ollama
  if (isLocal()) {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText }
          ],
          options: {
            temperature: options.temperature ?? 0.1,
            num_predict: options.maxTokens ?? 1000
          },
          stream: false
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      const content = data.message?.content || '';

      // JSON extract (agentlar JSON formatda qaytaradi)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return content;
    } catch (e) {
      if (process.env.LOCAL_ONLY === 'true') {
        return { error: `Lokal LLM xatosi: ${e.message}. Ollama ishlayotganiga ishonch hosil qiling.` };
      }
      // Fallback cloud ga
      console.warn(`[LLM] Ollama mavjud emas (${e.message}), cloud ga o'tilmoqda...`);
    }
  }

  // 2-URINISH: Cloud (GROQ / OpenCode)
  const key = groqKey();
  if (!key) return { error: 'LLM API kaliti sozlanmagan. Ollama yoki GROQ_API_KEY kerak.' };

  const url = 'https://api.groq.com/openai/v1/chat/completions';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText }
        ],
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 1000
      })
    });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return content;
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Streaming LLM ───────────────────────────────────────
export async function llmStream(systemPrompt, userText, onToken) {
  // Lokal Ollama streaming
  if (isLocal()) {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText }
          ],
          options: { temperature: 0.1, num_predict: 2000 },
          stream: true
        }),
        signal: AbortSignal.timeout(30000)
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const token = parsed.message?.content || '';
            if (token && onToken) onToken(token);
          } catch { /* ignore partial lines */ }
        }
      }
      return;
    } catch (e) {
      if (process.env.LOCAL_ONLY === 'true') throw new Error(`Lokal LLM xatosi: ${e.message}`);
      console.warn(`[LLM] Ollama streaming mavjud emas, cloud ga o'tilmoqda...`);
    }
  }

  // Fallback: Cloud streaming
  const key = groqKey();
  if (!key) throw new Error('LLM API kaliti sozlanmagan');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: GROQ_MODEL, stream: true,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
      temperature: 0.1, max_tokens: 2000
    })
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content || '';
        if (token && onToken) onToken(token);
      } catch { }
    }
  }
}

export function isLLMReady() {
  // Ollama mavjudligini tekshirish
  if (isLocal()) return true; // optimistic — runtime da tekshiriladi
  return !!groqKey();
}
