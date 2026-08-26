// ============================================================
// Falcon AI OS — Kanonik agentlar xartiyasi ("asosiy miya")
//
// Yo'l xarita talabi: 34 sochilgan agent o'rniga 12 ta KANONIK agent.
// Har bir kanonik agent uchun MAJBURIY deklaratsiya:
//   - mission                  aniq vazifasi
//   - data_scope               ko'ra oladigan ma'lumotlari
//   - actions                  bajara oladigan amallari
//   - requires_human_approval  inson tasdig'isiz bajarib BO'LMAYDIGAN
//                              harakatlari
//   - mapped_agents            hozirgi 34 agentdan qaysilari shu kanonik
//                              agentga xizmat qiladi
//
// Xartiya — deklarativ hujjat emas, RUNTIME nazoratining manbasi:
// runtime har ijroni shu xartiyadagi canonical_id bilan audit qiladi.
// ============================================================

export const CANONICAL_AGENTS = Object.freeze([
  Object.freeze({
    id: 'reception',
    name: 'Qabul va ro\'yxatga olish',
    status: 'active',
    mission:
      'Bemorlarni ro\'yxatga olish, qabulga yozish va kartani to\'ldirishni avtomatlashtirish.',
    data_scope: ['patients', 'appointments', 'doctor_schedules'],
    actions: ['create_patient', 'book_appointment', 'update_patient_card'],
    requires_human_approval: ['merge_patients', 'delete_patient'],
    mapped_agents: ['receptionist'],
  }),
  Object.freeze({
    id: 'queue-schedule',
    name: 'Navbat va qabul rejasi',
    status: 'planned',
    mission:
      'Jonli navbat, qabul jadvali optimallashtirish va kechikishlarni boshqarish.',
    data_scope: ['appointments', 'patient_queue', 'doctor_schedules'],
    actions: ['reorder_queue', 'propose_slot', 'notify_delay'],
    requires_human_approval: ['cancel_appointment', 'reassign_doctor'],
    mapped_agents: [],
  }),
  Object.freeze({
    id: 'scribe',
    name: 'Klinik hujjatlar (scribe)',
    status: 'active',
    mission:
      'Ovozdan tibbiy hujjat: qabul bayoni, epikriz, stasionar yozuvlar. RubaiSTT + LLM.',
    data_scope: ['patient_consultations', 'medical_reports', 'admissions', 'daily_notes'],
    actions: ['create_draft', 'generate_epicrisis'],
    requires_human_approval: ['confirm_record'],
    mapped_agents: [
      'medical-scribe', 'visit-scribe', 'admission-scribe',
      'obhod-scribe', 'epicrisis-writer',
    ],
  }),
  Object.freeze({
    id: 'doctor-copilot',
    name: 'Shifokor kopilot',
    status: 'active',
    mission:
      'Shifokorga taklif beradi (tashxis YO\'Q): ovoz buyruqlari, retsept/laboratoriya takliflari, dori tekshiruvi.',
    data_scope: ['patient_consultations', 'prescriptions', 'lab_orders'],
    actions: ['propose_action', 'medication_check', 'autofill_form'],
    requires_human_approval: ['execute_any_proposal'],
    mapped_agents: [
      'doctor-copilot', 'voice-command', 'smart-autofill',
      'medication-coach', 'drug-interaction',
    ],
  }),
  Object.freeze({
    id: 'finance',
    name: 'To\'lovlar va moliya',
    status: 'planned',
    mission:
      'To\'lovlar, cheklar, qarzdorlik va kassa jarayonlarini nazorat qilish.',
    data_scope: ['invoices', 'payment_transactions', 'financial_transactions'],
    actions: ['create_receipt', 'flag_debt', 'propose_discount'],
    requires_human_approval: ['refund_payment', 'write_off_debt'],
    mapped_agents: [],
  }),
  Object.freeze({
    id: 'inventory',
    name: 'Ombor va dorixona',
    status: 'active',
    mission:
      'Zaxira hisobi, muddat nazorati va xarid takliflari.',
    data_scope: ['inventory_items', 'inventory_batches', 'inventory_transactions'],
    actions: ['flag_low_stock', 'flag_expiry', 'propose_purchase'],
    requires_human_approval: ['confirm_purchase', 'write_off_stock'],
    mapped_agents: ['inventory-manager'],
  }),
  Object.freeze({
    id: 'wards',
    name: 'Shifoxona bo\'limlari',
    status: 'active',
    mission:
      'Yotoq boshqaruvi, yotqizish/kuzatish va holat monitoringi.',
    data_scope: ['wards', 'beds', 'admissions', 'daily_notes', 'vitals'],
    actions: ['propose_bed', 'flag_vital_anomaly', 'draft_daily_note'],
    requires_human_approval: ['confirm_bed', 'confirm_discharge'],
    mapped_agents: ['admission-summary', 'vitals-anomaly', 'vital-anomaly', 'lab-critical'],
  }),
  Object.freeze({
    id: 'patient-comm',
    name: 'Bemor bilan muloqot',
    status: 'active',
    mission:
      'Eslatmalar, qabuldan keyingi kuzatuv, savol-javob va tayyorgarlik yo\'riqnomalari.',
    data_scope: ['patients', 'appointments', 'telegram_users'],
    actions: ['send_reminder', 'answer_faq', 'send_instructions'],
    requires_human_approval: ['send_medical_advice'],
    mapped_agents: [
      'patient-chatbot', 'symptom-checker', 'photo-triage',
      'appointment-reminder', 'lab-result-ready',
      'follow-up-scheduler', 'preparation-instructor',
    ],
  }),
  Object.freeze({
    id: 'diagnostics',
    name: 'Diagnostika yo\'nalishi',
    status: 'partial',
    mission:
      'Triaj, tashxis takliflari va laboratoriya natijalarini sharhlash (faqat taklif).',
    data_scope: ['lab_orders', 'medical_reports', 'patient_consultations'],
    actions: ['suggest_diagnosis', 'interpret_lab', 'triage'],
    requires_human_approval: ['confirm_diagnosis'],
    mapped_agents: [
      'triage-agent', 'diagnosis-suggester',
      'lab-conclusion-helper', 'lab-interpreter',
    ],
  }),
  Object.freeze({
    id: 'analytics',
    name: 'Analitika va prognoz',
    status: 'active',
    mission:
      'Daromad prognozi, xodim samaradorligi, xizmat rentabelligi va mijoz yo\'qotish tahlili.',
    data_scope: ['usage_metering', 'invoices', 'appointments', 'doctor_analytics'],
    actions: ['generate_report', 'forecast_revenue', 'flag_anomaly'],
    requires_human_approval: [],
    mapped_agents: [
      'analytics-agent', 'revenue-forecaster', 'staff-utilization',
      'service-profitability', 'churn-detector',
    ],
  }),
  Object.freeze({
    id: 'marketing-referral',
    name: 'Marketing va yo\'naltirish',
    status: 'active',
    mission:
      'B2B yo\'naltirish hamkorlari va kampaniya takliflari.',
    data_scope: ['referrals', 'referral_partners', 'b2b_contracts'],
    actions: ['track_referral', 'propose_campaign'],
    requires_human_approval: ['sign_contract', 'send_campaign'],
    mapped_agents: ['referral-agent', 'b2b-referral'],
  }),
  Object.freeze({
    id: 'platform-monitoring',
    name: 'Platforma monitoring',
    status: 'planned',
    mission:
      'Tizim salomatligi, xavfsizlik va agent aniqligi ko\'rsatkichlarini kuzatish.',
    data_scope: ['agent_executions', 'usage_metering', 'audit_logs'],
    actions: ['alert_degraded_service', 'report_accuracy'],
    requires_human_approval: ['disable_agent'],
    mapped_agents: [],
  }),
]);

const byId = new Map(CANONICAL_AGENTS.map((a) => [a.id, a]));

/** Kanonik agentni id bo'yicha qaytaradi (yoki null) */
export function getCanonicalAgent(id) {
  return byId.get(id) || null;
}

/** Qaysi kanonik agentga tegishli ekanini registered agent nomi orqali topadi */
export function canonicalForAgent(agentName) {
  return CANONICAL_AGENTS.find((a) => a.mapped_agents.includes(agentName)) || null;
}

/**
 * Xarit holati: 12 kanonik agentning har biri uchun joriy qamrov.
 * `registered` — registry'dagi haqiqiy agent nomlari ro'yxati.
 * coverage = topilgan mapped agentlar / jami mapped agentlar.
 */
export function getCanonicalCoverage(registered = []) {
  const registeredSet = new Set(registered);
  const perAgent = CANONICAL_AGENTS.map((a) => {
    const found = a.mapped_agents.filter((n) => registeredSet.has(n));
    return {
      id: a.id,
      name: a.name,
      status: a.status,
      mapped_total: a.mapped_agents.length,
      mapped_found: found.length,
      missing: a.mapped_agents.filter((n) => !registeredSet.has(n)),
      coverage: a.mapped_agents.length === 0
        ? null
        : Math.round((found.length / a.mapped_agents.length) * 100),
    };
  });
  const mapped = CANONICAL_AGENTS.flatMap((a) => a.mapped_agents);
  const found = mapped.filter((n) => registeredSet.has(n));
  return {
    canonical_total: CANONICAL_AGENTS.length,
    mapped_total: mapped.length,
    mapped_found: found.length,
    coverage: mapped.length === 0
      ? null
      : Math.round((found.length / mapped.length) * 100),
    agents: perAgent,
  };
}
