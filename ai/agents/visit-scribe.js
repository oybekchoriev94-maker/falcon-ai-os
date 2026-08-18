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

export async function handler(input) {
  const spec = resolveSpecialization(input.specialty);
  // Yo'nalish shabloni bo'lsa — uni QO'SHAMIZ, almashtirmaymiz: shablon
  // yo'nalishga xos maydonlarni beradi, bizga esa qabul kartasining
  // umumiy maydonlari ham kerak.
  const specHint = spec && MEDICAL_SKILLS[spec]
    ? `\n\nShifokor yo'nalishi: ${MEDICAL_SKILLS[spec].label}. ` +
      "Shu yo'nalishga xos atamalarni to'g'ri yozing."
    : '';

  const result = await llmJson(
    BASE_PROMPT + specHint + NUMBER_RULE,
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

  return {
    fields: {
      complaints:      pick('complaints'),
      anamnesis:       pick('anamnesis'),
      objective:       pick('objective'),
      diagnosis:       pick('diagnosis'),
      procedure:       pick('procedure'),
      medicines:       pick('medicines'),
      recommendations: pick('recommendations'),
    },
    next_step: nextStep,
    raw_text: input.text,
    structured: true,
    specialty: spec || null,
  };
}
