"use client";

// Kiosk ramkasi — yuqori sarlavha (logo, telefon, soat, til) va
// pastki navigatsiya (orqaga / bosh sahifa / davom etish).

import Image from "next/image";
import { ArrowLeft, ArrowRight, Home, Phone } from "lucide-react";
import { HEAD } from "./ui";

export function KioskHeader({
  clinicName,
  logoUrl,
  phone,
  now,
  lang,
  onLang,
  onHome,
}: {
  clinicName: string;
  logoUrl?: string | null;
  phone?: string | null;
  now: Date;
  lang: "uz" | "ru";
  onLang: (l: "uz" | "ru") => void;
  onHome: () => void;
}) {
  // "OQTOSH KLINIKASI" -> birinchi so'z qora, qolgani ko'k
  const [first, ...rest] = clinicName.toUpperCase().split(" ");

  return (
    <div
      style={{
        flex: "none",
        height: 76,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "0 32px",
        borderBottom: "2px solid var(--k-divider)",
      }}
    >
      <button onClick={onHome} style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {logoUrl ? (
          <Image src={logoUrl} alt="" width={54} height={54} style={{ objectFit: "contain" }} unoptimized />
        ) : null}
        <span style={{ ...HEAD, fontSize: 26 }}>{first}</span>
        {rest.length > 0 && (
          <span style={{ ...HEAD, fontSize: 26, color: "var(--k-accent)" }}>{rest.join(" ")}</span>
        )}
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        {phone && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 16,
              letterSpacing: "0.06em",
              color: "var(--k-n-700)",
            }}
          >
            <Phone size={18} strokeWidth={2} />
            <span>{phone}</span>
          </div>
        )}
        <div style={{ width: 2, height: 44, background: "var(--k-divider)" }} />
        <div style={{ textAlign: "right", lineHeight: 1.15 }}>
          <div style={{ ...HEAD, fontSize: 24, fontVariantNumeric: "tabular-nums" }}>
            {now.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div style={{ fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--k-n-700)" }}>
            {now.toLocaleDateString("uz-UZ", { day: "numeric", month: "long" })}
          </div>
        </div>
        <div style={{ display: "flex", border: "2px solid var(--k-divider)" }}>
          {(["uz", "ru"] as const).map((l, i) => (
            <button
              key={l}
              onClick={() => onLang(l)}
              className="k-press"
              style={{
                width: 60,
                height: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                ...HEAD,
                fontSize: 18,
                borderLeft: i ? "2px solid var(--k-divider)" : undefined,
                background: lang === l ? "var(--k-accent)" : "transparent",
                color: lang === l ? "var(--k-bg)" : "var(--k-text)",
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function KioskFooter({
  canBack,
  onBack,
  onHome,
  hint,
  nextLabel,
  nextEnabled,
  onNext,
  labels,
}: {
  canBack: boolean;
  onBack: () => void;
  onHome: () => void;
  hint?: string;
  nextLabel?: string;
  nextEnabled?: boolean;
  onNext?: () => void;
  labels: { back: string; home: string };
}) {
  const ghost = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: 52,
    padding: "0 22px",
    border: "2px solid var(--k-divider)",
    ...HEAD,
    fontSize: 18,
  } as const;

  return (
    <div
      style={{
        flex: "none",
        height: 76,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "0 32px",
        borderTop: "2px solid var(--k-divider)",
        background: "var(--k-bg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {canBack && (
          <button onClick={onBack} className="k-press" style={ghost}>
            <ArrowLeft size={20} strokeWidth={2} />
            <span>{labels.back}</span>
          </button>
        )}
        <button onClick={onHome} className="k-press" style={ghost}>
          <Home size={20} strokeWidth={2} />
          <span>{labels.home}</span>
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {hint && <div style={{ fontSize: 16, color: "var(--k-n-700)" }}>{hint}</div>}
        {nextLabel && onNext && (
          <button
            onClick={onNext}
            disabled={!nextEnabled}
            className="k-press"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              height: 56,
              padding: "0 28px",
              ...HEAD,
              fontSize: 20,
              background: nextEnabled ? "var(--k-accent)" : "var(--k-n-300)",
              color: nextEnabled ? "var(--k-bg)" : "var(--k-n-600)",
            }}
          >
            <span>{nextLabel}</span>
            <ArrowRight size={22} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
