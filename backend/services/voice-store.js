// ============================================================
// Ovozli diktantlarni saqlash — "hech bir diktovka yo'qolmasin".
//
// NEGA: ilgari audio hech qayerda saqlanmasdi — bufer to'g'ridan-to'g'ri
// STT'ga berilar va yo'qolardi. Har qanday xato (STT yiqildi, LLM xato
// berdi, tarmoq uzildi, konteyner qayta ishga tushdi) shifokorning
// diktantini BUTUNLAY yo'q qilardi.
//
// Endi tartib: DISKKA YOZ -> transkripsiya qil -> natijani belgila.
// Xato bo'lsa audio joyida qoladi va qayta ishlash mumkin.
//
// Bu servis ASOSIY OQIMNI HECH QACHON TO'XTATMAYDI: saqlash imkonsiz
// bo'lsa (disk to'lgan, huquq yo'q) xato faqat logga yoziladi va
// transkripsiya davom etadi. Saqlanmagan diktant — yomon; umuman
// ishlamaydigan diktant — battar.
// ============================================================
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

// DIQQAT: `public/` ostida EMAS. U statik tarqatiladi va bemor ovozi
// internetga ochilib qolardi.
const VOICE_DIR = process.env.VOICE_DIR || '/app/voice-recordings';

// Audio — vaqtinchalik nusxa, doimiy arxiv emas. Muddati o'tgach
// o'chiriladi (transkripsiya matni bazada qoladi).
const RETENTION_DAYS = parseInt(process.env.VOICE_RETENTION_DAYS || '30', 10);

/** Fayl kengaytmasini MIME yoki original nomdan aniqlaydi */
function extOf(mime, originalName) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('mp4') || m.includes('m4a')) return 'mp4';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  const e = path.extname(String(originalName || '')).replace('.', '').toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(e) ? e : 'webm';
}

/**
 * Diktantni diskka yozadi va bazaga qayd etadi.
 *
 * Transkripsiyadan OLDIN chaqiriladi. Xato bo'lsa `null` qaytaradi —
 * chaqiruvchi baribir davom etishi kerak.
 *
 * @returns {Promise<{id: string} | null>}
 */
export async function saveRecording(pool, {
  tenantId, userId, source, refId, patientId, buffer, mime, originalName, language,
}) {
  if (!tenantId || !buffer?.length) return null;
  try {
    // Kunlik papkalar — bitta papkada o'n minglab fayl to'planmasin
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(VOICE_DIR, tenantId, day);
    await fs.mkdir(dir, { recursive: true });

    const id = uuidv4();
    const rel = path.join(tenantId, day, `${id}.${extOf(mime, originalName)}`);
    await fs.writeFile(path.join(VOICE_DIR, rel), buffer);

    await pool.query(
      `INSERT INTO voice_recordings
         (id, tenant_id, user_id, source, ref_id, patient_id,
          file_path, mime, size_bytes, language, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')`,
      [id, tenantId, userId || null, source, refId ? String(refId) : null,
       patientId || null, rel, mime || null, buffer.length, language || null]
    );
    return { id };
  } catch (e) {
    // Saqlash muvaffaqiyatsiz — asosiy oqim TO'XTAMAYDI (yuqoridagi izoh)
    console.warn('[VOICE] Saqlab bo\'lmadi:', e.message);
    return null;
  }
}

/** Transkripsiya muvaffaqiyatli — matnni yozib qo'yamiz */
export async function markTranscribed(pool, id, transcript) {
  if (!id) return;
  try {
    await pool.query(
      `UPDATE voice_recordings
          SET status = 'transcribed', transcript = $2, transcribed_at = NOW()
        WHERE id = $1`,
      [id, transcript || null]
    );
  } catch (e) { console.warn('[VOICE] markTranscribed:', e.message); }
}

/**
 * Transkripsiya muvaffaqiyatsiz — audio JOYIDA QOLADI.
 * Shifokor qayta urinishi yoki xodim tinglab, qo'lda kiritishi mumkin.
 */
export async function markFailed(pool, id, error) {
  if (!id) return;
  try {
    await pool.query(
      `UPDATE voice_recordings SET status = 'failed', error = $2 WHERE id = $1`,
      [id, String(error || '').slice(0, 500)]
    );
  } catch (e) { console.warn('[VOICE] markFailed:', e.message); }
}

/**
 * Muddati o'tgan AUDIO FAYLLARNI o'chiradi. Bazadagi yozuv va
 * transkripsiya matni QOLADI — tibbiy yozuv tarixi yo'qolmasligi kerak,
 * o'chadigan narsa faqat ovoz fayli (disk + maxfiylik).
 *
 * Muvaffaqiyatsiz (`failed`) yozuvlarga TEGILMAYDI: ular hali qayta
 * ishlanmagan, ya'ni ulardagi ma'lumot boshqa hech qayerda yo'q.
 */
export async function purgeOldAudio(pool) {
  let removed = 0;
  try {
    const { rows } = await pool.query(
      // $1::text sharti MUHIM — node-pg sonni numeric qilib yuboradi va
      // `numeric || text` PostgreSQL'da operator xatosi beradi.
      `SELECT id, file_path FROM voice_recordings
        WHERE status = 'transcribed'
          AND created_at < NOW() - ($1::text || ' days')::interval
        LIMIT 500`,
      [RETENTION_DAYS]
    );
    for (const r of rows) {
      try { await fs.unlink(path.join(VOICE_DIR, r.file_path)); }
      catch { /* fayl allaqachon yo'q — yozuvni baribir belgilaymiz */ }
      await pool.query(`UPDATE voice_recordings SET status = 'purged' WHERE id = $1`, [r.id]);
      removed += 1;
    }
    if (removed) console.log(`[VOICE] ${removed} ta eski audio o'chirildi (${RETENTION_DAYS} kundan eski)`);
  } catch (e) {
    console.warn('[VOICE] purgeOldAudio:', e.message);
  }
  return removed;
}

/** Sutkada bir marta eski audiolarni tozalaydi */
export function startVoicePurgeCron(pool) {
  const DAY = 24 * 60 * 60 * 1000;
  // Ishga tushgandan 5 daqiqa keyin — start paytida yuk qo'shmaslik uchun
  setTimeout(() => {
    purgeOldAudio(pool).catch(() => {});
    setInterval(() => purgeOldAudio(pool).catch(() => {}), DAY);
  }, 5 * 60 * 1000).unref?.();
}
