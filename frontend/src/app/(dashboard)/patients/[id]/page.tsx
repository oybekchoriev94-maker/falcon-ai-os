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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

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

interface HistoryPayload {
  success: boolean;
  patient: Patient;
  appointments: AppointmentRow[];
  consultations: ConsultationRow[];
  reports: ReportRow[];
  admissions: AdmissionRow[];
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

export default function PatientHistoryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

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
      </div>

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
          <div key={ad.id} className="py-2 border-b border-border/40 last:border-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {fmtDate(ad.admission_date)}
                  {ad.discharge_date && ` — ${fmtDate(ad.discharge_date)}`}
                </p>
                <p className="text-xs text-muted-foreground">{ad.attending_doctor_name || "—"}</p>
              </div>
              <Badge variant="secondary" className="text-[10px]">{ad.status}</Badge>
            </div>
            {(ad.diagnosis_initial || ad.diagnosis_final) && (
              <p className="text-xs text-muted-foreground mt-1">
                {ad.diagnosis_final || ad.diagnosis_initial}
              </p>
            )}
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
