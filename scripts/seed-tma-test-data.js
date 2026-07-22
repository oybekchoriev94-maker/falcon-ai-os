const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://falcon:falcon-secret@localhost:5432/falcon_ai_os' });
const { v4: uuidv4 } = require('uuid');

async function seed() {
  const telId = 'demo_user';
  const patientId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const consultationId = uuidv4();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const todayTs = now.toISOString();

  // Upsert patient
  await pool.query(`INSERT INTO patients (id, tenant_id, first_name, last_name, phone, telegram_id)
    VALUES ($1, 'default', 'Demo', 'Bemor', '+998901234567', $2)
    ON CONFLICT (id) DO UPDATE SET telegram_id = EXCLUDED.telegram_id`,
    [patientId, telId]);

  // Insert queue entry for today with proper timestamps
  await pool.query(`INSERT INTO patient_queue (tenant_id, department, status, queue_number, patient_name, doctor, appointment_time, created_at)
    VALUES ('default', 'Terapiya', 'waiting', 5, 'Demo Bemor', 'Dr. Akramov', $1, $2)
    ON CONFLICT DO NOTHING`,
    [todayTs, todayTs]);

  // Insert a booking with tenant_id
  const doctor = await pool.query("SELECT id FROM doctors WHERE status = 'Faol' LIMIT 1");
  if (doctor.rows.length > 0) {
    await pool.query(`INSERT INTO bookings (tenant_id, doctor_id, patient_name, telegram_id, appointment_date, appointment_time, status)
      VALUES ('default', $1, 'Demo Bemor', $2, $3, '11:00', 'Kutilmoqda')
      ON CONFLICT DO NOTHING`, [doctor.rows[0].id, telId, todayStr]);
  }

  // Insert a consultation with tenant_id and uuid id
  await pool.query(`INSERT INTO patient_consultations (id, tenant_id, patient_name, raw_text, data_json, created_at)
    VALUES ($1, 'default', 'Demo Bemor', 'Bemor bosh ogrigidan shikoyat qiladi',
      '{"diagnosis":"Otkir respirator infeksiya","recommendations":"Kop suv ichish, dam olish","medicines":[{"name":"Paratsetamol","dosage":"500mg"}]}',
      $2)`, [consultationId, todayTs]);

  // Insert a reminder
  await pool.query(`INSERT INTO medication_reminders (tenant_id, telegram_id, medicine_name, dosage, reminder_time, status)
    VALUES ('default', $1, 'Paratsetamol', '500mg', '08:00', 'active')
    ON CONFLICT DO NOTHING`, [telId]);

  console.log('Test data created successfully');
  process.exit(0);
}

seed().catch(e => { console.error('Error:', e.message); process.exit(1); });
