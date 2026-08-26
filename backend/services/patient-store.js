// ============================================================
// FALCON AI OS — Bemor kartasi yordamchilari (booking, scribe, patients).
// Bir joyda bo'lishi shart: telefon normallashtirish va MRN generatsiyasi
// bir necha route'da bir xil ishlashi kerak, aks holda dublikatlar chiqadi.
// ============================================================

import { v4 as uuidv4 } from 'uuid';

/**
 * Telefonni +998XXXXXXXXX ko'rinishga keltiradi. Bo'sh bo'lsa '' qaytaradi.
 * Bu format bazadagi partial unique index'ga mos keladi (migratsiya 011).
 */
export function normalizePhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 9) return '+998' + d;
  if (d.length === 12 && d.startsWith('998')) return '+' + d;
  return '+' + d;
}

/**
 * Yangi MRN: YYYY-NNNNNN, klinika ichida ketma-ket.
 * Race'ga qarshi migratsiya 011'dagi partial unique index himoya beradi.
 */
export async function generateMrn(pool, tenantId) {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;
  const { rows } = await pool.query(
    `SELECT medical_record_number AS mrn FROM patients
     WHERE tenant_id = $1 AND medical_record_number LIKE $2
     ORDER BY medical_record_number DESC LIMIT 1`,
    [tenantId, prefix + '%']
  );
  const last = rows[0]?.mrn;
  const nextNum = last ? (parseInt(String(last).slice(prefix.length), 10) || 0) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(6, '0')}`;
}

/**
 * Telefon bo'yicha bor kartani topadi, bo'lmasa yangi ochib id qaytaradi.
 * Booking oqimida ishlatiladi — bir marta yozib qo'yilsa, keyingi bronlarda
 * appointments.patient_id shu id bilan bog'lanadi va istoriya bir joyga yig'iladi.
 *
 * Xato bo'lsa null qaytaradi (throw qilmaydi) — bemor kartasi bronni bloklamasin.
 */
export async function upsertPatientByPhone(pool, tenantId, { phone, patient_name, district, address }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  try {
    const { rows: existing } = await pool.query(
      'SELECT id FROM patients WHERE tenant_id = $1 AND phone = $2',
      [tenantId, normalized]
    );
    if (existing[0]) return existing[0].id;

    const [firstName, ...restName] = String(patient_name || '').trim().split(/\s+/);
    const id = uuidv4();

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const mrn = await generateMrn(pool, tenantId);
        await pool.query(
          `INSERT INTO patients (id, tenant_id, first_name, last_name, phone, district, address, medical_record_number)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, tenantId, firstName || 'Bemor', restName.join(' ') || '',
           normalized, district || '', address || '', mrn]
        );
        return id;
      } catch (e) {
        // Boshqa oqim shu telefonda kartani parallel yaratgan bo'lsa — o'shani olamiz
        if (e.code === '23505' && String(e.constraint || '').includes('phone')) {
          const { rows: dup } = await pool.query(
            'SELECT id FROM patients WHERE tenant_id = $1 AND phone = $2',
            [tenantId, normalized]
          );
          if (dup[0]) return dup[0].id;
        }
        // MRN to'qnashuvi bo'lsa — yana urin
        if (e.code === '23505' && String(e.constraint || '').includes('mrn') && attempt < 2) continue;
        throw e;
      }
    }
    return null;
  } catch (e) {
    console.warn('[patient-store] upsertPatientByPhone:', e.message);
    return null;
  }
}
