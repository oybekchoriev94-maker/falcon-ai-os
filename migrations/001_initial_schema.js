export async function up(knex) {
  await knex.schema
    .createTable('tenants', (t) => {
      t.text('id').primary();
      t.string('code', 20).unique();
      t.string('name', 255).notNullable();
      t.string('short_name', 100);
      t.string('type', 50);
      t.string('region', 100);
      t.string('city', 100);
      t.text('address');
      t.string('phone', 50);
      t.string('status', 50).defaultTo('active');
      t.boolean('verified').defaultTo(false);
      t.string('plan', 50).defaultTo('free');
      t.string('stripe_customer_id', 255);
      t.string('stripe_subscription_id', 255);
      t.text('metadata');
      t.timestamp('trial_ends_at');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    })
    .createTable('users', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('username', 100).unique().notNullable();
      t.text('password').notNullable();
      t.string('role', 50).notNullable();
      t.string('name', 255).notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'username']);
    })
    .createTable('doctors', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('first_name', 100).notNullable();
      t.string('last_name', 100);
      t.string('specialty', 100);
      t.string('category', 100);
      t.string('phone', 50);
      t.string('status', 50).defaultTo('Faol');
      t.string('username', 50).unique();
      t.text('password_hash');
      t.string('specialization', 50).defaultTo('doctor');
      t.float('balance').defaultTo(0);
      t.float('reception_price').defaultTo(0);
      t.float('referrer_bonus_percent').defaultTo(10.0);
      t.text('face_descriptor');
      t.integer('failed_attempts').defaultTo(0);
      t.timestamp('locked_until');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'username']);
      t.index(['tenant_id', 'specialization']);
    })
    .createTable('patients', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('first_name', 100).notNullable();
      t.string('last_name', 100);
      t.string('phone', 20);
      t.date('birth_date');
      t.text('face_descriptor');
      t.float('cashback_balance').defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'phone']);
      t.index(['tenant_id', 'first_name', 'last_name']);
    })
    .createTable('appointments', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('appointment_id', 50).unique().notNullable();
      t.string('call_id', 255);
      t.text('patient_name').notNullable();
      t.string('phone', 50);
      t.string('department', 100).defaultTo('therapy');
      t.string('doctor_name', 255);
      t.string('status', 50).defaultTo('pending');
      t.text('notes');
      t.string('source', 50).defaultTo('reception');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'created_at']);
      t.index(['tenant_id', 'status']);
      t.index(['tenant_id', 'appointment_id']);
    })
    .createTable('bookings', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('doctor_id').notNullable();
      t.text('patient_name').notNullable();
      t.string('telegram_id', 100);
      t.date('appointment_date').notNullable();
      t.string('appointment_time', 10).notNullable();
      t.string('status', 50).defaultTo('Kutilmoqda');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'doctor_id', 'appointment_date']);
      t.index(['tenant_id', 'status']);
    })
    .createTable('doctor_schedules', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('doctor_id').notNullable();
      t.integer('day_of_week').notNullable();
      t.string('start_time', 10).notNullable();
      t.string('end_time', 10).notNullable();
      t.integer('slot_duration').defaultTo(30);
      t.unique(['tenant_id', 'doctor_id', 'day_of_week']);
    })
    .createTable('inventory_items', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('name', 255).notNullable();
      t.string('sku', 50).notNullable();
      t.string('category', 100);
      t.float('current_stock').defaultTo(0);
      t.string('unit', 20).notNullable();
      t.float('min_stock');
      t.float('cost_price');
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['tenant_id', 'sku']);
      t.index(['tenant_id', 'category']);
    })
    .createTable('inventory_batches', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.bigInteger('item_id').notNullable().references('id').inTable('inventory_items').onDelete('CASCADE');
      t.string('batch_number', 100).notNullable();
      t.float('quantity').defaultTo(0);
      t.date('expiration_date');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['tenant_id', 'item_id', 'batch_number']);
    })
    .createTable('inventory_transactions', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.bigInteger('item_id').references('id').inTable('inventory_items').onDelete('CASCADE');
      t.string('type', 50).notNullable();
      t.float('quantity').notNullable();
      t.text('performed_by');
      t.float('balance_before');
      t.float('balance_after');
      t.text('reason');
      t.bigInteger('batch_id');
      t.string('batch_number', 100);
      t.integer('standard_quantity').defaultTo(0);
      t.integer('overuse_quantity').defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'item_id']);
      t.index(['tenant_id', 'type', 'created_at']);
    })
    .createTable('procedure_material_norms', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('procedure_name', 255).notNullable();
      t.bigInteger('item_id').references('id').inTable('inventory_items').onDelete('CASCADE');
      t.float('standard_quantity').notNullable();
      t.unique(['tenant_id', 'procedure_name', 'item_id']);
    })
    .createTable('procedure_material_standards', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('procedure_name', 255).notNullable();
      t.bigInteger('item_id').notNullable();
      t.integer('standard_quantity').notNullable();
      t.unique(['tenant_id', 'procedure_name', 'item_id']);
    })
    .createTable('referrals', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('referral_id', 50).unique().notNullable();
      t.text('sender_clinic_id');
      t.text('receiver_clinic_id');
      t.text('patient_name').notNullable();
      t.text('service_required').notNullable();
      t.string('status', 50).defaultTo('pending');
      t.string('qr_code_token', 255).unique().notNullable();
      t.text('referring_doctor');
      t.text('notes');
      t.text('partner_id');
      t.uuid('patient_id');
      t.float('confidence').defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'status']);
      t.index(['tenant_id', 'referring_doctor']);
    })
    .createTable('referral_partners', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('name', 255).notNullable();
      t.string('phone', 20);
      t.string('referral_code', 50).unique().notNullable();
      t.text('qr_code_base64');
      t.float('balance').defaultTo(0);
      t.text('notes');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'referral_code']);
    })
    .createTable('partner_transactions', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('partner_id').notNullable().references('id').inTable('referral_partners').onDelete('CASCADE');
      t.string('type', 20).notNullable();
      t.float('amount').notNullable();
      t.text('note').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'partner_id']);
    })
    .createTable('financial_transactions', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('referral_id');
      t.float('total_amount').notNullable();
      t.float('partner_commission').notNullable();
      t.float('doctor_share').notNullable();
      t.float('platform_fee').defaultTo(2000);
      t.string('status', 50).defaultTo('unpaid');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'status']);
    })
    .createTable('platform_ledger', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.bigInteger('booking_id');
      t.uuid('referral_id');
      t.uuid('doctor_id');
      t.float('total_amount').notNullable();
      t.float('platform_fee_percent').defaultTo(3.0);
      t.float('platform_amount').notNullable();
      t.text('referrer_id');
      t.float('referrer_bonus_percent').defaultTo(10.0);
      t.float('referrer_amount').notNullable();
      t.float('clinic_amount').notNullable();
      t.float('remaining_balance');
      t.string('status', 50).defaultTo('pending');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'booking_id']);
    })
    .createTable('patient_consultations', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('doctor_id');
      t.text('patient_name').notNullable();
      t.text('raw_text').notNullable();
      t.jsonb('data_json');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'doctor_id']);
      t.index(['tenant_id', 'created_at']);
    })
    .createTable('medical_reports', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.text('patient_name');
      t.text('doctor_name');
      t.string('specialization', 50);
      t.string('specialization_label', 100);
      t.jsonb('data_json');
      t.text('pdf_path');
      t.string('telegram_id', 100);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'created_at']);
    })
    .createTable('invoices', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.bigInteger('booking_id');
      t.uuid('patient_id');
      t.text('patient_name');
      t.float('base_cost').notNullable();
      t.float('loyalty_points_redeemed').defaultTo(0);
      t.float('net_cash_paid');
      t.float('platform_fee_percent').defaultTo(3.0);
      t.float('platform_fee_amount');
      t.string('status', 50).defaultTo('pending');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('completed_at');
      t.index(['tenant_id', 'patient_id']);
    })
    .createTable('loyalty_ledger', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('patient_id').notNullable();
      t.text('patient_name');
      t.bigInteger('booking_id');
      t.uuid('invoice_id');
      t.string('type', 20).notNullable();
      t.float('amount').notNullable();
      t.float('balance_before').notNullable();
      t.float('balance_after').notNullable();
      t.text('description');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'patient_id']);
    })
    .createTable('payment_transactions', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('patient_id');
      t.text('patient_name');
      t.float('amount').notNullable();
      t.text('description');
      t.jsonb('services_json');
      t.string('provider', 50).defaultTo('auto');
      t.string('type', 50).defaultTo('payment');
      t.text('payment_url');
      t.text('provider_transaction_id');
      t.jsonb('raw_response');
      t.string('status', 50).defaultTo('pending');
      t.timestamp('paid_at');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'patient_id']);
      t.index(['tenant_id', 'status']);
      t.index(['tenant_id', 'created_at']);
    })
    .createTable('payment_webhook_logs', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('provider', 50).notNullable();
      t.text('transaction_id');
      t.jsonb('raw_json');
      t.string('status', 50).defaultTo('received');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('wallet_log', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('patient_id').notNullable();
      t.string('type', 50).notNullable();
      t.float('amount').notNullable();
      t.float('balance_before').notNullable();
      t.float('balance_after').notNullable();
      t.text('note');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'patient_id']);
    })
    .createTable('face_logs', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('doctor_id');
      t.text('doctor_name');
      t.uuid('patient_id');
      t.string('action', 50).defaultTo('entry');
      t.float('confidence').defaultTo(0);
      t.text('matched');
      t.float('liveness_score');
      t.boolean('liveness_passed').defaultTo(false);
      t.boolean('spoof_warning').defaultTo(false);
      t.boolean('anonymized').defaultTo(false);
      t.string('device_id', 128);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'doctor_id']);
      t.index(['tenant_id', 'created_at']);
    })
    .createTable('wards', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('name', 255).notNullable();
      t.integer('floor');
      t.string('room_number', 50);
      t.integer('bed_count').defaultTo(0);
      t.string('department', 100);
      t.string('status', 50).defaultTo('active');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'department']);
    })
    .createTable('beds', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('ward_id').notNullable().references('id').inTable('wards').onDelete('CASCADE');
      t.string('bed_number', 50).notNullable();
      t.string('bed_type', 50).defaultTo('oddiy');
      t.string('status', 50).defaultTo('free');
      t.unique(['tenant_id', 'ward_id', 'bed_number']);
    })
    .createTable('admissions', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('patient_id');
      t.text('patient_name').notNullable();
      t.string('patient_phone', 50);
      t.uuid('bed_id').references('id').inTable('beds');
      t.uuid('ward_id');
      t.timestamp('admission_date').notNullable();
      t.timestamp('discharge_date');
      t.string('admission_type', 50).defaultTo('rejali');
      t.text('diagnosis_initial');
      t.text('diagnosis_final');
      t.uuid('attending_doctor_id');
      t.text('attending_doctor_name');
      t.string('status', 50).defaultTo('active');
      t.string('payment_type', 50).defaultTo('kassa');
      t.text('notes');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'status']);
      t.index(['tenant_id', 'admission_date']);
    })
    .createTable('daily_notes', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('admission_id').notNullable().references('id').inTable('admissions').onDelete('CASCADE');
      t.uuid('doctor_id');
      t.text('doctor_name');
      t.uuid('nurse_id');
      t.text('nurse_name');
      t.date('date').notNullable();
      t.string('shift', 50).defaultTo('ertalab');
      t.float('temperature');
      t.string('blood_pressure', 20);
      t.integer('pulse');
      t.integer('respiration');
      t.float('saturation');
      t.text('complaints');
      t.text('objective_status');
      t.text('treatment_plan');
      t.text('notes');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('prescriptions', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('admission_id').notNullable().references('id').inTable('admissions').onDelete('CASCADE');
      t.uuid('doctor_id');
      t.text('doctor_name');
      t.text('medicine_name').notNullable();
      t.text('dosage');
      t.string('route', 50).defaultTo('ichish');
      t.text('frequency');
      t.date('start_date');
      t.date('end_date');
      t.string('status', 50).defaultTo('active');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('inpatient_services', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('admission_id').notNullable().references('id').inTable('admissions').onDelete('CASCADE');
      t.text('service_name').notNullable();
      t.float('quantity').defaultTo(1);
      t.float('price').notNullable();
      t.float('total').notNullable();
      t.text('performed_by');
      t.text('performed_by_name');
      t.date('date').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('discharges', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('admission_id').notNullable().unique().references('id').inTable('admissions').onDelete('CASCADE');
      t.timestamp('discharge_date').notNullable();
      t.string('discharge_type', 50).defaultTo('tuzalgan');
      t.text('diagnosis_final');
      t.string('icd10_code', 20);
      t.text('recommendations');
      t.date('follow_up_date');
      t.text('epicrisis_text');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('family_monitors', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('admission_id').notNullable().references('id').inTable('admissions').onDelete('CASCADE');
      t.string('telegram_id', 100).notNullable();
      t.string('relation_type', 50).defaultTo('oilaviy');
      t.string('language', 10).defaultTo('uz');
      t.boolean('notifications_enabled').defaultTo(true);
      t.timestamp('last_notified');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('doctor_analytics', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('doctor_id').notNullable();
      t.text('doctor_name').notNullable();
      t.string('department', 100);
      t.integer('patients_count').defaultTo(0);
      t.float('total_revenue').defaultTo(0);
      t.integer('total_procedures').defaultTo(0);
      t.float('material_cost').defaultTo(0);
      t.integer('errors_count').defaultTo(0);
      t.float('avg_minutes').defaultTo(0);
      t.date('period_start');
      t.date('period_end');
      t.unique(['tenant_id', 'doctor_id', 'period_start']);
    })
    .createTable('medication_reminders', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('telegram_id', 100);
      t.text('patient_name');
      t.text('medicine_name').notNullable();
      t.text('dosage');
      t.string('reminder_time', 10).notNullable();
      t.string('status', 50).defaultTo('active');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('telegram_users', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('telegram_id', 100).unique().notNullable();
      t.text('first_name');
      t.text('username');
      t.string('phone', 20);
      t.string('chat_id', 100);
      t.string('language', 10).defaultTo('uz');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('patient_queue', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.integer('queue_number');
      t.text('patient_name');
      t.string('phone', 50);
      t.text('doctor');
      t.string('status', 50).defaultTo('waiting');
      t.string('channel', 20).defaultTo('reception');
      t.string('call_sid', 255);
      t.text('notes');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'status']);
    })
    .createTable('voice_calls', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('call_sid', 255).unique();
      t.string('caller_number', 50);
      t.text('caller_name');
      t.string('status', 50);
      t.integer('duration_seconds').defaultTo(0);
      t.text('transcript');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('staff_members', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.bigInteger('telegram_id').unique().notNullable();
      t.text('full_name').notNullable();
      t.string('role', 50).notNullable();
      t.boolean('is_active').defaultTo(true);
    })
    .createTable('services_catalog', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('name', 255).notNullable();
      t.string('category', 100);
      t.string('icon', 20);
      t.text('description');
    })
    .createTable('clinic_services', (t) => {
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('service_id');
      t.primary(['tenant_id', 'service_id']);
    })
    .createTable('b2b_contracts', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.text('sender_clinic_id');
      t.text('receiver_clinic_id');
      t.float('percent').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['tenant_id', 'sender_clinic_id', 'receiver_clinic_id']);
    })
    .createTable('token_blacklist', (t) => {
      t.bigIncrements('id');
      t.string('jti', 255).unique().notNullable();
      t.timestamp('expires_at').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['jti']);
    })
    .createTable('used_nonces', (t) => {
      t.text('nonce').primary();
      t.timestamp('expires_at').notNullable();
      t.index(['expires_at']);
    })
    .createTable('idempotency_keys', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.text('key').unique().notNullable();
      t.jsonb('response').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('consent_logs', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('user_type', 50).notNullable();
      t.text('user_id').notNullable();
      t.string('consent_version', 50).defaultTo('v1');
      t.text('consent_text');
      t.string('ip_address', 50);
      t.text('user_agent');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'user_type', 'user_id']);
    })
    .createTable('clinic_settings', (t) => {
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.text('key').notNullable();
      t.text('value').notNullable();
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.primary(['tenant_id', 'key']);
    })
    .createTable('subscription_plans', (t) => {
      t.text('id').primary();
      t.string('name', 255).notNullable();
      t.string('code', 50).unique().notNullable();
      t.text('description');
      t.float('monthly_price').defaultTo(0);
      t.float('annual_price').defaultTo(0);
      t.integer('max_doctors').defaultTo(0);
      t.integer('max_patients').defaultTo(0);
      t.integer('max_storage_mb').defaultTo(100);
      t.integer('ai_requests_limit').defaultTo(100);
      t.boolean('face_id_enabled').defaultTo(false);
      t.boolean('b2b_referrals_enabled').defaultTo(false);
      t.boolean('inpatient_enabled').defaultTo(false);
      t.boolean('reports_enabled').defaultTo(false);
      t.boolean('api_access_enabled').defaultTo(false);
      t.boolean('active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('subscriptions', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().unique().references('id').inTable('tenants').onDelete('CASCADE');
      t.text('plan_id').notNullable().references('id').inTable('subscription_plans');
      t.string('billing_cycle', 20).defaultTo('monthly');
      t.string('status', 50).defaultTo('active');
      t.timestamp('current_period_start').defaultTo(knex.fn.now());
      t.timestamp('current_period_end');
      t.timestamp('trial_ends_at');
      t.timestamp('canceled_at');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    })
    .createTable('usage_metering', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('metric', 100).notNullable();
      t.integer('count').defaultTo(0);
      t.date('date').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['tenant_id', 'metric', 'date']);
    })
    .createTable('audit_logs', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.text('user_id');
      t.text('user_name');
      t.string('action', 255).notNullable();
      t.text('resource');
      t.jsonb('details');
      t.string('ip_address', 50);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tenant_id', 'created_at']);
      t.index(['tenant_id', 'action']);
    });
}

export async function down(knex) {
  const tables = [
    'audit_logs', 'usage_metering', 'subscriptions', 'subscription_plans',
    'clinic_settings', 'consent_logs', 'idempotency_keys', 'used_nonces',
    'token_blacklist', 'b2b_contracts', 'clinic_services', 'services_catalog',
    'staff_members', 'voice_calls', 'patient_queue', 'telegram_users',
    'medication_reminders', 'doctor_analytics', 'family_monitors', 'discharges',
    'inpatient_services', 'prescriptions', 'daily_notes', 'admissions', 'beds',
    'wards', 'face_logs', 'wallet_log', 'payment_webhook_logs',
    'payment_transactions', 'loyalty_ledger', 'invoices', 'medical_reports',
    'patient_consultations', 'platform_ledger', 'financial_transactions',
    'referral_partners', 'partner_transactions', 'referrals',
    'procedure_material_standards', 'procedure_material_norms',
    'inventory_transactions', 'inventory_batches', 'inventory_items',
    'bookings', 'appointments', 'doctor_schedules', 'patients', 'doctors',
    'users', 'tenants',
  ];
  for (const t of tables) {
    await knex.schema.dropTableIfExists(t);
  }
}
