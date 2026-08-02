"use client";

import { motion } from "framer-motion";
import { HeartPulse, Activity, Droplet, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VitalSign } from "@/lib/mock-patient-data";

const ICONS = {
  heart_rate: HeartPulse,
  blood_pressure: Activity,
  glucose: Droplet,
  temperature: Thermometer,
} as const;

const STATUS_TINT = {
  normal:   "text-emerald-700 bg-emerald-50 ring-emerald-200",
  warning:  "text-amber-700 bg-amber-50 ring-amber-200",
  critical: "text-rose-700 bg-rose-50 ring-rose-200",
} as const;

interface Props {
  vitals: VitalSign[];
}

export function VitalsCards({ vitals }: Props) {
  return (
    <section aria-label="Hayotiy ko'rsatkichlar" className="grid gap-3 grid-cols-2 lg:grid-cols-4">
      {vitals.map((v, i) => {
        const isPrimary = v.key === "heart_rate";
        const Icon = ICONS[v.key] || HeartPulse;
        return (
          <motion.article
            key={v.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.25 }}
            className={cn(
              "relative overflow-hidden rounded-2xl border shadow-sm p-4 min-h-[120px]",
              isPrimary
                ? "border-transparent bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-blue-500/20"
                : "border-slate-200/80 bg-white",
            )}
          >
            {/* Yumshoq fon efekti (glass tuyg'usi) */}
            {isPrimary && (
              <div className="absolute inset-0 opacity-30 pointer-events-none">
                <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
                <div className="absolute -bottom-6 -left-6 h-24 w-24 rounded-full bg-cyan-300/30 blur-xl" />
              </div>
            )}

            <div className="relative flex items-start justify-between">
              <div className="min-w-0">
                <p className={cn(
                  "text-xs font-medium uppercase tracking-wider",
                  isPrimary ? "text-white/80" : "text-slate-500",
                )}>
                  {v.label}
                </p>
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className={cn("text-2xl font-bold tracking-tight", isPrimary ? "text-white" : "text-slate-900")}>
                    {v.value}
                  </span>
                  <span className={cn("text-xs font-medium", isPrimary ? "text-white/80" : "text-slate-500")}>
                    {v.unit}
                  </span>
                </div>
                {v.hint && (
                  <p className={cn("mt-1 text-[10px]", isPrimary ? "text-white/70" : "text-slate-500")}>
                    {v.hint}
                  </p>
                )}
              </div>

              <div className={cn(
                "flex size-9 items-center justify-center rounded-xl",
                isPrimary ? "bg-white/15" : "bg-blue-50",
              )}>
                <Icon className={cn(
                  "size-4",
                  isPrimary ? "text-white animate-pulse" : "text-blue-600",
                )} />
              </div>
            </div>

            {/* Sparkline (agar trend bo'lsa) */}
            {v.trend && v.trend.length > 1 && (
              <div className="relative mt-3">
                <Sparkline values={v.trend} accent={isPrimary} />
              </div>
            )}

            {/* Holat belgisi */}
            {!isPrimary && (
              <span className={cn(
                "absolute top-3 right-3 text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1",
                STATUS_TINT[v.status],
              )}>
                {v.status === "normal" ? "norma" : v.status === "warning" ? "e'tibor" : "kritik"}
              </span>
            )}
          </motion.article>
        );
      })}
    </section>
  );
}

// Kichik SVG sparkline — grafik kutubxonasiz
function Sparkline({ values, accent = false }: { values: number[]; accent?: boolean }) {
  const w = 100, h = 24;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={accent ? "rgba(255,255,255,0.9)" : "#2563EB"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
