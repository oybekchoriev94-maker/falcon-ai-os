"use client";

// Kutish zali TV ekrani — "queue_tv" turidagi qurilma tokeni bilan.
// Backend GET /api/kiosk/queue 10s'da bir so'raladi, ism qisqartirilgan.
// Uzoqdan o'qilishi kerak, shuning uchun shriftlar kioskdan kattaroq.

import { useEffect, useState } from "react";
import { kioskApi, type QueueItem } from "@/lib/kiosk-client";
import { useKioskPairing } from "@/lib/use-kiosk-pairing";
import { PairingScreen } from "@/components/kiosk/pairing-screen";
import { HEAD, KICKER, Spinner } from "@/components/kiosk/ui";
import { Stethoscope } from "lucide-react";

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

  useEffect(() => {
    let dead = false;
    const load = () => {
      kioskApi
        .get<{ queue: QueueItem[] }>("/api/kiosk/queue")
        .then((r) => { if (!dead) setQueue(r.queue || []); })
        .catch(() => {});
    };
    load();
    const poll = setInterval(load, 10_000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { dead = true; clearInterval(poll); clearInterval(clock); };
  }, []);

  const [first, ...rest] = clinicName.toUpperCase().split(" ");

  return (
    <div style={{ minHeight: "100vh", background: "var(--k-bg)", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "28px 40px",
          borderBottom: "2px solid var(--k-divider)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ ...HEAD, fontSize: 38 }}>{first}</span>
          {rest.length > 0 && <span style={{ ...HEAD, fontSize: 38, color: "var(--k-accent)" }}>{rest.join(" ")}</span>}
          <span style={{ ...KICKER, color: "var(--k-n-600)", marginLeft: 16 }}>Navbat</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ ...HEAD, fontSize: 46, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {now.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div style={{ ...KICKER, color: "var(--k-n-600)", marginTop: 4 }}>
            {now.toLocaleDateString("uz-UZ", { day: "numeric", month: "long", year: "numeric" })}
          </div>
        </div>
      </div>

      {queue.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...HEAD,
            fontSize: 32,
            color: "var(--k-n-500)",
          }}
        >
          Hozircha navbatda bemor yo&apos;q
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 2,
            background: "var(--k-divider)",
            alignContent: "start",
            borderTop: "2px solid var(--k-divider)",
          }}
        >
          {queue.map((q, i) => {
            const active = q.status === "in_progress";
            return (
              <div
                key={q.code}
                className="k-up"
                style={{
                  animationDelay: `${Math.min(i, 12) * 0.03}s`,
                  background: active ? "var(--k-green-100)" : "var(--k-bg)",
                  padding: "26px 32px",
                  display: "grid",
                  gridTemplateColumns: "160px 1fr auto",
                  alignItems: "center",
                  gap: 26,
                }}
              >
                <div
                  style={{
                    height: 88,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    ...HEAD,
                    fontSize: 40,
                    letterSpacing: "0.06em",
                    background: active ? "var(--k-green-600)" : "var(--k-accent)",
                    color: "#fff",
                  }}
                >
                  {q.code}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...HEAD, fontSize: 30, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {q.display_name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 20,
                      color: "var(--k-n-700)",
                      marginTop: 6,
                    }}
                  >
                    <Stethoscope size={20} strokeWidth={1.8} />
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{q.doctor || "—"}</span>
                    <span>·</span>
                    <span>{new Date(q.time).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
                <div
                  style={{
                    ...HEAD,
                    fontSize: 17,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    padding: "10px 18px",
                    background: active ? "var(--k-green-600)" : "var(--k-n-200)",
                    color: active ? "#fff" : "var(--k-n-700)",
                  }}
                >
                  {active ? "Qabulda" : "Kutmoqda"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
