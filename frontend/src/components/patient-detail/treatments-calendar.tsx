"use client";

import { motion } from "framer-motion";
import { CalendarDays, Clock, Pill, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { Treatment, UpcomingAppointment } from "@/lib/mock-patient-data";
import { fmtDateUz } from "@/lib/mock-patient-data";
import { cn } from "@/lib/utils";

// ── UPCOMING CALENDAR ──────────────────────────────────────
export function UpcomingCalendar({ items }: { items: UpcomingAppointment[] }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const today = useMemo(() => new Date(), []);
  const monthDate = useMemo(() => {
    const d = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    return d;
  }, [today, monthOffset]);

  const monthName = monthDate.toLocaleDateString("uz-UZ", { month: "long", year: "numeric" });
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  // 1-Dushanba, 7-Yakshanba
  const firstDow = ((new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay() + 6) % 7);

  const highlighted = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      const d = new Date(it.date);
      if (d.getFullYear() === monthDate.getFullYear() && d.getMonth() === monthDate.getMonth()) {
        set.add(String(d.getDate()));
      }
    }
    return set;
  }, [items, monthDate]);

  const dayCells: Array<number | null> = [];
  for (let i = 0; i < firstDow; i++) dayCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) dayCells.push(d);

  const isToday = (d: number) =>
    today.getFullYear() === monthDate.getFullYear() &&
    today.getMonth() === monthDate.getMonth() &&
    today.getDate() === d;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <CalendarDays className="size-4 text-blue-600" />
          Keyingi qabul va Taqvim
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonthOffset((m) => m - 1)}
            aria-label="Oldingi oy"
            className="p-1 rounded hover:bg-slate-100 text-slate-600">
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-xs font-medium text-slate-700 min-w-[110px] text-center capitalize">
            {monthName}
          </span>
          <button
            onClick={() => setMonthOffset((m) => m + 1)}
            aria-label="Keyingi oy"
            className="p-1 rounded hover:bg-slate-100 text-slate-600">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </header>

      <div className="p-4">
        {/* Kun sarlavhalari */}
        <div className="grid grid-cols-7 gap-1 text-[10px] font-semibold text-slate-400 uppercase mb-1">
          {["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"].map((d) => (
            <div key={d} className="text-center py-1">{d}</div>
          ))}
        </div>
        {/* Kunlar */}
        <div className="grid grid-cols-7 gap-1">
          {dayCells.map((d, i) => {
            if (d === null) return <div key={i} className="h-8" />;
            const active = highlighted.has(String(d));
            const cur = isToday(d);
            return (
              <div key={i} className="flex items-center justify-center">
                <div
                  className={cn(
                    "size-8 rounded-lg text-xs font-medium flex items-center justify-center relative",
                    cur
                      ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                      : active
                        ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                        : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {d}
                  {active && !cur && (
                    <span className="absolute bottom-0.5 size-1 rounded-full bg-blue-600" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Yaqin qabullar ro'yxati */}
        {items.length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            {items.slice(0, 3).map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 text-xs">
                <div className="flex size-8 flex-col items-center justify-center rounded-lg bg-blue-50 text-blue-700 shrink-0">
                  <span className="text-[9px] uppercase leading-tight">
                    {new Date(a.date).toLocaleDateString("uz-UZ", { month: "short" })}
                  </span>
                  <span className="text-sm font-bold leading-tight -mt-0.5">
                    {new Date(a.date).getDate()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 truncate">{a.doctorName}</p>
                  <p className="text-slate-500 truncate flex items-center gap-1">
                    <Clock className="size-3" />
                    {new Date(a.date).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}
                    {a.serviceName && <span> · {a.serviceName}</span>}
                  </p>
                </div>
                {(a.isToday || a.isTomorrow) && (
                  <span className={cn(
                    "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                    a.isToday ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700",
                  )}>
                    {a.isToday ? "Bugun" : "Ertaga"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── TREATMENTS LIST ───────────────────────────────────────
export function TreatmentsList({ items }: { items: Treatment[] }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Pill className="size-4 text-blue-600" />
          Tayinlangan muolajalar
        </h3>
        <span className="text-xs text-slate-500">
          {items.filter((t) => t.status === "active").length} ta faol
        </span>
      </header>

      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          Faol tayinlov yo&apos;q
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-[240px] overflow-y-auto">
          {items.map((t, i) => (
            <motion.li
              key={t.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="px-4 py-3 flex items-start gap-3"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 shrink-0">
                <Pill className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-900">{t.medicine}</p>
                  <span className="text-xs text-slate-500">{t.dosage}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {t.route} · {t.frequency}
                  {t.endDate && <span> · gacha {fmtDateUz(t.endDate)}</span>}
                </p>
                {t.prescribedBy && (
                  <p className="text-[10px] text-slate-400 mt-0.5">Tayinlagan: {t.prescribedBy}</p>
                )}
              </div>
              <span className={cn(
                "text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0",
                t.status === "active"    && "bg-emerald-100 text-emerald-700",
                t.status === "paused"    && "bg-amber-100 text-amber-700",
                t.status === "completed" && "bg-slate-200 text-slate-600",
              )}>
                {t.status === "active" ? "faol" : t.status === "paused" ? "to'xtatilgan" : "tugallangan"}
              </span>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
