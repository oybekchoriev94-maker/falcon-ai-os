"use client";

// Kutish zali TV ekrani — "queue_tv" turidagi qurilma tokeni bilan.
//
// Ikki zona:
//  - Tepada "HOZIR QABULDA" — juda katta kod, zaldan o'qilishi kerak
//  - Pastda kutayotganlar ro'yxati
// Har 10 soniyada yangilanadi. Ism qisqartirilgan (PII).

import { useEffect, useMemo, useRef, useState } from "react";
import { kioskApi, fmtDateFull, type QueueItem } from "@/lib/kiosk-client";
import { useKioskPairing } from "@/lib/use-kiosk-pairing";
import { PairingScreen } from "@/components/kiosk/pairing-screen";
import { HEAD, KICKER, Spinner } from "@/components/kiosk/ui";
import { Clock, Stethoscope } from "lucide-react";

export default function KioskQueuePage() {
  const { status, config, pairing, error, pair } = useKioskPairing();

  if (status === "checking") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }
  if (status === "unpaired") {
    return <PairingScreen onSubmit={pair} error={error} loading={pairing} />;
  }
  return <QueueBoard clinicName={config?.clinic.name || "Klinika"} />;
}

function QueueBoard({ clinicName }: { clinicName: string }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [loaded, setLoaded] = useState(false);
  // Ovozli chaqiruv: chaqirilgan kodlar eslab qolinadi — har bemor
  // faqat BIR MARTA e'lon qilinadi (aks holda har 10 soniyada chalinardi).
  const announcedRef = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Ilk yuklanishda ekranda allaqachon turgan bemorlarni o'qimaymiz
  const firstLoadRef = useRef(true);

  useEffect(() => {
    let dead = false;
    const load = () => {
      kioskApi
        .get<{ queue: QueueItem[] }>("/api/kiosk/queue")
        .then((r) => { if (!dead) { setQueue(r.queue || []); setLoaded(true); } })
        .catch(() => { if (!dead) setLoaded(true); });
    };
    load();
    const poll = setInterval(load, 10_000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { dead = true; clearInterval(poll); clearInterval(clock); };
  }, []);

  const serving = useMemo(() => queue.filter((q) => q.status === "in_progress"), [queue]);
  const waiting = useMemo(() => queue.filter((q) => q.status !== "in_progress"), [queue]);

  // Yangi chaqiruv paydo bo'lsa — TTS audio'ni chalamiz. TTS o'chiq
  // bo'lsa (503) yoki brauzer autoplay'ni bloklasa jim o'tamiz —
  // ekran baribir ishlayveradi.
  useEffect(() => {
    if (!loaded) return;
    if (firstLoadRef.current) {
      // Ekran endi ochilganda: mavjud chaqiruvlarni belgilab qo'yamiz,
      // lekin chalmaymiz (ular allaqachon e'lon qilingan)
      for (const q of serving) announcedRef.current.add(q.code);
      firstLoadRef.current = false;
      return;
    }
    const fresh = serving.filter((q) => !announcedRef.current.has(q.code));
    if (fresh.length === 0) return;
    for (const q of fresh) announcedRef.current.add(q.code);
    kioskApi
      .getAudio("/api/kiosk/queue/announce/audio")
      .then((blob) => {
        if (!blob) return;
        if (audioRef.current) { audioRef.current.pause(); URL.revokeObjectURL(audioRef.current.src); }
        const audio = new Audio(URL.createObjectURL(blob));
        audioRef.current = audio;
        audio.play().catch(() => { /* autoplay bloklangan — jim */ });
      })
      .catch(() => { /* ovoz yo'q — ekran ishlayveradi */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, serving]);

  const [first, ...rest] = clinicName.toUpperCase().split(" ");

  return (
    <div style={{ minHeight: "100vh", height: "100vh", background: "var(--k-bg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Sarlavha */}
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "22px 40px",
          borderBottom: "2px solid var(--k-divider)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ ...HEAD, fontSize: 34 }}>{first}</span>
          {rest.length > 0 && <span style={{ ...HEAD, fontSize: 34, color: "var(--k-accent)" }}>{rest.join(" ")}</span>}
          <span style={{ ...KICKER, color: "var(--k-n-600)", marginLeft: 16 }}>Navbat</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ ...HEAD, fontSize: 42, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {now.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div style={{ ...KICKER, color: "var(--k-n-600)", marginTop: 2 }}>{fmtDateFull(now)}</div>
        </div>
      </div>

      {/* HOZIR QABULDA — eng katta zona */}
      <div
        style={{
          flex: "none",
          background: serving.length ? "var(--k-green-600)" : "var(--k-n-200)",
          color: serving.length ? "#fff" : "var(--k-n-600)",
          padding: "20px 40px",
          minHeight: 190,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div style={{ ...KICKER, opacity: 0.85, marginBottom: 12 }}>Hozir qabulda</div>
        {serving.length === 0 ? (
          <div style={{ ...HEAD, fontSize: 34 }}>—</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 40 }}>
            {serving.slice(0, 3).map((q) => (
              <div key={q.code} className="k-pop" style={{ display: "flex", alignItems: "center", gap: 22 }}>
                <div style={{ ...HEAD, fontSize: 86, lineHeight: 1, letterSpacing: "0.04em" }}>{q.code}</div>
                <div>
                  <div style={{ ...HEAD, fontSize: 28, lineHeight: 1.1 }}>{q.display_name}</div>
                  <div style={{ fontSize: 20, opacity: 0.9, marginTop: 4 }}>{q.doctor || "—"}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KUTAYOTGANLAR */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ ...KICKER, color: "var(--k-n-700)", padding: "16px 40px 10px" }}>
          Kutmoqda {waiting.length > 0 && `— ${waiting.length} ta`}
        </div>

        {!loaded ? (
          <Spinner />
        ) : waiting.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              ...HEAD,
              fontSize: 30,
              color: "var(--k-n-500)",
            }}
          >
            Navbatda bemor yo&apos;q
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 2,
              background: "var(--k-divider)",
              borderTop: "2px solid var(--k-divider)",
              alignContent: "start",
            }}
          >
            {waiting.map((q, i) => (
              <div
                key={q.code}
                className="k-up"
                style={{
                  animationDelay: `${Math.min(i, 12) * 0.03}s`,
                  background: "var(--k-bg)",
                  padding: "18px 32px",
                  display: "grid",
                  gridTemplateColumns: "130px 1fr auto",
                  alignItems: "center",
                  gap: 24,
                }}
              >
                <div
                  style={{
                    height: 68,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    ...HEAD,
                    fontSize: 32,
                    letterSpacing: "0.05em",
                    background: "var(--k-accent-100)",
                    color: "var(--k-accent-800)",
                  }}
                >
                  {q.code}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...HEAD, fontSize: 26, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {q.display_name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 18,
                      color: "var(--k-n-700)",
                      marginTop: 4,
                    }}
                  >
                    <Stethoscope size={18} strokeWidth={1.8} />
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{q.doctor || "—"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, ...HEAD, fontSize: 24, color: "var(--k-n-800)" }}>
                  <Clock size={20} strokeWidth={2} style={{ opacity: 0.5 }} />
                  {new Date(q.time).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
