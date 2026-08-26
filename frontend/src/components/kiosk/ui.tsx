"use client";

// Kiosk uchun umumiy primitivlar. Tailwind emas, inline style —
// kiosk o'z dizayn tokenlarida (--k-*) yashaydi va dashboard
// mavzusidan mustaqil bo'lishi kerak.

import type { CSSProperties, ReactNode } from "react";

export const HEAD: CSSProperties = {
  fontFamily: "var(--font-archivo), system-ui, sans-serif",
  fontWeight: 800,
  letterSpacing: "-0.02em",
};

export const KICKER: CSSProperties = {
  fontSize: 13,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
};

/** Bo'lim sarlavhasi: kichik rangli yorliq + katta sarlavha */
export function ScreenTitle({
  kicker,
  title,
  sub,
  right,
}: {
  kicker?: string;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        flex: "none",
        padding: "24px 32px 16px",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 24,
      }}
    >
      <div>
        {kicker && <div style={{ ...KICKER, color: "var(--k-accent)" }}>{kicker}</div>}
        <h2 style={{ ...HEAD, fontSize: 34, margin: "8px 0 0" }}>{title}</h2>
        {sub && <div style={{ fontSize: 18, color: "var(--k-n-700)", marginTop: 6 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/** O'ng tomondagi kontekst yorlig'i (masalan "Xizmat: UZI") */
export function ContextLabel({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div style={{ textAlign: "right", maxWidth: 420 }}>
      <div style={{ ...KICKER, fontSize: 13, letterSpacing: "0.16em", color: "var(--k-n-700)" }}>
        {label}
      </div>
      <div style={{ ...HEAD, fontSize: 19, lineHeight: 1.25 }}>{value}</div>
    </div>
  );
}

/** Kalit → qiymat qatori (xulosa va chiptada) */
export function SummaryRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--k-bg)",
        padding: "14px 0",
        display: "grid",
        gridTemplateColumns: "230px 1fr",
        gap: 20,
        alignItems: "baseline",
      }}
    >
      <div style={{ fontSize: 15, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--k-n-700)" }}>
        {k}
      </div>
      <div style={{ ...HEAD, fontSize: 21, lineHeight: 1.25 }}>{v}</div>
    </div>
  );
}

export function SummaryList({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 2,
        background: "var(--k-divider)",
        borderTop: "2px solid var(--k-divider)",
        borderBottom: "2px solid var(--k-divider)",
      }}
    >
      {children}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 64,
        color: "var(--k-n-600)",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          border: "3px solid var(--k-n-300)",
          borderTopColor: "var(--k-accent)",
          borderRadius: "50%",
          animation: "spin .8s linear infinite",
        }}
      />
      {label && <div style={{ fontSize: 17 }}>{label}</div>}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

export function EmptyState({ msg }: { msg: string }) {
  return (
    <div
      style={{
        margin: 32,
        padding: "48px 32px",
        textAlign: "center",
        fontSize: 20,
        color: "var(--k-n-600)",
        border: "2px solid var(--k-divider)",
      }}
    >
      {msg}
    </div>
  );
}

export function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div
      style={{
        margin: "0 32px 12px",
        padding: "14px 18px",
        background: "var(--k-red-100)",
        borderLeft: "6px solid var(--k-red-600)",
        color: "var(--k-red-700)",
        fontSize: 17,
      }}
    >
      {msg}
    </div>
  );
}
