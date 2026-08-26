/**
 * Face ID v2 (PR #10): liveness va multi-frame tasdiq.
 *
 * Tanish LOKAL kompyuterda qilinadi (embeddinglar chiqmaydi) — bu
 * migration faqat HODISA metadata'sini kengaytiradi:
 *
 *  - subject_type: 'staff' | 'patient' — bemorlar ham Face ID orqali
 *    keladi (papka nomi "bemor_" prefiksi bilan).
 *  - frame_count: necha kadr tasdiqlagan (multi-frame himoya kuchi).
 *  - liveness_score / liveness_ok: jonlilik bahosi — qog'ozdagi/foto
 *    yuz harakatsiz bo'ladi, jonli odamning yuzi kadrda siljiydi.
 *  - flag: server qayta tekshiruvidan o'tmagan hodisalar belgisi
 *    (dalil saqlanib qoladi, jazolanmaydi — faqat tekshirish uchun).
 *  - patient_id: bemor hodisasi kartasi bilan bog'lanadi.
 *
 * Biometrik ma'lumot (embedding/rasm) BU YERGA YOZILMAYDI — 006
 * migration qarori davom etadi.
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('attendance_events', 'subject_type'))) {
    await knex.schema.alterTable('attendance_events', (t) => {
      t.string('subject_type', 10).notNullable().defaultTo('staff');
      t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
      t.integer('frame_count');
      t.float('liveness_score');
      t.boolean('liveness_ok').notNullable().defaultTo(false);
      // 'photo_suspect' | 'low_frames' — server qayta tekshiruvi topgan shubha
      t.string('flag', 20);
    });
  }

  await knex.raw(`
    ALTER TABLE attendance_events
    DROP CONSTRAINT IF EXISTS attendance_events_subject_type_chk
  `);
  await knex.raw(`
    ALTER TABLE attendance_events
    ADD CONSTRAINT attendance_events_subject_type_chk
    CHECK (subject_type IN ('staff', 'patient'))
  `);

  // Bemor hodisalarini kun bo'yicha tez izlash uchun
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS attendance_events_subject_idx
    ON attendance_events (tenant_id, subject_type, occurred_at)
  `);
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS attendance_events_subject_idx');
  await knex.raw('ALTER TABLE attendance_events DROP CONSTRAINT IF EXISTS attendance_events_subject_type_chk');
  if (await knex.schema.hasColumn('attendance_events', 'subject_type')) {
    await knex.schema.alterTable('attendance_events', (t) => {
      t.dropColumn('subject_type');
      t.dropColumn('patient_id');
      t.dropColumn('frame_count');
      t.dropColumn('liveness_score');
      t.dropColumn('liveness_ok');
      t.dropColumn('flag');
    });
  }
}
