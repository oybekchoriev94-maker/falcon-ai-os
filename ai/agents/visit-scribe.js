// ============================================================
// FALCON AI OS — "visit-scribe" agenti
//
// ROL: shifokor qabulida aytilgan erkin diktantni ko'rik kartasining
// maydonlariga ajratadi (shikoyat, tashxis, muolaja, dori, tavsiya).
//
// NEGA ALOHIDA AGENT, `medical-scribe` YETARLI EMASMI:
// `medical-scribe` mustaqil hisobot yozadi va o'z yozuvini bazaga
// tushiradi. Qabul oqimida esa yozuvni /visit/:id/complete yozadi —
// ikkalasi ishlasa BITTA tashrifga IKKITA karta yoziladi. Shuning uchun
// bu agent faqat MATNNI TUZADI, bazaga hech narsa yozmaydi. Yozuvni
// shifokor tasdiqlagandan keyin bitta joy yozadi.
//
// AI QAROR QILMAYDI: natija shifokorga TAKLIF sifatida ko'rsatiladi,
// u tahrirlab tasdiqlaydi. Hech qanday maydon avtomatik saqlanmaydi.
// ============================================================

import { z } from 'zod';
import { llmJson } from '../core/tools.js';
import { MEDICAL_SKILLS, resolveSpecialization } from '../protocols/medical-skills.js';

// Whisper sonlarni so'z bilan chiqaradi ("qirq besh") — bosim, harorat,
// doza raqamda bo'lishi shart, aks holda kartada "o'ttiz yetti nuqta besh"
// deb qoladi va keyin hech qanday tahlil qila olmaymiz.
const NUMBER_RULE =
  "\nMUHIM: barcha sonlarni RAQAMLARDA yozing, so'z bilan emas. " +
  "\"qirq besh\" -> 45, \"o'ttiz yetti nuqta besh\" -> 37.5, \"yuz yigirma\" -> 120.";

const BASE_PROMPT =
  "Siz tajribali shifokorning yordamchisisiz. Sizga shifokor qabul vaqtida " +
  "aytgan erkin diktant beriladi (o'zbek yoki rus tilida — ikkalasini ham tushunasiz). " +
  "Uni ko'rik kartasi maydonlariga ajrating va FAQAT JSON qaytaring:\n" +
  '{"complaints":"bemor shikoyatlari","anamnesis":"kasallik tarixi",' +
  '"objective":"ob\'ektiv ko\'rik","diagnosis":"tashxis",' +
  '"procedure":"bajarilgan yoki buyurilgan muolaja","medicines":"buyurilgan dorilar, dozasi bilan",' +
  '"recommendations":"tavsiyalar","next_step":"home|labs|admission|referral"}\n' +
  "QAT'IY QOIDA: diktantda aytilmagan narsani O'YLAB TOPMANG. Ma'lumot bo'lmasa " +
  "maydonni bo'sh satr (\"\") qoldiring. Bu tibbiy hujjat — to'qilgan ma'lumot zarar keltiradi.";

export const name = 'visit-scribe';
export const description =
  "Shifokor qabulidagi ovozli diktantni ko'rik kartasi maydonlariga ajratadi (taklif sifatida).";
export const version = '1.0.0';
export const category = 'clinical';
export const timeoutMs = 30000;

export const schema = z.object({
  text: z.string().min(3, "Diktant matni juda qisqa").max(20000),
  // Shifokor yo'nalishi — mavjud bo'lsa o'sha yo'nalish shabloni qo'llanadi
  specialty: z.string().max(50).nullable().optional(),
  patient_name: z.string().max(200).nullable().optional(),
});

// Qabul kartasining umumiy maydonlari — yo'nalishdan qat'i nazar kerak
const COMMON_KEYS = ['complaints', 'anamnesis', 'objective', 'diagnosis',
                     'procedure', 'medicines', 'recommendations'];

export async function handler(input) {
  const spec = resolveSpecialization(input.specialty);
  const skill = spec ? MEDICAL_SKILLS[spec] : null;

  // Yo'nalish shabloni bo'lsa — uning TO'LIQ promptidan foydalanamiz.
  //
  // Ilgari bu yerda faqat shablon NOMI ("👶 Reproduktolog") ko'rsatma
  // sifatida qo'shilardi. Natijada yo'nalishga xos o'lchovlar
  // (follikulometriya, endometriy, AMH/FSH, sikl kuni) alohida
  // ajratilmay, hammasi umumiy "Tashxis/Izoh" ga tushib ketardi —
  // ya'ni shablonlar mavjud bo'lsa-da, ovozli ko'rikda ishlatilmasdi.
  //
  // BITTA chaqiruv: shablon prompti + umumiy kalitlar talabi. Ikkinchi
  // chaqiruv qo'shilsa javob vaqti ikki barobar oshardi.
  const prompt = skill
    ? skill.systemPrompt +
      "\n\nQO'SHIMCHA: yuqoridagi kalitlar bilan BIRGA quyidagilarni ham " +
      "qaytaring (yo'q bo'lsa bo'sh satr): " + COMMON_KEYS.join(', ') + ", next_step. " +
      "next_step qiymati: home | labs | admission | referral.\n" +
      "Diktant o'zbek yoki rus tilida bo'lishi mumkin — JSON kalitlarini " +
      "O'ZGARTIRMANG.\n" +
      "QAT'IY QOIDA: diktantda aytilmagan narsani O'YLAB TOPMANG — bo'sh " +
      "qoldiring. Bu tibbiy hujjat."
    : BASE_PROMPT;

  const result = await llmJson(
    prompt + NUMBER_RULE,
    input.patient_name ? `Bemor: ${input.patient_name}\n\nDiktant:\n${input.text}` : input.text,
    { timeoutMs: 25000 }
  );

  if (!result || typeof result !== 'object') {
    // LLM ishlamasa ham diktant YO'QOLMASLIGI kerak — shifokor xom matnni
    // ko'radi va o'zi to'ldiradi. Bu xato emas, chegaralangan natija.
    return {
      fields: {}, raw_text: input.text, structured: false,
      note: "AI matnni ajrata olmadi — diktant xom holicha saqlandi, maydonlarni qo'lda to'ldiring.",
    };
  }

  const pick = (k) => String(result[k] ?? '').trim();
  const nextStep = ['home', 'labs', 'admission', 'referral'].includes(result.next_step)
    ? result.next_step
    : null;

  const fields = {};
  for (const k of COMMON_KEYS) fields[k] = pick(k);

  // Yo'nalishga xos maydonlar alohida qaytadi — interfeys ularni
  // shablon tartibida chizadi. Obyekt tipidagilar (masalan urologda
  // `kidneys`, reproduktologda `hormones`) matnga aylantirilmaydi:
  // ular tuzilgan holida saqlanadi.
  const specialty_fields = {};
  if (skill?.fields?.length) {
    for (const f of skill.fields) {
      const v = result[f.key];
      if (v === undefined || v === null || v === '') continue;
      // Umumiy maydon shablonda ham bo'lsa (masalan `diagnosis`) —
      // ikki marta ko'rsatmaymiz, u yuqorida allaqachon bor.
      if (COMMON_KEYS.includes(f.key)) continue;
      specialty_fields[f.key] = typeof v === 'object' ? v : String(v).trim();
    }
  }

  return {
    fields,
    specialty_fields,
    // Interfeys maydonlarni shablon tartibi va yorliqlari bilan chizishi uchun
    specialty_schema: skill?.fields?.filter((f) => !COMMON_KEYS.includes(f.key)) || [],
    next_step: nextStep,
    raw_text: input.text,
    structured: true,
    specialty: spec || null,
    specialty_label: skill?.label || null,
  };
}
