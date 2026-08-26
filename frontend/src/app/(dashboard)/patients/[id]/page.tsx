"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Phone,
  MapPin,
  Calendar,
  FolderOpen,
  Stethoscope,
  Mic,
  FileText,
  BedDouble,
  ClipboardCheck,
  ShieldAlert,
  Activity,
  FlaskConical,
  Plus,
  FileSignature,
  Receipt,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { VitalsCards } from "@/components/patient-detail/vitals-cards";
import type { VitalSign } from "@/lib/mock-patient-data";

interface Patient {
  id: string;
  first_name: string;
  last_name?: string;
  middle_name?: string;
  phone?: string;
  birth_date?: string;
  region?: string;
  district?: string;
  address?: string;
  medical_record_number?: string;
  gender?: string;
  passport_number?: string;
  notes?: string;
  created_at?: string;
  // Bosqich A
  blood_group?: string;
  rh_factor?: string;
  allergies?: string;
  occupation?: string;
  workplace?: string;
  disability_group?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relation?: string;
}

interface AppointmentRow {
  id: string;
  appointment_id: string;
  scheduled_at: string;
  doctor_name: string;
  status: string;
  payment_status: string;
  amount: number;
  service_name?: string;
}

interface ConsultationRow {
  id: string;
  doctor_id?: string;
  raw_text?: string;
  data_json?: Record<string, unknown> | string;
  created_at: string;
}

interface ReportRow {
  id: string;
  specialization: string;
  specialization_label?: string;
  data_json?: Record<string, unknown> | string;
  pdf_path?: string;
  created_at: string;
}

interface AdmissionRow {
  id: string;
  admission_date: string;
  discharge_date?: string;
  diagnosis_initial?: string;
  diagnosis_final?: string;
  attending_doctor_name?: string;
  status: string;
}

interface LabRow {
  id: string;
  test_type: string;
  test_name?: string | null;
  reason?: string | null;
  status: string;
  ordered_at: string;
  ordered_by_doctor_name?: string | null;
  completed_at?: string | null;
  performed_by_name?: string | null;
  result_values?: Record<string, unknown> | null;
  result_conclusion?: string | null;
  result_pdf?: string | null;
}

const LAB_TYPE_LABELS: Record<string, string> = {
  blood_general: "Umumiy qon",
  urine_general: "Umumiy peshob",
  biochem: "Bioximik tahlil",
  coagulo: "Koagulogramma",
  ekg: "EKG",
  rentgen: "Rentgen",
  uzi: "UTT / UZI",
  efgds: "EFGDS",
  msct_mrt: "MSKT / MRT",
  specialist: "Mutaxasis maslahati",
  custom: "Boshqa",
};

interface IntakeRow {
  id: string;
  admission_id?: string | null;
  examined_at: string;
  doctor_name?: string | null;
  brought_by?: string | null;
  complaint_pain?: string | null;
  preliminary_diagnosis?: string | null;
}
interface EpiRow {
  id: string;
  admission_id?: string | null;
  collected_at: string;
  doctor_name?: string | null;
  infection_contact?: boolean;
  travel_last_month?: boolean;
  had_transfusion?: boolean;
  had_surgery_6mo?: boolean;
  epi_diagnosis?: string | null;
}

/** Oxirgi obhoddan olingan hayotiy ko'rsatkichlar (Bosqich S) */
interface LatestVitals {
  recorded_at?: string;
  temperature?: number | null;
  blood_pressure?: string | null;
  pulse?: number | null;
  respiration?: number | null;
  saturation?: number | null;
}

interface HistoryPayload {
  success: boolean;
  patient: Patient;
  appointments: AppointmentRow[];
  consultations: ConsultationRow[];
  reports: ReportRow[];
  admissions: AdmissionRow[];
  intakes?: IntakeRow[];
  epis?: EpiRow[];
  labs?: LabRow[];
  latest_vitals?: LatestVitals | null;
  vitals_trend?: {
    pulse?: number[];
    temperature?: number[];
    saturation?: number[];
  };
}

function fmtDate(s?: string) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateTime(s?: string) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtMoney(n?: number) {
  if (n == null) return "—";
  return new Intl.NumberFormat("uz-UZ").format(n) + " so'm";
}
function initials(p: Patient) {
  return `${(p.first_name || "")[0] || ""}${(p.last_name || "")[0] || ""}`.toUpperCase() || "?";
}

/**
 * Hayotiy ko'rsatkichlar kartalarini oxirgi obhod (daily_notes) yozuvidan
 * quradi. Backend `latest_vitals` bermasa — bo'sh holat ko'rsatiladi
 * (soxta qiymat chiqarmaymiz, bu klinik xavfsizlik talabi).
 */
function buildVitalsFromHistory(data: HistoryPayload): VitalSign[] {
  const v = data.latest_vitals;
  const at = v?.recorded_at || new Date().toISOString();

  const bpStatus = (): VitalSign["status"] => {
    if (!v?.blood_pressure) return "normal";
    const m = String(v.blood_pressure).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
    if (!m) return "normal";
    const sys = Number(m[1]), dia = Number(m[2]);
    if (sys >= 180 || dia >= 110 || sys <= 80) return "critical";
    if (sys >= 160 || dia >= 100) return "warning";
    return "normal";
  };
  const tempStatus = (): VitalSign["status"] => {
    if (v?.temperature == null) return "normal";
    if (v.temperature >= 39.5 || v.temperature <= 35) return "critical";
    if (v.temperature >= 38.5) return "warning";
    return "normal";
  };
  const pulseStatus = (): VitalSign["status"] => {
    if (v?.pulse == null) return "normal";
    if (v.pulse >= 130 || v.pulse <= 40) return "critical";
    if (v.pulse >= 110 || v.pulse <= 50) return "warning";
    return "normal";
  };
  const satStatus = (): VitalSign["status"] => {
    if (v?.saturation == null) return "normal";
    if (v.saturation <= 88) return "critical";
    if (v.saturation <= 92) return "warning";
    return "normal";
  };

  return [
    {
      key: "heart_rate", label: "Yurak urishi",
      value: v?.pulse != null ? String(v.pulse) : "—",
      unit: "b/d", status: pulseStatus(),
      trend: data.vitals_trend?.pulse,
      updated_at: at, hint: "Norma: 60-100",
    },
    {
      key: "blood_pressure", label: "Qon bosimi",
      value: v?.blood_pressure || "—",
      unit: "mmHg", status: bpStatus(),
      updated_at: at, hint: "Norma: <130/85",
    },
    {
      key: "glucose", label: "Saturatsiya",
      value: v?.saturation != null ? String(v.saturation) : "—",
      unit: "%", status: satStatus(),
      trend: data.vitals_trend?.saturation,
      updated_at: at, hint: "Norma: >94",
    },
    {
      key: "temperature", label: "Tana harorati",
      value: v?.temperature != null ? String(v.temperature) : "—",
      unit: "°C", status: tempStatus(),
      trend: data.vitals_trend?.temperature,
      updated_at: at, hint: "Norma: 36.1-37.2",
    },
  ];
}

export default function PatientHistoryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [epiOpen, setEpiOpen] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const [labResultFor, setLabResultFor] = useState<LabRow | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["patient-history", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await api.get<HistoryPayload>(`/api/patients/${id}/history`);
      if (!res.success) throw new Error(res.error || "Bemor kartasi topilmadi");
      return res;
    },
  });

  if (isLoading) return <LoadingSkeleton />;

  if (error || !data?.patient) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="size-4" /> Ortga
        </Button>
        <Card className="border-destructive/40">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Bemor topilmadi"}
          </CardContent>
        </Card>
      </div>
    );
  }

  const p = data.patient;
  const fullName = `${p.last_name || ""} ${p.first_name} ${p.middle_name || ""}`.trim();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">Bemor kartasi</h1>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setIntakeOpen(true)}>
            <ClipboardCheck className="size-4" /> Birlamchi ko&apos;rik
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEpiOpen(true)}>
            <ShieldAlert className="size-4" /> Epi-anamnez
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLabOpen(true)}>
            <FlaskConical className="size-4" /> Tekshiruv buyurish
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConsentOpen(true)}>
            <FileSignature className="size-4" /> Rozilik
          </Button>
          <Button size="sm" variant="outline" onClick={() => setContractOpen(true)}>
            <Receipt className="size-4" /> Shartnoma
          </Button>
        </div>
      </div>

      <IntakeDialog open={intakeOpen} patientId={id} onClose={() => setIntakeOpen(false)} />
      <EpiDialog open={epiOpen} patientId={id} onClose={() => setEpiOpen(false)} />
      <LabOrderDialog open={labOpen} patientId={id} onClose={() => setLabOpen(false)} />
      <LabResultDialog order={labResultFor} onClose={() => setLabResultFor(null)} />
      <ConsentDialog open={consentOpen} patientId={id} onClose={() => setConsentOpen(false)} />
      <ContractDialog open={contractOpen} patientId={id} onClose={() => setContractOpen(false)} />

      {/* Karta boshi — asosiy identifikatsiya */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <Avatar className="size-14">
              <AvatarFallback className="bg-primary/10 text-primary text-base">{initials(p)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold truncate">{fullName}</h2>
              <div className="flex flex-wrap gap-2 mt-2">
                {p.medical_record_number && (
                  <Badge variant="secondary" className="gap-1">
                    <FolderOpen className="size-3" /> {p.medical_record_number}
                  </Badge>
                )}
                {p.phone && (
                  <Badge variant="outline" className="gap-1">
                    <Phone className="size-3" /> {p.phone}
                  </Badge>
                )}
                {p.birth_date && (
                  <Badge variant="outline" className="gap-1">
                    <Calendar className="size-3" /> {fmtDate(p.birth_date)}
                  </Badge>
                )}
                {(p.district || p.address) && (
                  <Badge variant="outline" className="gap-1">
                    <MapPin className="size-3" /> {[p.district, p.address].filter(Boolean).join(", ")}
                  </Badge>
                )}
              </div>
              {p.notes && <p className="text-sm text-muted-foreground mt-3">{p.notes}</p>}
            </div>
          </div>

          {/* Tibbiy identifikatsiya — favqulodda holatda birinchi ko'rish kerak bo'lgan */}
          {(p.blood_group || p.rh_factor || p.allergies || p.emergency_contact_name) && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3 border-t border-border/40 pt-4">
              {(p.blood_group || p.rh_factor) && (
                <div className="rounded-lg bg-rose-500/5 border border-rose-500/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Qon guruhi</p>
                  <p className="text-lg font-bold">{p.blood_group || "?"} {p.rh_factor || ""}</p>
                </div>
              )}
              {p.allergies && (
                <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Allergiya</p>
                  <p className="text-sm">{p.allergies}</p>
                </div>
              )}
              {p.emergency_contact_name && (
                <div className="rounded-lg bg-muted/50 p-3 sm:col-span-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Yaqin qarindosh</p>
                  <p className="text-sm">
                    {p.emergency_contact_name}
                    {p.emergency_contact_relation && <span className="text-muted-foreground"> ({p.emergency_contact_relation})</span>}
                    {p.emergency_contact_phone && <span className="ml-2 font-mono">{p.emergency_contact_phone}</span>}
                  </p>
                </div>
              )}
              {(p.occupation || p.workplace) && (
                <div className="rounded-lg bg-muted/50 p-3 sm:col-span-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ish joyi</p>
                  <p className="text-sm">
                    {p.occupation}{p.occupation && p.workplace ? " · " : ""}{p.workplace}
                    {p.disability_group && <span className="ml-2 text-muted-foreground">Nogironlik: {p.disability_group} guruh</span>}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hayotiy ko'rsatkichlar — oxirgi obhoddan (Bosqich S) */}
      <VitalsCards vitals={buildVitalsFromHistory(data)} />

      {/* Tashriflar (bronlar) */}
      <Section
        icon={<Stethoscope className="size-4" />}
        title="Tashriflar"
        count={data.appointments.length}
        emptyText="Hali bron qilinmagan"
      >
        {data.appointments.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-3 py-2 border-b border-border/40 last:border-0">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{a.service_name || "Xizmat ko'rsatilmagan"}</p>
              <p className="text-xs text-muted-foreground">
                {fmtDateTime(a.scheduled_at)} · {a.doctor_name}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-sm font-medium">{fmtMoney(a.amount)}</span>
              <div className="flex gap-1">
                <Badge variant={a.status === "completed" ? "default" : a.status === "cancelled" ? "destructive" : "secondary"} className="text-[10px]">
                  {a.status}
                </Badge>
                <Badge variant={a.payment_status === "paid" ? "default" : "outline"} className="text-[10px]">
                  {a.payment_status}
                </Badge>
              </div>
            </div>
          </div>
        ))}
      </Section>

      {/* Yotqizishlar (statsionar) */}
      <Section
        icon={<BedDouble className="size-4" />}
        title="Statsionar"
        count={data.admissions.length}
        emptyText="Yotqizilmagan"
      >
        {data.admissions.map((ad) => (
          <AdmissionRow key={ad.id} admission={ad} />
        ))}
      </Section>

      {/* Birlamchi qabul ko'riklari (Bosqich B) */}
      <Section
        icon={<ClipboardCheck className="size-4" />}
        title="Birlamchi qabul ko'riklari"
        count={data.intakes?.length || 0}
        emptyText="Hali birlamchi ko'rik yo'q"
      >
        {(data.intakes || []).map((it) => (
          <div key={it.id} className="py-2 border-b border-border/40 last:border-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {it.preliminary_diagnosis && (
                  <p className="text-sm font-medium">{it.preliminary_diagnosis}</p>
                )}
                {it.complaint_pain && (
                  <p className="text-xs text-muted-foreground line-clamp-2">Shikoyat: {it.complaint_pain}</p>
                )}
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {it.doctor_name || "—"}
                  {it.brought_by && ` · keltirilishi: ${it.brought_by}`}
                </p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{fmtDateTime(it.examined_at)}</span>
            </div>
          </div>
        ))}
      </Section>

      {/* Epi-anamnez (SanPIN) */}
      <Section
        icon={<ShieldAlert className="size-4" />}
        title="Epi-anamnez (SanPIN)"
        count={data.epis?.length || 0}
        emptyText="Epi-anamnez yig'ilmagan"
      >
        {(data.epis || []).map((ep) => {
          const risks: string[] = [];
          if (ep.infection_contact) risks.push("kontakt");
          if (ep.travel_last_month) risks.push("sayohat");
          if (ep.had_transfusion) risks.push("gemotransfuziya");
          if (ep.had_surgery_6mo) risks.push("6oy jarrohlik");
          return (
            <div key={ep.id} className="py-2 border-b border-border/40 last:border-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {ep.epi_diagnosis && <p className="text-sm font-medium">{ep.epi_diagnosis}</p>}
                  {risks.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {risks.map((r) => (
                        <Badge key={r} variant="destructive" className="text-[10px]">{r}</Badge>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground/70 mt-0.5">{ep.doctor_name || "—"}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{fmtDateTime(ep.collected_at)}</span>
              </div>
            </div>
          );
        })}
      </Section>

      {/* Laborator tekshiruvlar (Bosqich D) */}
      <Section
        icon={<FlaskConical className="size-4" />}
        title="Laborator tekshiruvlar"
        count={data.labs?.length || 0}
        emptyText="Tekshiruv buyurilmagan"
      >
        {(data.labs || []).map((lb) => (
          <div key={lb.id} className="py-2 border-b border-border/40 last:border-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {LAB_TYPE_LABELS[lb.test_type] || lb.test_type}
                  {lb.test_name && <span className="text-muted-foreground"> · {lb.test_name}</span>}
                </p>
                {lb.reason && <p className="text-xs text-muted-foreground">Sabab: {lb.reason}</p>}
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                  Buyurdi: {lb.ordered_by_doctor_name || "—"} · {fmtDate(lb.ordered_at)}
                </p>
                {lb.result_conclusion && (
                  <p className="text-xs mt-1 rounded bg-emerald-500/5 border border-emerald-500/20 p-2">{lb.result_conclusion}</p>
                )}
                {lb.result_values && Object.keys(lb.result_values).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(lb.result_values).slice(0, 6).map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="text-[10px] font-mono">
                        {k}: {String(v)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge
                  variant={lb.status === "completed" ? "default" : lb.status === "cancelled" ? "destructive" : "outline"}
                  className="text-[10px]"
                >
                  {lb.status === "completed" ? "tayyor" : lb.status === "cancelled" ? "bekor" : "buyurildi"}
                </Badge>
                {lb.status !== "completed" && lb.status !== "cancelled" && (
                  <button onClick={() => setLabResultFor(lb)}
                    className="text-[10px] text-primary hover:underline">natija kirit</button>
                )}
                {lb.result_pdf && (
                  <a href={`/uploads/${lb.result_pdf}`} target="_blank" rel="noopener"
                    className="text-[10px] text-primary hover:underline">PDF</a>
                )}
              </div>
            </div>
          </div>
        ))}
      </Section>

      {/* AI Scribe konsultatsiyalari */}
      <Section
        icon={<Mic className="size-4" />}
        title="AI Scribe yozuvlari"
        count={data.consultations.length}
        emptyText="Hali diktant yozilmagan"
      >
        {data.consultations.map((c) => {
          const dj = typeof c.data_json === "string" ? safeParse(c.data_json) : c.data_json;
          const diagnosis = (dj as { diagnosis?: string })?.diagnosis;
          return (
            <div key={c.id} className="py-2 border-b border-border/40 last:border-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {diagnosis && <p className="text-sm font-medium">{diagnosis}</p>}
                  {c.raw_text && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{c.raw_text}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{fmtDateTime(c.created_at)}</span>
              </div>
            </div>
          );
        })}
      </Section>

      {/* Tibbiy hisobotlar (PDF) */}
      <Section
        icon={<FileText className="size-4" />}
        title="Tibbiy hisobotlar"
        count={data.reports.length}
        emptyText="Hisobot yo'q"
      >
        {data.reports.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
            <div>
              <p className="text-sm font-medium">{r.specialization_label || r.specialization}</p>
              <p className="text-xs text-muted-foreground">{fmtDateTime(r.created_at)}</p>
            </div>
            {r.pdf_path && (
              <Link href={`/api/reports/pdf/${r.pdf_path}`} target="_blank"
                    className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent">
                PDF
              </Link>
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({
  icon, title, count, emptyText, children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-muted-foreground">{icon}</span>
          <h3 className="text-sm font-semibold">{title}</h3>
          <Badge variant="secondary" className="ml-auto">{count}</Badge>
        </div>
        {count === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{emptyText}</p>
        ) : (
          <div>{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}

// ── Har admission uchun qator + inline "Xarorat varaqasi" grafigi ──
function AdmissionRow({ admission: ad }: { admission: AdmissionRow }) {
  const [showChart, setShowChart] = useState(false);
  return (
    <div className="py-2 border-b border-border/40 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {fmtDate(ad.admission_date)}
            {ad.discharge_date && ` — ${fmtDate(ad.discharge_date)}`}
          </p>
          <p className="text-xs text-muted-foreground">{ad.attending_doctor_name || "—"}</p>
          {(ad.diagnosis_initial || ad.diagnosis_final) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {ad.diagnosis_final || ad.diagnosis_initial}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="secondary" className="text-[10px]">{ad.status}</Badge>
          <button
            onClick={() => setShowChart((s) => !s)}
            className="text-[10px] text-primary hover:underline flex items-center gap-1"
          >
            <Activity className="size-3" /> {showChart ? "yopish" : "xarorat varaqasi"}
          </button>
        </div>
      </div>
      {showChart && <VitalsChart admissionId={ad.id} />}
    </div>
  );
}

interface VitalsPoint {
  id: string;
  date: string;
  shift: string;
  at: string;
  temperature: number | null;
  bp_sys: number | null;
  bp_dia: number | null;
  blood_pressure?: string | null;
  pulse: number | null;
  respiration: number | null;
  saturation: number | null;
}

function VitalsChart({ admissionId }: { admissionId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["vitals", admissionId],
    queryFn: async () => {
      const res = await api.get<{ points: VitalsPoint[] }>(`/api/inpatient/admissions/${admissionId}/vitals`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  if (isLoading) return <Skeleton className="h-40 w-full mt-3" />;
  const points = data?.points ?? [];
  if (points.length === 0) {
    return <p className="text-xs text-muted-foreground mt-3">Bu yotqizishda obhod yozuvi yo&apos;q</p>;
  }

  // X o'qi uchun qisqa yorliq: 03/09 e (ertalab) / k (kechqurun)
  const chartData = points.map((p) => ({
    ...p,
    label: `${new Date(p.date).toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit" })} ${p.shift === "kechqurun" ? "k" : "e"}`,
  }));

  return (
    <div className="mt-3 space-y-3">
      {/* Harorat + puls */}
      <div className="rounded-lg border border-border/40 p-2">
        <p className="text-[10px] text-muted-foreground mb-1 px-1">Harorat va puls</p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="temp" domain={[35, 41]} tick={{ fontSize: 10 }} />
            <YAxis yAxisId="pulse" orientation="right" domain={[40, 140]} tick={{ fontSize: 10 }} />
            <ChartTooltip contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line yAxisId="temp" type="monotone" dataKey="temperature" name="t°" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            <Line yAxisId="pulse" type="monotone" dataKey="pulse" name="Puls" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Qon bosimi */}
      <div className="rounded-lg border border-border/40 p-2">
        <p className="text-[10px] text-muted-foreground mb-1 px-1">Qon bosimi (sistolik/diastolik)</p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis domain={[50, 200]} tick={{ fontSize: 10 }} />
            <ChartTooltip contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="bp_sys" name="Sistolik" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey="bp_dia" name="Diastolik" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Birlamchi qabul ko'rigi dialogi ──
function IntakeDialog({ open, patientId, onClose }: { open: boolean; patientId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [broughtBy, setBroughtBy] = useState<"ozi_kelgan" | "ttyo" | "boshqa_dpm">("ozi_kelgan");
  const [complaintPain, setComplaintPain] = useState("");
  const [complaintPainLoc, setComplaintPainLoc] = useState("");
  const [complaintPainChar, setComplaintPainChar] = useState("");
  const [complaintOther, setComplaintOther] = useState("");
  const [anamnesisMorbi, setAnamnesisMorbi] = useState("");
  const [anamnesisVitae, setAnamnesisVitae] = useState("");
  const [statusPraesens, setStatusPraesens] = useState("");
  const [statusLocalis, setStatusLocalis] = useState("");
  const [prelimDx, setPrelimDx] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!patientId) throw new Error("Bemor ID topilmadi");
      const res = await api.post(`/api/patients/${patientId}/intake`, {
        brought_by: broughtBy,
        complaint_pain: complaintPain || undefined,
        complaint_pain_location: complaintPainLoc || undefined,
        complaint_pain_character: complaintPainChar || undefined,
        complaint_other: complaintOther || undefined,
        anamnesis_morbi: anamnesisMorbi || undefined,
        anamnesis_vitae: anamnesisVitae || undefined,
        status_praesens: statusPraesens || undefined,
        status_localis: statusLocalis || undefined,
        preliminary_diagnosis: prelimDx || undefined,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Birlamchi ko'rik saqlandi");
      qc.invalidateQueries({ queryKey: ["patient-history", patientId] });
      setComplaintPain(""); setComplaintPainLoc(""); setComplaintPainChar(""); setComplaintOther("");
      setAnamnesisMorbi(""); setAnamnesisVitae(""); setStatusPraesens(""); setStatusLocalis(""); setPrelimDx("");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton>
        <DialogHeader>
          <DialogTitle>Birlamchi qabul ko&apos;rigi</DialogTitle>
          <DialogDescription>003-forma 3-bet — qabul bo&apos;limi shifokorining ko&apos;rigi</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Keltirilish usuli</Label>
            <div className="flex gap-2">
              {[
                { v: "ozi_kelgan", l: "O'zi kelgan" },
                { v: "ttyo", l: "TTYO orqali" },
                { v: "boshqa_dpm", l: "Boshqa DPMdan" },
              ].map((o) => (
                <button key={o.v} type="button"
                  onClick={() => setBroughtBy(o.v as typeof broughtBy)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm ${broughtBy === o.v ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Og&apos;riq joylashuvi</Label>
              <Input value={complaintPainLoc} onChange={(e) => setComplaintPainLoc(e.target.value)} placeholder="qorin, bel, ko'krak..." />
            </div>
            <div className="space-y-1.5">
              <Label>Xususiyati</Label>
              <Input value={complaintPainChar} onChange={(e) => setComplaintPainChar(e.target.value)} placeholder="sanchuvchi, achishuvchi..." />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Og&apos;riq shikoyati (matn)</Label>
            <Textarea rows={2} value={complaintPain} onChange={(e) => setComplaintPain(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Boshqa shikoyatlar</Label>
            <Textarea rows={2} value={complaintOther} onChange={(e) => setComplaintOther(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Anamnez morbi (kasallik tarixi)</Label>
              <Textarea rows={3} value={anamnesisMorbi} onChange={(e) => setAnamnesisMorbi(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Anamnez vitae (hayot)</Label>
              <Textarea rows={3} value={anamnesisVitae} onChange={(e) => setAnamnesisVitae(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Status praesens (ob&apos;ektiv holat)</Label>
            <Textarea rows={3} value={statusPraesens} onChange={(e) => setStatusPraesens(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Status localis (mahalliy)</Label>
            <Textarea rows={2} value={statusLocalis} onChange={(e) => setStatusLocalis(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Taxminiy tashxis</Label>
            <Input value={prelimDx} onChange={(e) => setPrelimDx(e.target.value)} placeholder="Klinik taxmin" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Saqlash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Rozilik yig'ish (bemor imzosi) ──
const CONSENT_KINDS = [
  { v: "surgery_general", l: "Operatsiyaga rozilik (umumiy)" },
  { v: "surgery_gyn", l: "Ginekologiya operatsiyasi" },
  { v: "anesthesia", l: "Anesteziya (og'riqsizlantirish)" },
  { v: "blood_transfusion", l: "Qon quyish (gemotransfuziya)" },
  { v: "custom", l: "Boshqa" },
];
const CONSENT_STANDARD_OPTIONS = [
  "Operatsiya davomida kutilmagan holatlar bo'lishi mumkinligini tushunaman",
  "Qon yo'qotish, infeksiya va boshqa a'zolar faoliyati buzilishi xavfini tushunaman",
  "Operatsiya natijalariga kafolat berilmasligini tushunaman",
  "Zarur bo'lsa qayta operatsiyaga roziman",
  "Allergiya, spirtli ichimliklar va giyohvand moddalar haqida ma'lumot beraman",
  "Xususiy dorixonadan dori olishga roziman",
  "Zarur bo'lsa qon quyilishiga roziman",
];

function ConsentDialog({ open, patientId, onClose }: { open: boolean; patientId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState("surgery_general");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!patientId) throw new Error("Bemor ID");
      const res = await api.post("/api/legal/consents", {
        patient_id: patientId, kind,
        title: title || CONSENT_KINDS.find((k) => k.v === kind)?.l,
        selected_options: selected,
        notes: notes || undefined,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Rozilik saqlandi");
      qc.invalidateQueries();
      setSelected([]); setNotes(""); setTitle("");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (o: string) => setSelected((cur) => cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton>
        <DialogHeader>
          <DialogTitle>Bemor roziligi</DialogTitle>
          <DialogDescription>003-forma bayonnoma — bemor imzosi</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Rozilik turi</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {CONSENT_KINDS.map((k) => (
                <button key={k.v} type="button" onClick={() => setKind(k.v)}
                  className={`rounded-md border px-3 py-2 text-xs font-medium text-left ${kind === k.v ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}>
                  {k.l}
                </button>
              ))}
            </div>
          </div>
          {kind === "custom" && (
            <div className="space-y-1.5">
              <Label>Rozilik nomi *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Masalan: Endoskopiya" />
            </div>
          )}
          <div className="space-y-2 rounded-lg border border-border/50 p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rozilik bandlari</p>
            {CONSENT_STANDARD_OPTIONS.map((o, i) => (
              <label key={i} className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} className="mt-0.5" />
                <span>{o}</span>
              </label>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label>Izoh / qo&apos;shimcha shart</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <FileSignature className="size-4" /> Imzo va saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pullik xizmat shartnomasi ──
interface ContractItem { name: string; qty: number; price: number }

function ContractDialog({ open, patientId, onClose }: { open: boolean; patientId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<ContractItem[]>([{ name: "", qty: 1, price: 0 }]);
  const [passport, setPassport] = useState("");
  const [address, setAddress] = useState("");

  const total = items.reduce((s, it) => s + it.qty * it.price, 0);

  const save = useMutation({
    mutationFn: async () => {
      if (!patientId) throw new Error("Bemor ID");
      const valid = items.filter((it) => it.name.trim() && it.price > 0);
      if (valid.length === 0) throw new Error("Kamida bitta xizmat kiriting");
      const res = await api.post<{ contract_number: string }>("/api/legal/contracts", {
        patient_id: patientId,
        patient_passport: passport || undefined,
        patient_address: address || undefined,
        items: valid.map((it) => ({ ...it, sum: it.qty * it.price })),
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: (r) => {
      toast.success(`Shartnoma № ${r.contract_number}`);
      qc.invalidateQueries();
      setItems([{ name: "", qty: 1, price: 0 }]);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const upd = (i: number, patch: Partial<ContractItem>) =>
    setItems((cur) => cur.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton>
        <DialogHeader>
          <DialogTitle>Pullik xizmat shartnomasi</DialogTitle>
          <DialogDescription>003-forma shartnoma — xizmatlar ro&apos;yxati va narxi</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Passport (AB1234567)</Label>
              <Input value={passport} onChange={(e) => setPassport(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Manzil</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Xizmatlar</Label>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_70px_100px_28px] gap-2">
                  <Input placeholder="Xizmat nomi" value={it.name} onChange={(e) => upd(i, { name: e.target.value })} />
                  <Input type="number" min={1} value={it.qty} onChange={(e) => upd(i, { qty: Number(e.target.value) || 1 })} />
                  <Input type="number" min={0} placeholder="narx" value={it.price} onChange={(e) => upd(i, { price: Number(e.target.value) || 0 })} />
                  <button type="button" onClick={() => setItems((c) => c.filter((_, idx) => idx !== i))}
                    className="text-destructive hover:bg-destructive/10 rounded-md text-lg">×</button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setItems((c) => [...c, { name: "", qty: 1, price: 0 }])}>
              <Plus className="size-4" /> Yana xizmat
            </Button>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-right">
            <span className="text-sm text-muted-foreground">Jami: </span>
            <span className="text-lg font-bold">{total.toLocaleString("uz-UZ")} so&apos;m</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Shartnoma tuzish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Laborator tekshiruv buyurish ──
function LabOrderDialog({ open, patientId, onClose }: { open: boolean; patientId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [testType, setTestType] = useState<string>("blood_general");
  const [testName, setTestName] = useState("");
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!patientId) throw new Error("Bemor ID topilmadi");
      const res = await api.post("/api/labs/orders", {
        patient_id: patientId,
        test_type: testType,
        test_name: testName || undefined,
        reason: reason || undefined,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Tekshiruv buyurildi");
      qc.invalidateQueries({ queryKey: ["patient-history", patientId] });
      setTestName(""); setReason("");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Laborator tekshiruv buyurish</DialogTitle>
          <DialogDescription>003-forma 4-bet — tekshiruv rejasi</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tekshiruv turi</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(LAB_TYPE_LABELS).map(([k, v]) => (
                <button key={k} type="button" onClick={() => setTestType(k)}
                  className={`rounded-md border px-3 py-2 text-xs font-medium text-left ${testType === k ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          {testType === "custom" && (
            <div className="space-y-1.5">
              <Label>Tekshiruv nomi *</Label>
              <Input value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="Masalan: HbA1c" />
            </div>
          )}
          {testType === "specialist" && (
            <div className="space-y-1.5">
              <Label>Qaysi mutaxasis</Label>
              <Input value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="Kardiolog / nevrolog..." />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Sabab (klinik yo&apos;nalish)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nima uchun buyurayapsiz" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Plus className="size-4" /> Buyurish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Laborator natijasi kiritish (laborant) ──
function LabResultDialog({ order, onClose }: { order: LabRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [conclusion, setConclusion] = useState("");
  const [valuesText, setValuesText] = useState(""); // "Hb: 12.5\nWBC: 7.2"

  const save = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("Buyurtma topilmadi");
      const values: Record<string, string | number> = {};
      valuesText.split(/\n+/).forEach((line) => {
        const [k, ...rest] = line.split(":");
        if (!k || rest.length === 0) return;
        const v = rest.join(":").trim();
        const num = Number(v);
        values[k.trim()] = Number.isFinite(num) && v !== "" ? num : v;
      });
      const res = await api.post(`/api/labs/orders/${order.id}/result`, {
        values_json: Object.keys(values).length ? values : undefined,
        conclusion: conclusion || undefined,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Natija saqlandi");
      qc.invalidateQueries();
      setConclusion(""); setValuesText("");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!order} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Natija: {order ? (LAB_TYPE_LABELS[order.test_type] || order.test_type) : ""}</DialogTitle>
          <DialogDescription>{order?.test_name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Qiymatlar (har qatorda `nom: qiymat`)</Label>
            <Textarea rows={6} value={valuesText} onChange={(e) => setValuesText(e.target.value)}
              placeholder="Hb: 12.5&#10;WBC: 7.2&#10;HCT: 40&#10;PLT: 250" className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label>Xulosa / izoh</Label>
            <Textarea rows={3} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Saqlash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Epi-anamnez dialogi (SanPIN 03-42-17) ──
function EpiDialog({ open, patientId, onClose }: { open: boolean; patientId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [infContact, setInfContact] = useState(false);
  const [infDetails, setInfDetails] = useState("");
  const [travel, setTravel] = useState(false);
  const [travelDetails, setTravelDetails] = useState("");
  const [pastInf, setPastInf] = useState("");
  const [hadHosp, setHadHosp] = useState(false);
  const [hadTransf, setHadTransf] = useState(false);
  const [hadSurgery, setHadSurgery] = useState(false);
  const [hospDetails, setHospDetails] = useState("");
  const [parenteral, setParenteral] = useState(false);
  const [parenteralDetails, setParenteralDetails] = useState("");
  const [cosmetic, setCosmetic] = useState(false);
  const [cosmeticDetails, setCosmeticDetails] = useState("");
  const [epiDx, setEpiDx] = useState("");
  const [plan, setPlan] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!patientId) throw new Error("Bemor ID topilmadi");
      const res = await api.post(`/api/patients/${patientId}/epi`, {
        infection_contact: infContact, infection_contact_details: infDetails || undefined,
        travel_last_month: travel, travel_details: travelDetails || undefined,
        past_infections: pastInf || undefined,
        had_hospitalization: hadHosp, had_transfusion: hadTransf, had_surgery_6mo: hadSurgery,
        hospitalization_details: hospDetails || undefined,
        parenteral_procedures: parenteral, parenteral_details: parenteralDetails || undefined,
        cosmetic_services: cosmetic, cosmetic_details: cosmeticDetails || undefined,
        epi_diagnosis: epiDx || undefined, management_plan: plan || undefined,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Epi-anamnez saqlandi");
      qc.invalidateQueries({ queryKey: ["patient-history", patientId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const Check = ({ v, on, l }: { v: boolean; on: (b: boolean) => void; l: string }) => (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />
      <span>{l}</span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton>
        <DialogHeader>
          <DialogTitle>Epi-anamnez (SanPIN 03-42-17)</DialogTitle>
          <DialogDescription>Infekcion nazorat uchun majburiy</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <Check v={infContact} on={setInfContact} l="1) Infekcion bemorlar bilan kontaktda bo'lgan (br tif, gepatit, tuberkulyoz, kox va h.k.)" />
            {infContact && <Textarea rows={2} value={infDetails} onChange={(e) => setInfDetails(e.target.value)} placeholder="Qaysi kasallik, qayerda, qachondan-qachongacha" />}
          </div>
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <Check v={travel} on={setTravel} l="2) So'nggi 2 hafta / 1 oyda boshqa joyga borgan" />
            {travel && <Textarea rows={2} value={travelDetails} onChange={(e) => setTravelDetails(e.target.value)} placeholder="Qayerga, qachon qaytgan" />}
          </div>
          <div className="space-y-1.5">
            <Label>3) O&apos;tkirgan infekcion kasalliklar</Label>
            <Textarea rows={2} value={pastInf} onChange={(e) => setPastInf(e.target.value)} placeholder="Bolalikda va so'nggi yillarda" />
          </div>
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <p className="text-xs font-medium text-muted-foreground">4) Tibbiy tarix (6 oy)</p>
            <Check v={hadHosp} on={setHadHosp} l="Statsionar/ambulator davolangan" />
            <Check v={hadTransf} on={setHadTransf} l="Qon quyish (gemotransfuziya) qilingan" />
            <Check v={hadSurgery} on={setHadSurgery} l="Jarrohlik amaliyoti bo'lgan" />
            {(hadHosp || hadTransf || hadSurgery) && (
              <Textarea rows={2} value={hospDetails} onChange={(e) => setHospDetails(e.target.value)} placeholder="Qayerda, qachon, nima uchun" />
            )}
          </div>
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <Check v={parenteral} on={setParenteral} l="5) Parenteral muolaja olgan (igna sanchilishi bilan)" />
            {parenteral && <Textarea rows={2} value={parenteralDetails} onChange={(e) => setParenteralDetails(e.target.value)} />}
          </div>
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <Check v={cosmetic} on={setCosmetic} l="6) Maishiy xizmatdan foydalangan (manikyur, pedikyur, pirsing, tatuaj)" />
            {cosmetic && <Textarea rows={2} value={cosmeticDetails} onChange={(e) => setCosmeticDetails(e.target.value)} placeholder="Qayerda, qachon" />}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tashxis (epi asosda)</Label>
              <Input value={epiDx} onChange={(e) => setEpiDx(e.target.value)} placeholder="HBV riski, ..." />
            </div>
            <div className="space-y-1.5">
              <Label>Olib borish tartibi</Label>
              <Input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="Izolyatsiya, test..." />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Saqlash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
