"use client";

// Savat — bir kelishda tanlangan tashriflar.
// Bemor ginekologga yozilgach "yana UZI" qo'shishi mumkin.

import { Plus, Stethoscope, Trash2 } from "lucide-react";
import { HEAD, KICKER, ScreenTitle } from "./ui";
import { deptLabel } from "./booking-flow";
import { fmtSum, fmtDateTime } from "@/lib/kiosk-client";
import type { KioskT } from "@/lib/kiosk-i18n";

export interface CartVisit {
  doctor_id: string;
  doctor_name: string;
  department: string;
  service_id: string;
  service_name: string;
  price: number;
  scheduled_at: string;
}

const MAX_VISITS = 6;

export function CartScreen({
  t,
  visits,
  onAdd,
  onRemove,
}: {
  t: KioskT;
  visits: CartVisit[];
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  const total = visits.reduce((s, v) => s + (v.price || 0), 0);
  const full = visits.length >= MAX_VISITS;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 380px", gap: 2, background: "var(--k-divider)" }}>
      <div style={{ background: "var(--k-bg)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <ScreenTitle kicker={t.cart} title={t.addMoreHint} />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "grid",
            gap: 2,
            background: "var(--k-divider)",
            borderTop: "2px solid var(--k-divider)",
            alignContent: "start",
          }}
        >
          {visits.map((v, i) => (
            <div
              key={`${v.doctor_id}-${v.scheduled_at}`}
              className="k-up"
              style={{
                animationDelay: `${i * 0.04}s`,
                background: "var(--k-bg)",
                padding: "18px 32px",
                display: "grid",
                gridTemplateColumns: "44px 1fr auto auto",
                alignItems: "center",
                gap: 18,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--k-accent-100)",
                  color: "var(--k-accent-800)",
                  ...HEAD,
                  fontSize: 18,
                }}
              >
                {i + 1}
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ ...HEAD, fontSize: 20, lineHeight: 1.2 }}>{v.service_name}</div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 16,
                    color: "var(--k-n-700)",
                    marginTop: 4,
                  }}
                >
                  <Stethoscope size={15} strokeWidth={1.8} />
                  <span>{v.doctor_name} — {deptLabel(v.department)}</span>
                  <span>·</span>
                  <span>{fmtDateTime(v.scheduled_at)}</span>
                </div>
              </div>

              <div style={{ ...HEAD, fontSize: 20, whiteSpace: "nowrap" }}>{fmtSum(v.price)}</div>

              <button
                onClick={() => onRemove(i)}
                className="k-press"
                aria-label={t.removeVisit}
                style={{
                  width: 48,
                  height: 48,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "2px solid var(--k-divider)",
                  color: "var(--k-red-600)",
                }}
              >
                <Trash2 size={20} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Yon panel: jami + yana qo'shish */}
      <div
        style={{
          background: "var(--k-accent)",
          color: "var(--k-bg)",
          padding: 28,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ ...KICKER, opacity: 0.85 }}>{t.total}</div>
          <div style={{ ...HEAD, fontSize: 48, lineHeight: 1, letterSpacing: "-0.03em", marginTop: 8 }}>
            {fmtSum(total)}
          </div>
          <div style={{ fontSize: 16, opacity: 0.85, marginTop: 6 }}>
            {visits.length} {visits.length === 1 ? "tashrif" : "ta tashrif"}
          </div>
        </div>

        <div>
          <button
            onClick={onAdd}
            disabled={full}
            className="k-press"
            style={{
              width: "100%",
              height: 60,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              ...HEAD,
              fontSize: 19,
              background: full ? "rgba(255,255,255,.25)" : "var(--k-bg)",
              color: full ? "rgba(255,255,255,.7)" : "var(--k-accent-800)",
            }}
          >
            <Plus size={22} strokeWidth={2.4} />
            {t.addMore}
          </button>
          {full && (
            <div style={{ fontSize: 14, opacity: 0.85, marginTop: 10, textAlign: "center" }}>{t.maxVisits}</div>
          )}
        </div>
      </div>
    </div>
  );
}
