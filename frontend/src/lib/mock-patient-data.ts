// ============================================================
// FALCON AI OS — Patient Workspace mock data + type contracts
//
// Real API'dan (/api/patients/:id/history) kelmaydigan maydonlar uchun
// mock (masalan yurak urishi trendi, taqvim). API'dan kelgan haqiqiy
// ma'lumot bilan aralashib ishlaydi: agar server maydonini bersa —
// undan, aks holda mockdan.
// ============================================================

// ── TYPES ────────────────────────────────────────────────────

export type VitalStatus = "normal" | "warning" | "critical";

export interface VitalSign {
  key: "heart_rate" | "blood_pressure" | "glucose" | "temperature";
  label: string;
  value: string;
  unit: string;
  status: VitalStatus;
  trend?: number[];       // sparkline uchun oxirgi qiymatlar
  updated_at: string;
  hint?: string;          // norma oralig'i
}

export type ReportKind = "ai_scribe" | "lab" | "imaging" | "epicrisis" | "other";

export interface HealthReport {
  id: string;
  kind: ReportKind;
  title: string;
  fileName: string;
  ext: "pdf" | "docx" | "jpg" | "png";
  sizeKB: number;
  createdAt: string;
  createdBy?: string;
  url?: string;
}

export type MedicalEventKind =
  | "diagnosis" | "surgery" | "checkup" | "vaccination" | "admission" | "lab_result";

export interface MedicalEvent {
  id: string;
  kind: MedicalEventKind;
  title: string;
  description?: string;
  doctor?: string;
  date: string;             // ISO
  icon?: "shield" | "scalpel" | "check" | "syringe" | "bed" | "flask";
}

export type TreatmentStatus = "active" | "paused" | "completed";

export interface Treatment {
  id: string;
  medicine: string;
  dosage: string;
  route: string;              // "ichish" | "v/m" | "v/v" | ...
  frequency: string;          // "kunda 3 mahal"
  startDate: string;
  endDate?: string;
  status: TreatmentStatus;
  prescribedBy?: string;
}

export interface UpcomingAppointment {
  id: string;
  date: string;               // ISO
  doctorName: string;
  doctorSpecialty?: string;
  serviceName?: string;
  isToday?: boolean;
  isTomorrow?: boolean;
}

export interface ClinicalAlert {
  chronicConditions: string[];
  drugAllergies: string[];
  foodAllergies: string[];
}

export interface Patient {
  id: string;
  fullName: string;
  firstName: string;
  lastName?: string;
  middleName?: string;
  gender: "erkak" | "ayol" | string;
  birthDate?: string;
  ageYears?: number;
  location?: string;
  medicalRecordNumber?: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
  bloodGroup?: string;
  rhFactor?: string;
}

export interface PatientWorkspace {
  patient: Patient;
  vitals: VitalSign[];
  reports: HealthReport[];
  history: MedicalEvent[];
  upcoming: UpcomingAppointment[];
  treatments: Treatment[];
  alerts: ClinicalAlert;
}

// ── FALLBACK BUILDER ────────────────────────────────────────
// API haqiqiy bemor uchun kam ma'lumot qaytarsa, bu builder mock qiymatlar
// bilan to'ldiradi (UI hech qachon bo'sh chiqmaydi).

interface HistoryApiShape {
  patient?: {
    id?: string;
    first_name?: string;
    last_name?: string | null;
    middle_name?: string | null;
    gender?: string;
    birth_date?: string;
    district?: string | null;
    address?: string | null;
    region?: string | null;
    medical_record_number?: string | null;
    phone?: string | null;
    blood_group?: string | null;
    rh_factor?: string | null;
    allergies?: string | null;
    notes?: string | null;
  };
  appointments?: Array<{
    id: number | string;
    scheduled_at: string;
    doctor_name?: string | null;
    service_name?: string | null;
    status?: string;
  }>;
  consultations?: Array<{
    id: string;
    created_at: string;
    data_json?: { diagnosis?: string; procedure?: string; medicines?: string; notes?: string } | string | null;
  }>;
  admissions?: Array<{
    id: string;
    admission_date: string;
    discharge_date?: string | null;
    diagnosis_initial?: string | null;
    diagnosis_final?: string | null;
    attending_doctor_name?: string | null;
  }>;
  reports?: Array<{
    id: string;
    specialization?: string;
    specialization_label?: string;
    pdf_path?: string | null;
    created_at: string;
  }>;
}

function ageFromBirth(iso?: string): number | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = Date.now();
  return Math.floor((now - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

function parseAllergies(raw?: string | null): { drug: string[]; food: string[] } {
  if (!raw) return { drug: [], food: [] };
  const items = raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const drug: string[] = [];
  const food: string[] = [];
  for (const it of items) {
    const low = it.toLowerCase();
    if (/(taom|oziq|food|ovqat|milk|egg|nut|fruit)/i.test(low)) food.push(it);
    else drug.push(it);
  }
  return { drug, food };
}

export function buildWorkspaceFromHistory(api: HistoryApiShape): PatientWorkspace {
  const p = api.patient || {};
  const fullName = [p.last_name, p.first_name, p.middle_name].filter(Boolean).join(" ").trim();
  const location = [p.region, p.district, p.address].filter(Boolean).join(", ");

  const patient: Patient = {
    id: p.id || "unknown",
    fullName: fullName || "Noma'lum bemor",
    firstName: p.first_name || "",
    lastName: p.last_name || undefined,
    middleName: p.middle_name || undefined,
    gender: (p.gender as Patient["gender"]) || "erkak",
    birthDate: p.birth_date || undefined,
    ageYears: ageFromBirth(p.birth_date),
    location: location || undefined,
    medicalRecordNumber: p.medical_record_number || undefined,
    phone: p.phone || undefined,
    bloodGroup: p.blood_group || undefined,
    rhFactor: p.rh_factor || undefined,
  };

  // ── VITALS (mock — real time ko'rsatkichlar hozircha statik demo) ──
  const vitals: VitalSign[] = [
    {
      key: "heart_rate", label: "Yurak urishi", value: "72", unit: "b/d",
      status: "normal", trend: [70, 72, 71, 73, 72, 74, 72],
      updated_at: new Date().toISOString(), hint: "Norma: 60-100",
    },
    {
      key: "blood_pressure", label: "Qon bosimi", value: "120/80", unit: "mmHg",
      status: "normal", updated_at: new Date().toISOString(),
      hint: "Norma: <130/85",
    },
    {
      key: "glucose", label: "Qand darajasi", value: "5.4", unit: "mmol/l",
      status: "normal", trend: [5.2, 5.4, 5.6, 5.3, 5.4, 5.5, 5.4],
      updated_at: new Date().toISOString(), hint: "Norma: 3.5-6.1",
    },
    {
      key: "temperature", label: "Tana harorati", value: "36.6", unit: "°C",
      status: "normal", updated_at: new Date().toISOString(),
      hint: "Norma: 36.1-37.2",
    },
  ];

  // ── REPORTS (haqiqiy medical_reports bo'lsa API'dan) ──
  const reports: HealthReport[] = (api.reports || []).map((r) => ({
    id: r.id,
    kind: "epicrisis" as ReportKind,
    title: r.specialization_label || r.specialization || "Tibbiy hisobot",
    fileName: r.pdf_path?.split("/").pop() || `report_${r.id}.pdf`,
    ext: "pdf",
    sizeKB: 240,
    createdAt: r.created_at,
    url: r.pdf_path ? `/api/reports/pdf/${r.pdf_path}` : undefined,
  }));
  // Real reports kam bo'lsa, AI Scribe konsultatsiyalarini ham fayl deb ko'rsatamiz
  for (const c of api.consultations || []) {
    reports.push({
      id: `c-${c.id}`,
      kind: "ai_scribe",
      title: "AI Scribe xulosasi",
      fileName: `ai_scribe_${new Date(c.created_at).toISOString().slice(0, 10)}.pdf`,
      ext: "pdf",
      sizeKB: 90,
      createdAt: c.created_at,
    });
  }

  // ── HISTORY TIMELINE ──
  const history: MedicalEvent[] = [];
  for (const c of api.consultations || []) {
    const dj = typeof c.data_json === "string"
      ? (() => { try { return JSON.parse(c.data_json as string); } catch { return null; } })()
      : c.data_json || null;
    if (dj?.diagnosis) {
      history.push({
        id: `dx-${c.id}`,
        kind: "diagnosis",
        title: dj.diagnosis,
        description: dj.procedure || undefined,
        date: c.created_at,
        icon: "shield",
      });
    }
  }
  for (const a of api.admissions || []) {
    history.push({
      id: `adm-${a.id}`,
      kind: "admission",
      title: a.diagnosis_final || a.diagnosis_initial || "Statsionar yotqizish",
      description: a.attending_doctor_name || undefined,
      date: a.admission_date,
      icon: "bed",
    });
  }
  for (const ap of api.appointments || []) {
    if (String(ap.status) === "completed") {
      history.push({
        id: `apt-${ap.id}`,
        kind: "checkup",
        title: ap.service_name || "Ko'rik",
        description: ap.doctor_name || undefined,
        date: ap.scheduled_at,
        icon: "check",
      });
    }
  }
  history.sort((a, b) => (a.date < b.date ? 1 : -1));

  // ── UPCOMING ──
  const now = Date.now();
  const upcoming: UpcomingAppointment[] = (api.appointments || [])
    .filter((a) => new Date(a.scheduled_at).getTime() > now && a.status !== "cancelled")
    .slice(0, 5)
    .map((a) => {
      const d = new Date(a.scheduled_at);
      const dayDiff = Math.floor((d.getTime() - now) / (24 * 60 * 60 * 1000));
      return {
        id: String(a.id),
        date: a.scheduled_at,
        doctorName: a.doctor_name || "Shifokor",
        serviceName: a.service_name || undefined,
        isToday: dayDiff === 0,
        isTomorrow: dayDiff === 1,
      };
    });

  // ── TREATMENTS (mock — hozirda API'da active prescriptions filtri yo'q) ──
  // Kelajakda /api/inpatient/prescriptions?patient_id=... bilan almashinadi.
  const treatments: Treatment[] = api.admissions?.length ? [
    {
      id: "t1", medicine: "Amoksitsillin", dosage: "500 mg", route: "ichish",
      frequency: "kunda 3 mahal", startDate: new Date(Date.now() - 3 * 86400000).toISOString(),
      endDate: new Date(Date.now() + 4 * 86400000).toISOString(),
      status: "active", prescribedBy: api.admissions[0].attending_doctor_name || undefined,
    },
    {
      id: "t2", medicine: "Paratsetamol", dosage: "500 mg", route: "ichish",
      frequency: "kerak bo'lsa", startDate: new Date(Date.now() - 2 * 86400000).toISOString(),
      status: "active",
    },
  ] : [];

  // ── CLINICAL ALERTS ──
  const parsed = parseAllergies(p.allergies);
  const alerts: ClinicalAlert = {
    chronicConditions: [], // kelajakda patients.chronic_conditions maydonidan
    drugAllergies: parsed.drug,
    foodAllergies: parsed.food,
  };

  return { patient, vitals, reports, history, upcoming, treatments, alerts };
}

// ── UZBEK DATE HELPERS ──────────────────────────────────────

export function fmtDateUz(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uz-UZ", { day: "numeric", month: "long", year: "numeric" });
}

export function fmtDateShortUz(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function fmtDateTimeUz(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("uz-UZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
