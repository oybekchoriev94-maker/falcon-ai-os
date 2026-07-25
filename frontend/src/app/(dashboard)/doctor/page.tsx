"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import {
  HeartPulse,
  Users,
  DollarSign,
  Wallet,
  Mic,
  Camera,
  CalendarDays,
  Clock,
  Phone,
  FileText,
  Activity,
  TrendingUp,
  Stethoscope,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

const SPECIALIZATION_LABELS: Record<string, string> = {
  terapevt: "Terapevt",
  kardiolog: "Kardiolog",
  nevrolog: "Nevrolog",
  pediatr: "Pediatr",
  ginekolog: "Ginekolog",
  uzi: "UZI",
  laborant: "Laborant",
  stomatolog: "Stomatolog",
  oftalmolog: "Oftalmolog",
  endokrinolog: "Endokrinolog",
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("uz-UZ", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("uz-UZ", {
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function DoctorPage() {
  const { user } = useAuth();
  const router = useRouter();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["doctor-stats"],
    queryFn: async () => {
      const res = await api.get<{
        stats: { patients_count: number; total_revenue: number };
        today_patients: number;
      }>("/api/doctor/my-stats");
      if (res.success) return res;
      return { stats: { patients_count: 0, total_revenue: 0 }, today_patients: 0 };
    },
    refetchInterval: 30_000,
  });

  const { data: balance } = useQuery({
    queryKey: ["doctor-balance"],
    queryFn: async () => {
      const res = await api.get<{ balance: number }>("/api/doctors/balance");
      return res.success ? (res as { balance: number }) : { balance: 0 };
    },
  });

  const { data: patientsData, isLoading: patientsLoading } = useQuery({
    queryKey: ["doctor-patients"],
    queryFn: async () => {
      const res = await api.get<{
        consultations: Array<{
          id: number; patient_name: string; diagnosis: string; created_at: string;
          data_json?: Record<string, unknown>;
        }>;
        appointments: Array<{
          appointment_id: string; patient_name: string; phone: string; doctor_name: string;
          appointment_time: string; notes?: string; status: string;
        }>;
      }>("/api/doctor/my-patients");
      if (res.success) return res;
      return { consultations: [], appointments: [] };
    },
    refetchInterval: 30_000,
  });

  const specLabel = SPECIALIZATION_LABELS[user?.specialization || ""] || "Shifokor";
  const statValue = stats || { stats: { patients_count: 0, total_revenue: 0 }, today_patients: 0 };
  const bal = balance?.balance ?? 0;

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm">
            <Stethoscope className="size-5 text-primary-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {user?.full_name || user?.username || "Shifokor"}
              </h1>
              <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                {specLabel}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">Shifokor paneli</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-1.5 w-fit">
          <CalendarDays className="size-4" />
          {new Date().toLocaleDateString("uz-UZ", { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>

      <motion.div variants={item} className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Bugungi bemorlar", value: statValue.today_patients, icon: Users, color: "text-violet-500", bg: "bg-violet-500/10" },
          { label: "Jami bemorlar", value: statValue.stats.patients_count, icon: Activity, color: "text-blue-500", bg: "bg-blue-500/10" },
          { label: "Jami daromad", value: `${(statValue.stats.total_revenue || 0).toLocaleString()} so'm`, icon: DollarSign, color: "text-emerald-500", bg: "bg-emerald-500/10" },
          { label: "Balans", value: `${bal.toLocaleString()} so'm`, icon: Wallet, color: "text-amber-500", bg: "bg-amber-500/10" },
        ].map((s) => (
          <Card key={s.label} className="border-border/50 relative overflow-hidden group hover:border-border transition-all">
            <CardContent className="p-4 md:p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.label}</span>
                <div className={cn("size-8 rounded-lg flex items-center justify-center", s.bg)}>
                  <s.icon className={cn("size-4", s.color)} />
                </div>
              </div>
              {statsLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-xl font-bold tracking-tight">{s.value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <motion.div variants={item} className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <HeartPulse className="size-4 text-primary" />
              Tezkor amallar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Link href={`/scribe?specialization=${user?.specialization || ""}`}>
                <div className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-card/50 p-4 text-center hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer">
                  <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Mic className="size-5 text-primary" />
                  </div>
                  <span className="text-sm font-medium">AI Scribe</span>
                  <span className="text-xs text-muted-foreground">{specLabel} shabloni</span>
                </div>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="size-4 text-emerald-500" />
                Bugungi qabullar
              </CardTitle>
              <Badge variant="outline" className="text-xs">
                {(patientsData?.appointments || []).length} ta
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {patientsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : !patientsData?.appointments?.length ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <CalendarDays className="size-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">Bugun qabullar yo'q</p>
              </div>
            ) : (
              <div className="space-y-2">
                {patientsData.appointments.map((apt) => (
                  <div key={apt.appointment_id} className="flex items-center gap-3 rounded-lg border border-border/40 bg-card/50 px-3 py-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                      <Users className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{apt.patient_name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                        {apt.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="size-3" />
                            {apt.phone}
                          </span>
                        )}
                        {apt.appointment_time && (
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {formatTime(apt.appointment_time)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant={apt.status === "completed" ? "secondary" : "outline"} className="shrink-0 text-xs">
                      {apt.status === "completed" ? "Yakunlangan" : "Kutilmoqda"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={item}>
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="size-4 text-primary" />
                Oxirgi bemorlar
              </CardTitle>
              <Link href="/patients" className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "")}>
                Barchasi <ArrowRight className="size-3 ml-1" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {patientsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : !patientsData?.consultations?.length ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Users className="size-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">Hozircha bemorlar yo'q</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  AI Scribe orqali birinchi bemorni qabul qiling
                </p>
                <Link href={`/scribe?specialization=${user?.specialization || ""}`} className={cn(buttonVariants({ size: "sm" }), "mt-4")}>
                  <Mic className="size-4 mr-1" />
                  AI Scribe ochish
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {patientsData.consultations.slice(0, 10).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border/40 bg-card/50 px-3 py-2.5 hover:border-border/80 transition-colors">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                      {c.patient_name?.charAt(0) || "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.patient_name || "Noma'lum"}</p>
                      {c.diagnosis && (
                        <p className="text-xs text-muted-foreground/70 truncate">{c.diagnosis}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground/50 shrink-0">
                      {formatDate(c.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
