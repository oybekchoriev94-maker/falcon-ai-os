"use client";

import { FileText, FileSpreadsheet, FileImage, Download, Sparkles, Beaker, ScanLine, Stethoscope } from "lucide-react";
import { motion } from "framer-motion";
import type { HealthReport, ReportKind } from "@/lib/mock-patient-data";
import { fmtDateShortUz } from "@/lib/mock-patient-data";
import { cn } from "@/lib/utils";

const KIND_META: Record<ReportKind, { label: string; Icon: React.ComponentType<{ className?: string }>; tint: string }> = {
  ai_scribe: { label: "AI Scribe",      Icon: Sparkles,    tint: "text-violet-600 bg-violet-50" },
  lab:       { label: "Laboratoriya",   Icon: Beaker,      tint: "text-emerald-600 bg-emerald-50" },
  imaging:   { label: "Rentgen/UZI",    Icon: ScanLine,    tint: "text-cyan-600 bg-cyan-50" },
  epicrisis: { label: "Epikriz",        Icon: Stethoscope, tint: "text-blue-600 bg-blue-50" },
  other:     { label: "Boshqa",         Icon: FileText,    tint: "text-slate-600 bg-slate-100" },
};

function ExtIcon({ ext }: { ext: HealthReport["ext"] }) {
  if (ext === "docx") return <FileSpreadsheet className="size-4" />;
  if (ext === "jpg" || ext === "png") return <FileImage className="size-4" />;
  return <FileText className="size-4" />;
}

interface Props {
  reports: HealthReport[];
}

export function HealthReports({ reports }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">Tibbiy hisobotlar va AI Scribe</h3>
        <span className="text-xs text-slate-500">{reports.length} ta fayl</span>
      </header>

      {reports.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          Hozircha hisobot yo&apos;q — birinchi ko&apos;rikdan so&apos;ng shu yerda ko&apos;rinadi
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-[280px] overflow-y-auto">
          {reports.slice(0, 8).map((r, i) => {
            const meta = KIND_META[r.kind];
            return (
              <motion.li
                key={r.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group"
              >
                <div className={cn("flex size-9 items-center justify-center rounded-lg shrink-0", meta.tint)}>
                  <meta.Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900 truncate">{r.title}</p>
                    <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">{r.ext}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                    <ExtIcon ext={r.ext} />
                    <span className="truncate">{r.fileName}</span>
                    <span aria-hidden>·</span>
                    <span>{r.sizeKB} KB</span>
                    <span aria-hidden>·</span>
                    <span>{fmtDateShortUz(r.createdAt)}</span>
                  </div>
                </div>
                <a
                  href={r.url || "#"}
                  target={r.url ? "_blank" : undefined}
                  rel="noopener"
                  aria-label={`${r.title} yuklab olish`}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium",
                    r.url
                      ? "text-blue-600 hover:bg-blue-50 hover:border-blue-300"
                      : "text-slate-400 cursor-not-allowed",
                  )}
                  onClick={(e) => { if (!r.url) e.preventDefault(); }}
                >
                  <Download className="size-3.5" />
                  Yuklash
                </a>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
