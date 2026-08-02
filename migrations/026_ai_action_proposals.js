/**
 * Q: AI harakat takliflari — "propose then confirm" oqim.
 *
 * XAVFSIZLIK ASOSIY PRINSIPI:
 * Voice command yoki copilot chatdan chiqqan AI harakati (retsept, buyurtma,
 * yotqizish) darrov bajarilmaydi — avval TAKLIF sifatida saqlanadi. Shifokor
 * UI'da ko'radi, tekshiradi, "Bajar" tugmasi bilan tasdiqlaydi. Faqat shundan
 * so'ng haqiqiy bajaradi.
 *
 * Bu:
 *  1) Klinik xatolarni oldini oladi (LLM hallucinatsiyasi)
 *  2) Huquqiy javobgarlik shifokor imzosi bilan qoladi
 *  3) Audit — kim, qachon, nima uchun tasdiqlagan
 */
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_action_proposals (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      proposed_by_user uuid,
      proposed_by_agent varchar(50),
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      admission_id uuid REFERENCES admissions(id) ON DELETE SET NULL,
      action_kind varchar(40) NOT NULL,     -- 'prescription'|'lab_order'|'admission'|'referral'|'daily_note'
      action_payload jsonb NOT NULL,        -- amalga oshirish uchun ma'lumot
      raw_input text,                       -- ovoz transkripti yoki chat matni
      confidence numeric(3,2),              -- 0.00-1.00
      status varchar(20) NOT NULL DEFAULT 'pending',   -- pending|confirmed|rejected|expired
      confirmed_at timestamptz,
      confirmed_by uuid,
      rejection_reason text,
      result_ref text,                      -- bajarilgach hosil bo'lgan id (prescription.id va h.k.)
      created_at timestamptz NOT NULL DEFAULT NOW(),
      expires_at timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '2 hours')
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS ai_proposals_tenant_pending_idx
                  ON ai_action_proposals (tenant_id, status, created_at DESC)
                  WHERE status = 'pending'`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS ai_proposals_tenant_user_idx
                  ON ai_action_proposals (tenant_id, proposed_by_user, created_at DESC)`);

  // Copilot chat tarixi — shifokor bilan LLM suhbat
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS copilot_chat_messages (
      id bigserial PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      session_id uuid NOT NULL,
      user_id uuid,
      role varchar(20) NOT NULL,           -- 'user'|'assistant'|'system'
      content text NOT NULL,
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS copilot_session_idx
                  ON copilot_chat_messages (session_id, created_at)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS copilot_tenant_user_idx
                  ON copilot_chat_messages (tenant_id, user_id, created_at DESC)`);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS copilot_chat_messages`);
  await knex.raw(`DROP TABLE IF EXISTS ai_action_proposals`);
}
