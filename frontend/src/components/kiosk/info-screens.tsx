"use client";

// Ma'lumot ekranlari: narxlar katalogi, shifokorlar, jonli navbat, chipta.

import { CheckCheck, Clock, Printer, RotateCcw, Stethoscope } from "lucide-react";
import { HEAD, KICKER, ScreenTitle, SummaryList, SummaryRow, Spinner, EmptyState } from "./ui";
import { deptLabel } from "./booking-flow";
import { fmtSum, type KioskService, type KioskDepartment, type QueueItem } from "@/lib/kiosk-client";
import type { KioskT } from "@/lib/kiosk-i18n";

/* ── Narxlar ── */
export function PricesScreen({
  t,
  services,
  loading,
  activeCat,
  onCat,
}: {
  t: KioskT;
  services: KioskService[];
  loading: boolean;
  activeCat: string | null;
  onCat: (c: string) => void;
}) {
  if (loading) return <Spinner label={t.loading} />;

  const cats = [...new Set(services.map((s) => s.category || "Boshqa"))];
  const cat = activeCat && cats.includes(activeCat) ? activeCat : cats[0];
  const list = services.filter((s) => (s.category || "Boshqa") === cat);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "320px 1fr", gap: 2, background: "var(--k-divider)" }}>
      <div style={{ background: "var(--k-bg)", overflowY: "auto", padding: "20px 0" }}>
        <div style={{ ...KICKER, color: "var(--k-n-700)", padding: "0 24px 14px" }}>{t.category}</div>
        {cats.map((c) => {
          const on = c === cat;
          const n = services.filter((s) => (s.category || "Boshqa") === c).length;
          return (
            <button
              key={c}
              onClick={() => onCat(c)}
              className="k-press"
              style={{
                width: "100%",
                padding: "16px 24px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                ...HEAD,
                fontSize: 18,
                borderLeft: `6px solid ${on ? "var(--k-accent)" : "transparent"}`,
                background: on ? "var(--k-accent-100)" : "transparent",
                color: on ? "var(--k-accent-800)" : "var(--k-text)",
              }}
            >
              <span>{c}</span>
              <span style={{ fontSize: 15, color: "var(--k-n-600)" }}>{n}</span>
            </button>
          );
        })}
      </div>

      <div style={{ background: "var(--k-bg)", overflowY: "auto" }}>
        <div style={{ padding: "24px 32px 12px" }}>
          <div style={{ ...KICKER, color: "var(--k-accent)" }}>{t.tPrices}</div>
          <h2 style={{ ...HEAD, fontSize: 34, margin: "8px 0 0" }}>{cat}</h2>
        </div>
        <div style={{ display: "grid", gap: 2, background: "var(--k-divider)", borderTop: "2px solid var(--k-divider)" }}>
          {list.map((s) => (
            <div
              key={s.id}
              style={{
                background: "var(--k-bg)",
                padding: "18px 32px",
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                gap: 22,
              }}
            >
              <div>
                <div style={{ ...HEAD, fontSize: 20, lineHeight: 1.2 }}>{s.name}</div>
                {s.duration_min ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, color: "var(--k-n-700)", marginTop: 4 }}>
                    <Clock size={14} strokeWidth={1.8} /> {s.duration_min} daqiqa
                  </div>
                ) : null}
              </div>
              <div style={{ ...HEAD, fontSize: 22, whiteSpace: "nowrap", color: "var(--k-accent-800)" }}>{fmtSum(s.price)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Shifokorlar ── */
export function DoctorsScreen({
  t,
  departments,
  loading,
}: {
  t: KioskT;
  departments: KioskDepartment[];
  loading: boolean;
}) {
  if (loading) return <Spinner label={t.loading} />;
  if (!departments.length) return <EmptyState msg={t.noDoctors} />;

  // Bir odam bir nechta yo'nalishda ro'yxatdan o'tgan bo'lishi mumkin
  // (bazada alohida yozuvlar). Ro'yxatda bir marta ko'rsatamiz,
  // yo'nalishlarni birlashtirib: "Urolog · UZI mutaxassisi".
  const people = new Map<string, { name: string; depts: string[]; booked: number }>();
  for (const dept of departments) {
    for (const d of dept.doctors) {
      const key = d.name.trim().toLowerCase();
      const p = people.get(key) || { name: d.name, depts: [], booked: 0 };
      if (!p.depts.includes(dept.name)) p.depts.push(dept.name);
      p.booked += d.today_booked || 0;
      people.set(key, p);
    }
  }
  const list = [...people.values()];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <ScreenTitle kicker={t.tDoctors} title={t.tDoctorsDesc} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 2,
          background: "var(--k-divider)",
          borderTop: "2px solid var(--k-divider)",
          alignContent: "start",
        }}
      >
        {list.map((p, i) => (
          <div
            key={p.name}
            className="k-up"
            style={{
              animationDelay: `${i * 0.04}s`,
              background: "var(--k-bg)",
              padding: "22px 28px",
              display: "grid",
              gridTemplateColumns: "72px 1fr",
              gap: 18,
              alignItems: "center",
              minHeight: 116,
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                background: "var(--k-accent-100)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                ...HEAD,
                fontSize: 26,
                color: "var(--k-accent-700)",
              }}
            >
              {p.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
            </div>
            <div>
              <div style={{ ...HEAD, fontSize: 21 }}>{p.name}</div>
              <div style={{ fontSize: 17, color: "var(--k-accent-800)", marginTop: 3 }}>
                {p.depts.map(deptLabel).join(" · ")}
              </div>
              {p.booked > 0 && (
                <div style={{ ...KICKER, fontSize: 12, color: "var(--k-n-600)", marginTop: 6 }}>
                  {t.todayBooked(p.booked)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Jonli navbat ── */
export function QueueScreen({ t, queue, loading }: { t: KioskT; queue: QueueItem[]; loading: boolean }) {
  if (loading) return <Spinner label={t.loading} />;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ScreenTitle kicker={t.tQueue} title={t.walkinTitle} sub={t.walkinDesc} />
      {!queue.length ? (
        <EmptyState msg={t.queueEmpty} />
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
          {queue.map((q, i) => {
            const active = q.status === "in_progress";
            return (
              <div
                key={q.code}
                className="k-up"
                style={{
                  animationDelay: `${Math.min(i, 10) * 0.03}s`,
                  background: "var(--k-bg)",
                  padding: "20px 24px",
                  display: "grid",
                  gridTemplateColumns: "104px 1fr auto",
                  alignItems: "center",
                  gap: 20,
                }}
              >
                <div
                  style={{
                    height: 62,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    ...HEAD,
                    fontSize: 24,
                    letterSpacing: "0.06em",
                    background: active ? "var(--k-green-600)" : "var(--k-accent-100)",
                    color: active ? "#fff" : "var(--k-accent-800)",
                  }}
                >
                  {q.code}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...HEAD, fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {q.display_name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, color: "var(--k-n-700)", marginTop: 3 }}>
                    <Stethoscope size={15} strokeWidth={1.8} />
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{q.doctor || "—"}</span>
                    <span>·</span>
                    <span>{new Date(q.time).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
                <div
                  style={{
                    ...KICKER,
                    fontSize: 13,
                    padding: "6px 12px",
                    background: active ? "var(--k-green-100)" : "var(--k-n-200)",
                    color: active ? "var(--k-green-800)" : "var(--k-n-700)",
                  }}
                >
                  {active ? t.inRoom : t.waiting}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Chipta ── */
export function TicketScreen({
  t,
  rows,
  code,
  qrUrl,
  onNew,
}: {
  t: KioskT;
  rows: { k: string; v: string }[];
  code: string;
  qrUrl?: string | null;
  onNew: () => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 420px", gap: 2, background: "var(--k-divider)" }}>
      <div style={{ background: "var(--k-bg)", padding: "28px 32px", overflowY: "auto" }}>
        <div className="k-side" style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--k-green-700)" }}>
          <CheckCheck size={30} strokeWidth={2.5} className="k-pop" />
          <span style={{ ...HEAD, fontSize: 15, letterSpacing: "0.18em", textTransform: "uppercase" }}>{t.ticketDone}</span>
        </div>
        <h2 style={{ ...HEAD, fontSize: 36, margin: "12px 0 20px" }}>{t.ticketTitle}</h2>
        <SummaryList>
          {rows.map((r) => (
            <SummaryRow key={r.k} k={r.k} v={r.v} />
          ))}
        </SummaryList>
        <div style={{ marginTop: 18, fontSize: 17, color: "var(--k-n-700)", textWrap: "pretty" }}>{t.ticketNote}</div>

        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <button
            onClick={() => window.print()}
            className="k-press"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 56,
              padding: "0 26px",
              border: "2px solid var(--k-divider)",
              ...HEAD,
              fontSize: 18,
            }}
          >
            <Printer size={20} strokeWidth={2} />
            {t.print}
          </button>
          <button
            onClick={onNew}
            className="k-press"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 56,
              padding: "0 26px",
              background: "var(--k-accent)",
              color: "var(--k-bg)",
              ...HEAD,
              fontSize: 18,
            }}
          >
            <RotateCcw size={20} strokeWidth={2} />
            {t.newBooking}
          </button>
        </div>
      </div>

      <div
        style={{
          background: "var(--k-n-900)",
          color: "var(--k-bg)",
          padding: 28,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 14, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.7 }}>{t.ticketNo}</div>
          <div
            className="k-pop"
            style={{ ...HEAD, fontSize: 76, lineHeight: 1, letterSpacing: "0.02em", color: "var(--k-green-400)", marginTop: 8 }}
          >
            {code}
          </div>
        </div>

        {/* To'lov QR — klinika sozlamalarida rasm yuklansa shu yerda chiqadi.
            Yuklanmagan bo'lsa joyni band qilmaymiz. */}
        {qrUrl ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 210, height: 210, background: "#fff", padding: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <div style={{ ...KICKER, fontSize: 12, marginTop: 10, opacity: 0.7 }}>{t.qrPay}</div>
          </div>
        ) : null}

        <div style={{ textAlign: "center", fontSize: 16, opacity: 0.75, textWrap: "pretty" }}>{t.qrNote}</div>
      </div>
    </div>
  );
}
