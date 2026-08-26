/**
 * R: Bemor Telegram chatbot va simptom skrining.
 *
 * XAVFSIZLIK:
 *  - Chatbot tashxis qo'ymaydi. Faqat "shifokorga borish" tavsiyasi.
 *  - Har kritik simptom (ko'krak og'rig'i, nafas qisilishi) darrov
 *    "112 ga qo'ng'iroq qiling" javob beradi va klinika mavjud emas.
 *  - Bemor telegram_id bo'yicha aniqlanadi — patients.telegram_id bilan
 *    JOIN qilingach patient_id topiladi.
 *
 * chatbot_conversations: bemor bilan suhbat tarixi.
 * symptom_screenings: bemor simptom checker bilan bergan javoblari
 *   (shifokor kartada ko'radi — bemor ko'rikka tayyorlangan bo'ladi).
 */
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS chatbot_conversations (
      id bigserial PRIMARY KEY,
      tenant_id text REFERENCES tenants(id) ON DELETE CASCADE,
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      telegram_id text NOT NULL,
      role varchar(20) NOT NULL,            -- 'user'|'assistant'|'system'
      content text NOT NULL,
      intent varchar(40),                   -- 'symptom_query'|'appointment'|'result'|'general'
      urgency varchar(10),                  -- 'green'|'yellow'|'red'
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS chatbot_conv_tg_idx
                  ON chatbot_conversations (telegram_id, created_at DESC)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS chatbot_conv_tenant_idx
                  ON chatbot_conversations (tenant_id, patient_id, created_at DESC)
                  WHERE patient_id IS NOT NULL`);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS symptom_screenings (
      id uuid PRIMARY KEY,
      tenant_id text REFERENCES tenants(id) ON DELETE CASCADE,
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      telegram_id text,
      symptoms_json jsonb NOT NULL,         -- {main_complaint, duration, severity, associated[]}
      ai_urgency varchar(10),               -- 'green'|'yellow'|'red'
      ai_suggested_specialty varchar(50),
      ai_summary text,
      appointment_id bigint REFERENCES appointments(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS symptom_screenings_patient_idx
                  ON symptom_screenings (tenant_id, patient_id, created_at DESC)`);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS symptom_screenings`);
  await knex.raw(`DROP TABLE IF EXISTS chatbot_conversations`);
}
