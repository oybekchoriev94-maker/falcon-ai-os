/**
 * PR #8 — Qog'oz hujjatlarni elektronlashtirish (OCR + STT + AI).
 *
 * ocr_documents: tibbiy karta, xulosa, retsept, yo'naltirma, shartnoma,
 * akt va boshqa hujjatlarning elektron nusxasi. Uch manba:
 *   upload — rasm (OCR orqali matn),
 *   stt    — ovozli diktant (STT orqali matn),
 *   text   — qo'lda kiritilgan matn.
 *
 * AI (LLM) matndan tuzilgan maydonlarni ajratadi (structured jsonb)
 * va qisqa xulosa (ai_summary) yozadi. OCR/STT natijasi HECH QACHON
 * avtomatik kartaga aylantirilmaydi — shifokor/registratura tasdiqlaydi
 * (reviewed_by/reviewed_at). Kamera doktrinasi kabi: AI = yordamchi,
 * qaror odamda.
 */

export async function up(knex) {
  const has = await knex.schema.hasTable('ocr_documents');
  if (!has) {
    await knex.raw(`
      CREATE TABLE ocr_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
        doc_type varchar(30) NOT NULL DEFAULT 'boshqa'
          CHECK (doc_type IN ('tibbiy_karta', 'xulosa', 'retsept', 'yonaltirma', 'shartnoma', 'akt', 'boshqa')),
        source varchar(10) NOT NULL DEFAULT 'upload'
          CHECK (source IN ('upload', 'stt', 'text')),
        original_filename varchar(255),
        mime varchar(120),
        size_bytes integer,
        file_path varchar(400),
        language varchar(2) DEFAULT 'uz',
        raw_text text,
        ai_summary text,
        structured jsonb,
        status varchar(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'processing', 'done', 'failed')),
        error varchar(500),
        reviewed_by uuid,
        reviewed_at timestamptz,
        review_note text,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await knex.raw(`CREATE INDEX ocr_documents_tenant_idx ON ocr_documents (tenant_id, created_at DESC)`);
    await knex.raw(`CREATE INDEX ocr_documents_patient_idx ON ocr_documents (tenant_id, patient_id)`);
    await knex.raw(`CREATE INDEX ocr_documents_status_idx ON ocr_documents (tenant_id, status)`);
    // Tenant izolyatsiyasi — 038-043 bilan bir xil inline siyosat
    await knex.raw('ALTER TABLE ocr_documents ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE ocr_documents FORCE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY falcon_tenant_isolation ON ocr_documents
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
    `);
  }
}

export async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS ocr_documents');
}
