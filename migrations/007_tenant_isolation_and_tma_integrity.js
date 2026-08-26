export async function up(knex) {
  // Bitta Telegram akkaunt bir nechta klinikada bemor bo'lishi mumkin.
  // Global unique cheklovi o'rniga tenant ichidagi unique bog'lanish ishlaydi.
  await knex.raw('ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_telegram_id_unique');
  await knex.raw('ALTER TABLE telegram_users DROP CONSTRAINT IF EXISTS telegram_users_telegram_id_unique');
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS patients_tenant_telegram_unique
    ON patients (tenant_id, telegram_id)
    WHERE telegram_id IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS telegram_users_tenant_telegram_unique
    ON telegram_users (tenant_id, telegram_id)
  `);

  if (!(await knex.schema.hasColumn('patient_queue', 'patient_id'))) {
    await knex.schema.alterTable('patient_queue', (table) => {
      table.uuid('patient_id');
      table.index(['tenant_id', 'patient_id']);
    });
  }
  if (!(await knex.schema.hasColumn('patient_queue', 'department'))) {
    await knex.schema.alterTable('patient_queue', (table) => table.string('department', 100));
  }
  if (!(await knex.schema.hasColumn('patient_queue', 'appointment_time'))) {
    await knex.schema.alterTable('patient_queue', (table) => table.string('appointment_time', 10));
  }

  if (!(await knex.schema.hasColumn('patient_consultations', 'patient_id'))) {
    await knex.schema.alterTable('patient_consultations', (table) => {
      table.uuid('patient_id');
      table.index(['tenant_id', 'patient_id']);
    });
  }
  if (!(await knex.schema.hasColumn('medical_reports', 'patient_id'))) {
    await knex.schema.alterTable('medical_reports', (table) => {
      table.uuid('patient_id');
      table.index(['tenant_id', 'patient_id']);
    });
  }
  if (!(await knex.schema.hasColumn('medication_reminders', 'patient_id'))) {
    await knex.schema.alterTable('medication_reminders', (table) => {
      table.uuid('patient_id');
      table.index(['tenant_id', 'patient_id']);
    });
  }

  // Ilova darajasidagi "oldin tekshir, keyin insert" poygasini DB ham yopadi.
  // Agar production bazada takroriy faol slotlar bo'lsa, migratsiya ularni
  // yashirmaydi: avval operator qaysi booking qolishini hal qilishi kerak.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot_unique
    ON bookings (tenant_id, doctor_id, appointment_date, appointment_time)
    WHERE status <> 'Bekor qilingan'
  `);

  await knex.raw('ALTER TABLE idempotency_keys DROP CONSTRAINT IF EXISTS idempotency_keys_key_unique');
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_tenant_key_unique
    ON idempotency_keys (tenant_id, key)
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_transaction_unique
    ON payment_transactions (provider, provider_transaction_id)
    WHERE provider_transaction_id IS NOT NULL
  `);
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS payment_provider_transaction_unique');
  await knex.raw('DROP INDEX IF EXISTS idempotency_keys_tenant_key_unique');
  await knex.raw('ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_key_unique UNIQUE (key)');
  await knex.raw('DROP INDEX IF EXISTS bookings_active_slot_unique');

  if (await knex.schema.hasColumn('medication_reminders', 'patient_id')) {
    await knex.schema.alterTable('medication_reminders', (table) => table.dropColumn('patient_id'));
  }
  if (await knex.schema.hasColumn('medical_reports', 'patient_id')) {
    await knex.schema.alterTable('medical_reports', (table) => table.dropColumn('patient_id'));
  }
  if (await knex.schema.hasColumn('patient_consultations', 'patient_id')) {
    await knex.schema.alterTable('patient_consultations', (table) => table.dropColumn('patient_id'));
  }
  if (await knex.schema.hasColumn('patient_queue', 'appointment_time')) {
    await knex.schema.alterTable('patient_queue', (table) => table.dropColumn('appointment_time'));
  }
  if (await knex.schema.hasColumn('patient_queue', 'department')) {
    await knex.schema.alterTable('patient_queue', (table) => table.dropColumn('department'));
  }
  if (await knex.schema.hasColumn('patient_queue', 'patient_id')) {
    await knex.schema.alterTable('patient_queue', (table) => table.dropColumn('patient_id'));
  }

  await knex.raw('DROP INDEX IF EXISTS telegram_users_tenant_telegram_unique');
  await knex.raw('DROP INDEX IF EXISTS patients_tenant_telegram_unique');
  await knex.raw('ALTER TABLE telegram_users ADD CONSTRAINT telegram_users_telegram_id_unique UNIQUE (telegram_id)');
  await knex.raw('ALTER TABLE patients ADD CONSTRAINT patients_telegram_id_unique UNIQUE (telegram_id)');
}
