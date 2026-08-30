// ============================================================
// FALCON AI OS — Bemor bilan aloqa agentlari (Bosqich O)
//
// Bemorni ushlab qoladigan avtomatik xabarnomalar. AI faqat mos matnni
// tayyorlaydi (shifokor/bo'lim nomiga qarab tabiiy tilda). Yuborish esa
// notifications servisi orqali (Telegram/SMS).
//
// ROL: agent MATN yaratadi. Real yuborish backend servisi. Bemor doim
// javob berishi mumkin — javob keyingi bosqichda konversatsiya agentiga
// ulanadi.
//
// PRIVACY: xabarda tashxis/dori nomlari yozilmaydi — faqat harakat
// ko'rsatmasi ("natijangiz tayyor, kartani ko'ring", "ertaga soat 10:00
// Aliyevga"). Klinik ma'lumot faqat kartada.
// ============================================================

import { z } from 'zod';

// Sanani formatlash — tabiiy uzbek tilida
function fmtDate(iso, tz = 'Asia/Tashkent') {
  const d = new Date(iso);
  return d.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', timeZone: tz });
}
function fmtTime(iso, tz = 'Asia/Tashkent') {
  const d = new Date(iso);
  return d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: tz });
}
function fmtWeekday(iso, tz = 'Asia/Tashkent') {
  const wd = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];
  const d = new Date(iso);
  // toLocale ni JS'da weekday-ga ishonish qiyin — o'zimiz beramiz (Tashkent = UTC+5)
  return wd[d.getUTCDay()];
}

// ============================================================
// 1) APPOINTMENT REMINDER (24h yoki 2h oldin)
// ============================================================
export const appointmentReminder = {
  name: 'appointment-reminder',
  metered: false,   // shablon matni, LLM yo'q
  description: 'Bemor bronidan N soat oldin Telegram xabar matni.',
  version: '1.0.0',
  category: 'patient_notify',
  schema: z.object({
    clinic_name: z.string(),
    doctor_name: z.string(),
    doctor_spec: z.string().nullable().optional(),
    service_name: z.string().nullable().optional(),
    scheduled_at: z.string(),
    hours_before: z.number().int().min(1).max(72),
    clinic_address: z.string().nullable().optional(),
  }),

  handler(input) {
    const dateStr = fmtDate(input.scheduled_at);
    const timeStr = fmtTime(input.scheduled_at);
    const isToday = new Date(input.scheduled_at).toDateString() === new Date().toDateString();
    const whenPart = isToday
      ? `Bugun soat ${timeStr}`
      : `${dateStr} (${fmtWeekday(input.scheduled_at)}) soat ${timeStr}`;

    const specPart = input.doctor_spec ? ` (${input.doctor_spec})` : '';
    const svcPart = input.service_name ? `\n📋 Xizmat: ${input.service_name}` : '';
    const addrPart = input.clinic_address ? `\n📍 ${input.clinic_address}` : '';

    return {
      message:
        `🔔 *${input.clinic_name}* eslatmasi\n\n` +
        `👨‍⚕️ Shifokor: ${input.doctor_name}${specPart}\n` +
        `🕐 Vaqt: ${whenPart}${svcPart}${addrPart}\n\n` +
        `Iltimos, tashrifga 10 daqiqa oldin keling. ` +
        `Bekor qilish yoki ko'chirish kerak bo'lsa qabulxonaga qo'ng'iroq qiling.`,
    };
  },
};

// ============================================================
// 2) LAB RESULT READY
// ============================================================
export const labResultReady = {
  name: 'lab-result-ready',
  metered: false,   // shablon matni, LLM yo'q
  description: 'Bemorga laborator natija tayyor bo\'lganini xabar qiladi.',
  version: '1.0.0',
  category: 'patient_notify',
  schema: z.object({
    clinic_name: z.string(),
    test_name: z.string(),
    patient_name: z.string(),
    result_url: z.string().optional(),
  }),

  handler(input) {
    const linkPart = input.result_url ? `\n\n🔗 Natijani ko'rish: ${input.result_url}` : '';
    return {
      message:
        `✅ *${input.clinic_name}*\n\n` +
        `Hurmatli ${input.patient_name},\n` +
        `Sizning *${input.test_name}* natijangiz tayyor.${linkPart}\n\n` +
        `Batafsil izoh uchun davolovchi shifokoringizga murojaat qiling.`,
    };
  },
};

// ============================================================
// 3) FOLLOW-UP (chiqarilgach 7 kun keyin)
// ============================================================
export const followUpScheduler = {
  name: 'follow-up-scheduler',
  metered: false,   // shablon matni, LLM yo'q
  description: 'Statsionardan chiqqan bemorga 7 kun keyin kuzatuv xabari.',
  version: '1.0.0',
  category: 'patient_notify',
  schema: z.object({
    clinic_name: z.string(),
    patient_name: z.string(),
    doctor_name: z.string().optional(),
    diagnosis_final: z.string().optional(),
  }),

  handler(input) {
    return {
      message:
        `💚 *${input.clinic_name}*\n\n` +
        `Hurmatli ${input.patient_name},\n` +
        `Klinikadan chiqqaningizga 7 kun bo'ldi. Sog'lig'ingiz qanday?\n\n` +
        `Agar ahvolingiz yaxshi bo'lsa — ajoyib! ` +
        `Yangi shikoyat yoki asorat bo'lsa, iltimos ${input.doctor_name || 'davolovchi shifokoringiz'}ga ` +
        `murojaat qiling yoki qabulxonaga qo'ng'iroq qiling.\n\n` +
        `Sog'liq va omad tilaymiz!`,
    };
  },
};

// ============================================================
// 4) PREPARATION INSTRUCTOR — tekshiruv oldi yo'riqnoma
// ============================================================
const PREP_INSTRUCTIONS = {
  blood_general: 'Ertalab och qoringa keling. 12 soat oldin ovqat yemang, faqat suv iching.',
  urine_general: 'Ertalab birinchi peshob keltiring (steril idishda). Yigishdan avval tashqi jinsiy azolarni yuving.',
  biochemistry:  '12 soat och qoringa. Testdan avval kofe, chay, tamaki ishlatmang.',
  coagulogram:   'Och qoringa. Antikoagulyant dorilar (warfarin, aspirin) haqida shifokoringizga ayting.',
  ekg:           'Testdan 2 soat oldin kofe, chay, spirtli ichimlik ichmang. Yengil kiyimda keling.',
  xray:          'Metall taqinchoq, tugma, zip yechiladi. Bo\'yin xochi va zanjir olinadi.',
  ultrasound:    'Qorin UZI uchun 6 soat och qoringa. Kichik chanoq UZI uchun 1 litr suv iching (1 soat oldin).',
  egds:          'Kamida 8 soat och qoringa. Suv 4 soat oldin to\'xtatiladi. Yumshoq to\'kiladigan tishlar olinadi.',
  ct_mri:        'Kontrast bolsa 4 soat och qoringa. Metall buyumlar (soat, karta, telefon) olinadi.',
  consult:       'Avvalgi tekshiruv natijalari va dori ro\'yxati bilan keling.',
};

export const PATIENT_NOTIFY_AGENTS = [appointmentReminder, labResultReady, followUpScheduler];
