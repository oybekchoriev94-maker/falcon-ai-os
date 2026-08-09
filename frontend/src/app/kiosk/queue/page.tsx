"use client";

// Kutish zali TV ekrani — "queue_tv" turidagi qurilma tokeni bilan ishlaydi.
// Backend GET /api/kiosk/queue 10s'da bir qayta so'raladi, PII ism qisqartirilgan.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { kioskApi, type QueueItem } from "@/lib/kiosk-client";
import { useKioskPairing } from "@/lib/use-kiosk-pairing";
import { PairingScreen } from "@/components/kiosk/pairing-screen";
import { Clock, HeartPulse, Loader2, Stethoscope } from "lucide-react";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Kutmoqda", className: "bg-amber-500/15 text-amber-300 ring-amber-400/30" },
  in_progress: { label: "Qabulda", className: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30" },
};

export default function KioskQueuePage() {
  const { status, config, pairing, error, pair } = useKioskPairing();

  if (status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
      </div>
    );
  }
  if (status === "unpaired") {
    return <PairingScreen onSubmit={pair} error={error} loading={pairing} />;
  }
  return <QueueBoard clinicName={config?.clinic.name} />;
}

function QueueBoard({ clinicName }: { clinicName?: string }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      kioskApi
        .get<{ queue: QueueItem[] }>("/api/kiosk/queue")
        .then((r) => { if (!cancelled) setQueue(r.queue || []); })
        .catch(() => {});
    };
    load();
    const poll = setInterval(load, 10_000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { cancelled = true; clearInterval(poll); clearInterval(clock); };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-indigo-950/60 to-slate-950 p-8 text-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between border-b border-white/10 pb-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-500/20">
            <HeartPulse className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{clinicName || "Klinika"}</h1>
            <p className="text-slate-400">Navbat ekrani</p>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2 text-4xl font-black tabular-nums">
            <Clock className="h-8 w-8 text-emerald-400" />
            {now.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <p className="mt-1 text-slate-400">
            {now.toLocaleDateString("uz-UZ", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-5xl">
        {queue.length === 0 ? (
          <div className="rounded-3xl bg-white/5 py-24 text-center text-2xl text-slate-500 ring-1 ring-white/10">
            Hozircha navbatda bemor yo&apos;q
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {queue.map((q) => {
                const st = STATUS_LABEL[q.status] || STATUS_LABEL.scheduled;
                return (
                  <motion.div
                    layout
                    key={q.code}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="flex items-center gap-5 rounded-3xl bg-white/5 p-6 ring-1 ring-white/10"
                  >
                    <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-2xl font-black tracking-widest text-emerald-300 ring-1 ring-emerald-400/30">
                      {q.code}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xl font-semibold">{q.display_name}</div>
                      <div className="mt-1 flex items-center gap-2 text-sm text-slate-400">
                        <Stethoscope className="h-4 w-4" />
                        <span className="truncate">{q.doctor || "—"}</span>
                        <span>·</span>
                        <span>{new Date(q.time).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${st.className}`}>
                      {st.label}
                    </span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
