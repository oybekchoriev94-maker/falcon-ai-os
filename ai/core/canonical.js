// ============================================================
// Falcon AI OS — Kanonik agentlar xartiyasi ("asosiy miya")
//
// Yo'l xarita talabi (PLATFORM-ROADMAP.md, "Asosiy AI agentlar"):
// 34 sochilgan agent o'rniga 12 ta KANONIK agent. Ro'yxat shu
// hujjatdagi tartib bilan birma-bir mos:
//
//   1. Reception             7. HR and Attendance
//   2. Doctor Copilot        8. Vision Security
//   3. Patient History       9. Finance Anomaly
//   4. Document/OCR         10. Clinic Director
//   5. Laboratory           11. Compliance and Audit
//   6. Pharmacy & Inventory 12. Patient Communication
//
// Har bir kanonik agent uchun MAJBURIY deklaratsiya:
//   - mission                  aniq vazifasi
//   - data_scope               ko'ra oladigan ma'lumotlari
//   - actions                  bajara oladigan amallari
//   - requires_human_approval  inson tasdig'isiz bajarib BO'LMAYDIGAN
//                              harakatlari
//   - mapped_agents            ro'yxatdagi agentlardan qaysilari shu kanonik
//                              agentga xizmat qiladi
//
// QAT'IY QOIDA (yo'l xarita): AI mustaqil ravishda yakuniy tashxis,
// retsept, xodim jazosi, pul qaytarish yoki omborni hisobdan chiqarishni
// amalga oshirmaydi — bularning hammasi requires_human_approval'da.
// ============================================================

export const CANONICAL_AGENTS = Object.freeze([
  Object.freeze({
    id: 'reception',
    name: 'Reception Agent',
    status: 'active',
    mission:
      'Bemorlarni ro\'yxatga olish, qabulga yozish, kartani to\'ldirish va yo\'llanma (referral) bilan kelgan bemorlarni kuzatish.',
    data_scope: ['patients', 'appointments', 'doctor_schedules', 'referrals', 'referral_partners'],
    actions: ['create_patient', 'book_appointment', 'update_patient_card', 'track_referral'],
    requires_human_approval: ['merge_patients', 'delete_patient'],
    mapped_agents: [],   // hozircha alohida agent yo'q — oqim kodda
  }),
  Object.freeze({
    id: 'doctor-copilot',
    name: 'Doctor Copilot',
    status: 'active',
    mission:
      'Shifokorga yordam beradi (o\'zi shifokor EMAS): ovoz buyruqlari, tashxis/triaj takliflari, dori tekshiruvi, vitallar anomaliyasi ogohlantirishi. Faqat TAKLIF darajasida.',
    data_scope: ['patient_consultations', 'prescriptions', 'lab_orders', 'daily_notes'],
    actions: ['propose_action', 'medication_check', 'autofill_form', 'suggest_diagnosis', 'triage', 'flag_vital_anomaly'],
    requires_human_approval: ['execute_any_proposal', 'confirm_diagnosis'],
    mapped_agents: [
      'doctor-copilot', 'voice-command', 'smart-autofill',
      'drug-interaction', 'triage-agent', 'vital-anomaly',
    ],
  }),
  Object.freeze({
    id: 'patient-history',
    name: 'Patient History Agent',
    status: 'active',
    mission:
      'Bemor tarixini yig\'adi: qabul bayonlari, yotqizish xulosalari va oldingi qabullar qisqachasini yagona timeline\'ga aylantiradi.',
    data_scope: ['patient_consultations', 'admissions', 'medical_reports', 'patients'],
    actions: ['summarize_history', 'create_visit_record', 'pre_visit_brief'],
    requires_human_approval: ['confirm_record'],
    mapped_agents: ['visit-scribe', 'admission-scribe', 'admission-summary'],
  }),
  Object.freeze({
    id: 'document-ocr',
    name: 'Document/OCR Agent',
    status: 'partial',
    mission:
      'Klinik hujjatlar: diktantdan bayon, epikriz, stasionar yozuvlar. Keyingi bosqich — eski qog\'oz kartalarni OCR bilan raqamlashtirish (PR #8).',
    data_scope: ['patient_consultations', 'medical_reports', 'daily_notes'],
    actions: ['create_draft', 'generate_epicrisis', 'ocr_import'],
    requires_human_approval: ['confirm_record'],
    mapped_agents: ['obhod-scribe', 'epicrisis-writer'],
  }),
  Object.freeze({
    id: 'laboratory',
    name: 'Laboratory Agent',
    status: 'active',
    mission:
      'Laboratoriya jarayoni: natijalarni sharhlash (faqat taklif), kritik qiymat ogohlantirishi, tayyor natija haqida xabar.',
    data_scope: ['lab_orders', 'medical_reports', 'patients'],
    actions: ['interpret_lab', 'draft_conclusion', 'flag_critical_value', 'notify_result_ready'],
    requires_human_approval: ['confirm_conclusion'],
    mapped_agents: ['lab-interpreter', 'lab-critical', 'lab-result-ready'],
  }),
  Object.freeze({
    id: 'pharmacy-inventory',
    name: 'Pharmacy and Inventory Agent',
    status: 'active',
    mission:
      'Ombor va dorixona: zaxira, muddat nazorati, xarid takliflari. Hisobdan chiqarishni O\'ZI qilmaydi.',
    data_scope: ['inventory_items', 'inventory_batches', 'inventory_transactions'],
    actions: ['flag_low_stock', 'flag_expiry', 'propose_purchase'],
    requires_human_approval: ['confirm_purchase', 'write_off_stock'],
    mapped_agents: [],   // ombor agenti o'chirilgan (chaqiruvchisi yo'q edi)
  }),
  Object.freeze({
    id: 'hr-attendance',
    name: 'HR and Attendance Agent',
    status: 'partial',
    mission:
      'Xodim smenasi va davomati: kechikish/erta ketish hisoboti, zona signallari. Hozircha deterministik qoidalar (/api/workers) ishlaydi; AI-agent keyingi bosqichda.',
    data_scope: ['staff_shifts', 'attendance_events', 'vision_events', 'vision_zone_rules'],
    actions: ['daily_attendance_report', 'zone_alert', 'propose_correction'],
    requires_human_approval: ['correct_attendance', 'any_penalty'],
    mapped_agents: [],
  }),
  Object.freeze({
    id: 'vision-security',
    name: 'Vision Security Agent',
    status: 'partial',
    mission:
      'Kamera hodisalarini tahlil qiladi: navbat, qarovsiz zona, ruxsatsiz kirish, kamera nosozligi. Raw video lokal qoladi; VPS\'ga faqat metadata. (falcon-vision-edge + /api/edge integratsiyasi tayyor.)',
    data_scope: ['vision_events', 'edge_nodes', 'vision_zone_rules'],
    actions: ['raise_security_alert', 'report_camera_fault'],
    requires_human_approval: ['confirm_incident'],
    mapped_agents: [],
  }),
  Object.freeze({
    id: 'finance-anomaly',
    name: 'Finance Anomaly Agent',
    status: 'partial',
    mission:
      'Moliyaviy prognoz va anomaliya: daromad prognozi, xizmat rentabelligi, kutilmagan to\'lov/naqd farqlari signalini beradi.',
    data_scope: ['invoices', 'payment_transactions', 'financial_transactions', 'usage_metering'],
    actions: ['forecast_revenue', 'profitability_report', 'flag_anomaly'],
    requires_human_approval: ['refund_payment', 'write_off_debt'],
    mapped_agents: ['revenue-forecaster', 'service-profitability'],
  }),
  Object.freeze({
    id: 'clinic-director',
    name: 'Clinic Director Agent',
    status: 'active',
    mission:
      'Direktor uchun umumiy tahlil: xodim samaradorligi KPI, bemor yo\'qotish xavfi, filial ko\'rsatkichlari va xavf xulosasi.',
    data_scope: ['doctor_analytics', 'appointments', 'patients', 'usage_metering'],
    actions: ['generate_report', 'churn_risk_report', 'staff_utilization_report'],
    requires_human_approval: [],
    mapped_agents: ['churn-detector', 'staff-utilization'],
  }),
  Object.freeze({
    id: 'compliance-audit',
    name: 'Compliance and Audit Agent',
    status: 'partial',
    mission:
      'Audit va muvofiqlik: agent ijrolari, kirish jurnallari va shubhali amallar bo\'yicha hisobot. (audit_logs va agent_executions tayyor; AI-tahlil keyingi bosqichda.)',
    data_scope: ['audit_logs', 'agent_executions', 'usage_metering'],
    actions: ['audit_report', 'flag_suspicious_access'],
    requires_human_approval: ['disable_user'],
    mapped_agents: [],
  }),
  Object.freeze({
    id: 'patient-communication',
    name: 'Patient Communication Agent',
    status: 'active',
    mission:
      'Bemor bilan muloqot: eslatmalar, tayyorgarlik yo\'riqnomalari, kuzatuv, savol-javob. Tibbiy maslahat bermaydi.',
    data_scope: ['patients', 'appointments', 'telegram_users'],
    actions: ['send_reminder', 'send_instructions', 'answer_faq', 'schedule_follow_up'],
    requires_human_approval: ['send_medical_advice'],
    mapped_agents: [
      'patient-chatbot', 'appointment-reminder', 'follow-up-scheduler',
    ],
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
