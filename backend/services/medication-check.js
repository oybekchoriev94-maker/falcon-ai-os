// ============================================================
// Falcon AI OS — Dori/doza tekshiruvi (roadmap PR #7)
//
// Yo'l xarita talabi: "dori nomi, doza va raqamlarni alohida tekshirish".
// LLM diktantdagi dorilarni ajratadi, LEKIN bu modul ularni DETERMINISTIK
// qayta tekshiradi — model ishonchsiz joyda kod to'xtatadi:
//
//   - nomi yo'q dori → shifokor ko'rmay turib kartaga tushmasin;
//   - dozasi yo'q dori → "nima uchun" deb ogohlantirish;
//   - dozada raqam yo'q → transkripsiya dozani buzgan bo'lishi mumkin;
//   - g'aroyib katta son → telefon/narx dozaga aralashib ketgan bo'lishi
//     mumkin (Whisper raqamlarni ba'zan kontekst bilan adashtiradi).
//
// AI hech qachon o'zi dorini tasdiqlamaydi — bu faqat shifokorga
// ko'rsatiladigan ogohlantirish ro'yxati (human-in-the-loop).
// ============================================================

// Dozadagi raqam: "500 mg", "10 ml", "25 tomchi", "0.5 tabletka"
const DOSE_NUMBER_RE = /\d+(?:[.,]\d+)?/;
// Doza uchun oqilona yuqori chegara — bundan katta son odatda doza emas
// (narx, telefon yoki transkripsiya xatosi).
const MAX_PLAUSIBLE_DOSE_VALUE = 10000;

function normalizeEntries(result) {
  // Yangi format: medications: [{name, dose, frequency}]
  if (Array.isArray(result?.medications)) {
    return result.medications.map((m) => {
      if (typeof m === 'string') return { name: m, dose: '', frequency: '' };
      return {
        name: String(m?.name || '').trim(),
        dose: String(m?.dose || m?.doza || '').trim(),
        frequency: String(m?.frequency || m?.qabul || '').trim(),
      };
    });
  }
  // Eski format: medicines — bitta satr ("paratsetamol 500 mg; ibuprofen...")
  const legacy = String(result?.medicines || '').trim();
  if (!legacy) return [];
  return legacy.split(/;|\n/).map((line) => {
    const text = line.trim();
    // "paratsetamol 500 mg 3 mahal" → nom = birinchi so'z(lar), qolgani doza
    const numIdx = text.search(DOSE_NUMBER_RE);
    if (numIdx <= 0) return { name: text, dose: '', frequency: '' };
    return {
      name: text.slice(0, numIdx).trim(),
      dose: text.slice(numIdx).trim(),
      frequency: '',
    };
  }).filter((m) => m.name);
}

/**
 * LLM natijasidagi dorilarni tekshiradi.
 * @param {object} result — llm() qaytargan JSON
 * @returns {{ medications: Array<{name, dose, frequency, warnings: string[]}>, warnings: string[] }}
 */
export function validateMedications(result) {
  const entries = normalizeEntries(result);
  const medications = [];
  const warnings = [];

  for (const entry of entries) {
    const itemWarnings = [];

    if (!entry.name) {
      itemWarnings.push('NO_NAME');
      warnings.push('Dori nomi aniqlanmadi — diktantni qo\'lda tekshiring');
    } else if (!entry.dose) {
      itemWarnings.push('NO_DOSE');
      warnings.push(`"${entry.name}": doza ko'rsatilmagan`);
    } else if (!DOSE_NUMBER_RE.test(entry.dose)) {
      itemWarnings.push('DOSE_NO_NUMBER');
      warnings.push(`"${entry.name}": dozada raqam yo'q ("${entry.dose}")`);
    } else {
      const values = entry.dose.match(/\d+(?:[.,]\d+)?/g) || [];
      const tooBig = values.some((v) => parseFloat(v.replace(',', '.')) > MAX_PLAUSIBLE_DOSE_VALUE);
      if (tooBig) {
        itemWarnings.push('IMPLAUSIBLE_VALUE');
        warnings.push(`"${entry.name}": dozadagi son shubhali katta ("${entry.dose}") — narx yoki telefon aralashgan bo'lishi mumkin`);
      }
    }

    medications.push({ ...entry, warnings: itemWarnings });
  }

  return { medications, warnings };
}
