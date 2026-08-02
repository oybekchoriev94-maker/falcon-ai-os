"use client";

// ============================================================
// FALCON AI OS — Patient Detail & Doctor Workspace
//
// 3-column workspace layout:
//   Left+Center (col-span 8): Vitals, Reports+History, Calendar+Treatments
//   Right (col-span 4): Patient profile card + quick actions
//
// Real backend ma'lumoti (/api/patients/:id/history) + mock fallback
// (yurak urishi, taqvim ranglari). Global sidebar layout.tsx da.
// ============================================================

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { ChevronRight, ArrowLeft, Search } from "lucide-react";
import { toast } from "sonner";
import { buildWorkspaceFromHistory, type PatientWorkspace } from "@/lib/mock-patient-data";
import { VitalsCards } from "@/components/patient-detail/vitals-cards";
import { HealthReports } from "@/components/patient-detail/health-reports";
import { MedicalHistory } from "@/components/patient-detail/medical-history";
import { UpcomingCalendar, TreatmentsList } from "@/components/patient-detail/treatments-calendar";
import { PatientProfileCard } from "@/components/patient-detail/patient-profile-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function PatientDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ["patient-history", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await api.get<Record<string, unknown>>(`/api/patients/${id}/history`);
      if (!res.success) throw new Error(res.error || "Bemor kartasi topilmadi");
      return res;
    },
  });

  const workspace: PatientWorkspace | null = useMemo(() => {
    if (!data?.success) return null;
    return buildWorkspaceFromHistory(data as unknown as Parameters<typeof buildWorkspaceFromHistory>[0]);
  }, [data]);

  if (isLoading) return <WorkspaceSkeleton />;
  if (error || !workspace) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="size-4" /> Ortga
        </button>
        <Card className="border-rose-200 bg-rose-50/50">
          <CardContent className="py-10 text-center text-sm text-rose-700">
            {error instanceof Error ? error.message : "Bemor topilmadi yoki kirish yo'q"}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { patient, vitals, reports, history, upcoming, treatments, alerts } = workspace;

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      {/* Breadcrumb + qidiruv */}
      <TopBar patientName={patient.fullName} />

      {/* MAIN GRID: 12-column, right panel = 4 col */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT + CENTER (8 columns on lg) */}
        <div className="lg:col-span-8 space-y-5">
          {/* A) Vital signs */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <VitalsCards vitals={vitals} />
          </motion.div>

          {/* B) Middle grid: Reports + Calendar side-by-side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <HealthReports reports={reports} />
            <UpcomingCalendar items={upcoming} />
          </div>

          {/* C) Bottom grid: History + Treatments */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <MedicalHistory events={history} />
            <TreatmentsList items={treatments} />
          </div>
        </div>

        {/* RIGHT PANEL (4 columns on lg, sticky) */}
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-4">
            <PatientProfileCard
              patient={patient}
              alerts={alerts}
              onSchedule={() => toast.info("Qabul belgilash: reception oynasi ochilmoqda...")}
              onAssignDoctor={() => toast.info("Shifokor tanlash: keyingi versiyada")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Breadcrumb + search bar ─────────────────────────────────
function TopBar({ patientName }: { patientName: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-slate-500">
        <a href="/patients" className="hover:text-slate-900 transition-colors">Bemorlar</a>
        <ChevronRight className="size-3.5" />
        <span className="text-slate-900 font-medium truncate max-w-[200px] sm:max-w-none">
          {patientName}
        </span>
      </nav>

      <div className="flex-1" />

      <div className="relative w-full sm:w-72">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Fayllar yoki bemor ma'lumotlari..."
          className="w-full pl-9 pr-16 py-2 text-sm rounded-xl border border-slate-200 bg-white/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors"
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex text-[10px] font-mono text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
          ⌘K
        </kbd>
      </div>
    </div>
  );
}

// ── Skeleton (yuklanish holati) ─────────────────────────────
function WorkspaceSkeleton() {
  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </div>
        <div className="lg:col-span-4">
          <Skeleton className="h-[600px] rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
