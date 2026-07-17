// ============================================================
// Falcon AI OS — Receptionist Agent (Local Tool Calling)
// Ollama + Local STT → To'liq offline AI operator
// ============================================================

import { transcribe } from '../engines/stt.js';

export const name = 'receptionist';
export const description = '24/7 AI Voice Receptionist — shifokor grafigini tekshirib, jonli band qilish (Tool Calling)';
export const version = '3.0.0';

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

function isLocal() { return process.env.LOCAL_ONLY !== 'false'; }

// Ollama OpenAI-compatible API orqali tool calling
async function ollamaChat(messages, tools = null) {
  const body = {
    model: OLLAMA_MODEL,
    messages,
    options: { temperature: 0.1, num_predict: 2000 },
    stream: false
  };
  if (tools) body.tools = tools;

  const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message;
}

// Cloud fallback
async function cloudChat(messages, tools) {
  const key = process.env.GROQ_API_KEY;
  if (!key || key === '***') throw new Error('GROQ_API_KEY sozlanmagan');

  const body = {
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.1,
    max_tokens: 2000
  };
  if (tools) body.tools = tools;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return data.choices?.[0]?.message;
}

const TODAY = new Date().toISOString().slice(0, 10);

async function checkAvailability(args, db) {
  try {
    const { doctor_name, date } = args;
    if (!doctor_name || !date) return JSON.stringify({ success: false, error: 'doctor_name va date majburiy' });

    const doctor = db.qGet("SELECT id, name, department FROM doctors WHERE (name LIKE ? OR department LIKE ?) AND status = 'Faol' LIMIT 1", [`%${doctor_name}%`, `%${doctor_name}%`]);
    if (!doctor) return JSON.stringify({ success: false, error: `Kechirasiz, ${doctor_name} ismli shifokor yoki bunday bo'lim topilmadi.` });

    const dayNames = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
    const dayOfWeek = dayNames[new Date(date + 'T12:00:00').getDay()];
    const schedule = db.qGet("SELECT * FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ?", [doctor.id.toString(), dayOfWeek]);
    if (!schedule) return JSON.stringify({ success: false, error: `${doctor.name} ushbu kunda qabul qilmaydi.` });

    const booked = db.q("SELECT appointment_time FROM bookings WHERE doctor_id = ? AND appointment_date = ? AND status != 'Bekor qilingan'", [doctor.id.toString(), date]);
    const busySet = new Set(booked.map(b => b.appointment_time));

    const slots = [];
    let [sh, sm] = schedule.start_time.split(':').map(Number);
    let [eh, em] = schedule.end_time.split(':').map(Number);
    let cur = sh * 60 + sm;
    const end = eh * 60 + em;
    const dur = schedule.slot_duration || 30;
    while (cur + dur <= end) {
      const t = `${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`;
      if (!busySet.has(t)) slots.push(t);
      cur += dur;
    }

    return JSON.stringify({ success: true, doctor_id: doctor.id, doctor_name: doctor.name, department: doctor.department, available_slots: slots });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

async function confirmBooking(args, db) {
  try {
    const { doctor_id, patient_name, phone, date, time } = args;
    if (!doctor_id || !patient_name || !date || !time) {
      return JSON.stringify({ success: false, error: 'doctor_id, patient_name, date, time majburiy' });
    }

    const existing = db.qGet("SELECT id FROM bookings WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'Bekor qilingan'", [doctor_id.toString(), date, time]);
    if (existing) {
      return JSON.stringify({ success: false, error: 'Kechirasiz, ushbu vaqt hozirgina boshqa bemor tomonidan band qilindi.' });
    }

    const result = db.q(
      "INSERT INTO bookings (doctor_id, patient_name, appointment_date, appointment_time, status) VALUES (?, ?, ?, ?, 'Kutilmoqda')",
      [doctor_id.toString(), patient_name, date, time]
    );

    const aptId = 'APT-' + Date.now().toString(36).toUpperCase();
    db.q("INSERT INTO appointments (appointment_id, patient_name, phone, doctor_name, status, source) VALUES (?, ?, ?, ?, 'pending', 'voice_ai')",
      [aptId, patient_name, phone || '', `ID: ${doctor_id}`]);

    return JSON.stringify({ success: true, booking_id: result.lastInsertRowid, appointment_id: aptId, message: 'Muvaffaqiyatli band qilindi.' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

const agentToolsSchema = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: "Shifokorning nomi yoki bo'limi hamda berilgan sana bo'yicha bo'sh qabul vaqtlarini (slotlarini) tekshiradi.",
      parameters: {
        type: 'object',
        properties: {
          doctor_name: { type: 'string', description: "Shifokorning ismi yoki mutaxassisligi (masalan: Kardio, Dr. Umarov)" },
          date: { type: 'string', description: 'Qabul sanasi. Format: YYYY-MM-DD (masalan: 2026-06-15)' }
        },
        required: ['doctor_name', 'date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'confirm_booking',
      description: "Bemor roziligidan so'ng shifokor qabulini rasman tasdiqlaydi va bazaga yozadi.",
      parameters: {
        type: 'object',
        properties: {
          doctor_id: { type: 'integer', description: 'check_availability toolidan qaytgan doctor_id raqami' },
          patient_name: { type: 'string', description: "Bemorning ismi va familiyasi" },
          phone: { type: 'string', description: "Bemorning telefon raqami" },
          date: { type: 'string', description: 'Tasdiqlangan sana. Format: YYYY-MM-DD' },
          time: { type: 'string', description: 'Tasdiqlangan vaqt slot. Format: HH:MM (masalan: 14:30)' }
        },
        required: ['doctor_id', 'patient_name', 'phone', 'date', 'time']
      }
    }
  }
];

export const inputSchema = {
  text: { type: 'string', required: false, description: 'Bemor matni yoki transkripsiya' },
  audio: { type: 'buffer', required: false, description: 'Audio buffer' },
  history: { type: 'array', required: false, description: 'Suhbat tarixi (messages array)' },
  auto_register: { type: 'boolean', required: false, description: 'Avtomatik ro\'yxatga olish' }
};

export async function handler(input, context = {}) {
  const db = context.db;
  let text = input.text;
  let history = input.history || [];

  // Audio → Matn (STT)
  if (input.audio && !text) {
    const sttResult = await transcribe(input.audio, 'reception_audio.webm');
    if (sttResult.error) return { error: `Transkripsiya xatosi: ${sttResult.error}` };
    text = sttResult.text;
  }

  const messages = [
    {
      role: 'system',
      content: `Siz klinikaning professional, tezkor va aqlli ovozli AI operatorisiz. Bugun sana: ${TODAY}.
Vazifalaringiz:
1. Bemorga qisqa va aniq javob bering (ovozli muloqot bo'lgani uchun uzun matnlar taqiqlanadi, maksimal 2-3 ta qisqa gap).
2. Shifokor grafigini bilish uchun faqat 'check_availability' vositasidan foydalaning, o'zingizdan vaqt o'ylab topmang!
3. Bo'sh vaqt topilgach, bemorga variantlarni ayting, u tanlagach ism-sharifi va telefonini so'rab 'confirm_booking' ni chaqiring.
4. Har doim samimiy va o'zbek tilida gapiring.`
    },
    ...history
  ];

  if (text) messages.push({ role: 'user', content: text });

  try {
    // 1-QADAM: Local Ollama orqali tool calling
    const responseMessage = isLocal()
      ? await ollamaChat(messages, agentToolsSchema)
      : await cloudChat(messages, agentToolsSchema);

    if (!responseMessage) return { error: 'LLM dan javob olinmadi' };

    let updatedHistory = [...messages, responseMessage];

    // 2-QADAM: Agar tool call bo'lsa, bajaramiz
    if (responseMessage.tool_calls?.length > 0) {
      for (const toolCall of responseMessage.tool_calls) {
        const fnName = toolCall.function.name;
        const fnArgs = JSON.parse(toolCall.function.arguments);
        let toolResult = '';

        if (fnName === 'check_availability') toolResult = await checkAvailability(fnArgs, db);
        else if (fnName === 'confirm_booking') toolResult = await confirmBooking(fnArgs, db);

        updatedHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: fnName,
          content: toolResult
        });
      }

      // 3-QADAM: Tool natijalari bilan LLM ga qayta so'rov
      const secondResponse = isLocal()
        ? await ollamaChat(updatedHistory)
        : await cloudChat(updatedHistory);

      if (secondResponse) {
        updatedHistory.push(secondResponse);
        return {
          text: secondResponse.content,
          updatedHistory,
          tool_calls_used: responseMessage.tool_calls.map(tc => tc.function.name)
        };
      }
    }

    return { text: responseMessage.content, updatedHistory, tool_calls_used: [] };
  } catch (e) {
    return { error: `AI Receptionist xatosi: ${e.message}` };
  }
}
