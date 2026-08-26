// ============================================================
// Falcon AI OS — Ombor kamera-korrelyatsiyasi (roadmap PR #12)
//
// Har bir ombor tranzaksiyasi (kirim/chiqim/tuzatish) o'sha vaqt
// oralig'ida ombor zonasida kamera hodisasi bo'lganmi — shuni
// bog'laydi. Kamera yo'q bo'lsa — SIGNAL (rahbar ko'radi), jazo
// emas. Kamera = dalil doktrinasi davomi.
// Sof funksiyalar — DB'siz test qilinadi.
// ============================================================

export const DEFAULT_WINDOW_MINUTES = 5;

// Tranzaksiya turi bo'yicha flag: manfiy ADJUST = kamomad belgisi
function txFlags(tx, cameraEvidence) {
  const flags = [];
  if (!cameraEvidence) flags.push('no_camera');
  if (tx.type === 'ADJUST' && Number(tx.quantity) < 0) flags.push('kamomad');
  return flags;
}

/**
 * Ombor tranzaksiyalarini kamera hodisalari bilan bog'laydi.
 *
 * @param {Array} transactions { id, type, quantity, performed_by, reason, created_at, item_name? }
 * @param {Array} events ombor zonasidagi hodisalar { subject_ref?, occurred_at }
 * @param {number} windowMinutes tranzaksiya atrofidagi +/- oyna (daqiqada)
 * @returns {Array} har tranzaksiyaga: camera_evidence, matched_events,
 *                  nearest_event_at, nearest_subject_ref, flags
 */
export function correlateWarehouseEvents(transactions = [], events = [], windowMinutes = DEFAULT_WINDOW_MINUTES) {
  const win = Math.abs(Number(windowMinutes));
  const windowMs = (Number.isFinite(win) && win > 0 ? win : DEFAULT_WINDOW_MINUTES) * 60000;

  const evTimes = (events || [])
    .map((ev) => ({ ...ev, t: new Date(ev.occurred_at).getTime() }))
    .filter((ev) => Number.isFinite(ev.t));

  const rows = (transactions || []).map((tx) => {
    const t = new Date(tx.created_at).getTime();
    const near = Number.isFinite(t)
      ? evTimes.filter((ev) => Math.abs(ev.t - t) <= windowMs)
      : [];
    const nearest = near.length
      ? near.reduce((a, b) => (Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b))
      : null;
    const cameraEvidence = near.length > 0;
    return {
      tx_id: tx.id ?? null,
      type: tx.type || null,
      quantity: tx.quantity ?? null,
      item_name: tx.item_name || null,
      performed_by: tx.performed_by || null,
      reason: tx.reason || null,
      created_at: tx.created_at ?? null,
      camera_evidence: cameraEvidence,
      matched_events: near.length,
      nearest_event_at: nearest ? new Date(nearest.t).toISOString() : null,
      nearest_subject_ref: nearest?.subject_ref || null,
      flags: txFlags(tx, cameraEvidence),
    };
  });

  // Yangisi tepada — direktor jadvali uchun
  return rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

/**
 * Direktor agregati: jami / kamerali / kamerasiz / kamomad.
 *
 * @param {Array} rows correlateWarehouseEvents() natijasi
 */
export function summarizeWarehouse(rows = []) {
  const list = rows || [];
  return {
    total: list.length,
    with_camera: list.filter((r) => r.camera_evidence).length,
    without_camera: list.filter((r) => !r.camera_evidence).length,
    kamomad: list.filter((r) => (r.flags || []).includes('kamomad')).length,
  };
}
