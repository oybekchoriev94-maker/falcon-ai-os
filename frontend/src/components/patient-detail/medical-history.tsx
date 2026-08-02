"use client";

import { motion } from "framer-motion";
import { ShieldCheck, Scissors, CheckCircle2, Syringe, BedDouble, FlaskConical } from "lucide-react";
import type { MedicalEvent, MedicalEventKind } from "@/lib/mock-patient-data";
import { fmtDateUz } from "@/lib/mock-patient-data";
import { cn } from "@/lib/utils";

const ICONS: Record<MedicalEventKind, React.ComponentType<{ className?: string }>> = {
  diagnosis:    ShieldCheck,
  surgery:      Scissors,
  checkup:      CheckCircle2,
  vaccination:  Syringe,
  admission:    BedDouble,
  lab_result:   FlaskConical,
};

const TINTS: Record<MedicalEventKind, string> = {
  diagnosis:    "text-blue-700 bg-blue-50 ring-blue-100",
  surgery:      "text-rose-700 bg-rose-50 ring-rose-100",
  checkup:      "text-emerald-700 bg-emerald-50 ring-emerald-100",
  vaccination:  "text-amber-700 bg-amber-50 ring-amber-100",
  admission:    "text-violet-700 bg-violet-50 ring-violet-100",
  lab_result:   "text-cyan-700 bg-cyan-50 ring-cyan-100",
};

interface Props {
  events: MedicalEvent[];
}

export function MedicalHistory({ events }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">Tibbiy tarix</h3>
        <span className="text-xs text-slate-500">{events.length} ta yozuv</span>
      </header>

      {events.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          Tarix bo&apos;sh — birinchi tashrif shu yerda ko&apos;rinadi
        </div>
      ) : (
        <div className="relative px-4 py-4 max-h-[320px] overflow-y-auto">
          {/* Vertikal chiziq */}
          <span aria-hidden className="absolute left-[26px] top-6 bottom-6 w-px bg-slate-200" />

          <ol className="space-y-4">
            {events.slice(0, 12).map((e, i) => {
              const Icon = ICONS[e.kind] || ShieldCheck;
              return (
                <motion.li
                  key={e.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="relative flex gap-3"
                >
                  <div className={cn(
                    "shrink-0 z-10 flex size-6 items-center justify-center rounded-full ring-4 ring-white ring-offset-0",
                    TINTS[e.kind],
                  )}>
                    <Icon className="size-3.5" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900 leading-snug">
                        {e.title}
                      </p>
                      <time className="text-[11px] text-slate-500 shrink-0 tabular-nums">
                        {fmtDateUz(e.date)}
                      </time>
                    </div>
                    {e.description && (
                      <p className="mt-0.5 text-xs text-slate-600 line-clamp-2">{e.description}</p>
                    )}
                    {e.doctor && (
                      <p className="mt-0.5 text-[11px] text-slate-400">{e.doctor}</p>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
