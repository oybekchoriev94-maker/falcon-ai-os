"use client";

// Statsionarga joy so'rash.
//
// Bemor aniq KOYKANI tanlamaydi — faqat bo'limni ko'rsatishi mumkin
// (yoki "farqi yo'q"). Kimni qaysi palataga yotqizish shifokor va
// registratura qarori: jinsi, tashxisi, infeksiya xavfi hisobga
// olinadi. Kiosk bo'sh joy borligini ko'rsatadi va so'rov yozadi.

import { BedDouble, Check, CheckCheck, Loader2, ShieldAlert } from "lucide-react";
import { HEAD, KICKER, ScreenTitle, Spinner, EmptyState } from "./ui";
import { OnScreenKeyboard } from "./keyboard";
import type { KioskWard } from "@/lib/kiosk-client";
import type { KioskT } from "@/lib/kiosk-i18n";

export function InpatientScreen({
  t,
  lang,
  wards,
  loading,
  wardId,
  onWard,
  name,
  phone,
  focus,
  onFocus,
  onKey,
  onBackspace,
  onClear,
  sending,
  done,
}: {
  t: KioskT;
  lang: "uz" | "ru";
  wards: KioskWard[];
  loading: boolean;
  wardId: string | null;
  onWard: (id: string | null) => void;
  name: string;
  phone: string;
  focus: "name" | "phone" | null;
  onFocus: (f: "name" | "phone") => void;
  onKey: (ch: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  sending: boolean;
  done: boolean;
}) {
  if (loading) return <Spinner label={t.loading} />;

  if (done) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          padding: 40,
          textAlign: "center",
        }}
      >
        <CheckCheck className="k-pop" size={72} strokeWidth={2.2} color="var(--k-green-600)" />
        <h2 style={{ ...HEAD, fontSize: 40 }}>{t.inpatientDone}</h2>
        <p style={{ fontSize: 20, color: "var(--k-n-700)", maxWidth: 620, textWrap: "pretty" }}>
          {t.inpatientDoneNote}
        </p>
      </div>
    );
  }

  const fmtPhone = (d: string) => {
    const p = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
    return p.length ? `+998 ${p.join(" ")}` : "";
  };

  const field = (label: string, value: string, ph: string, key: "name" | "phone") => (
    <button onClick={() => onFocus(key)} style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 14,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--k-n-700)",
          marginBottom: 6,
        }}
      >
        <span>{label}</span>
        <span style={{ color: value ? "var(--k-green-700)" : "var(--k-accent)" }}>
          {value ? "✓" : t.required}
        </span>
      </div>
      <div
        style={{
          height: 58,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          fontSize: 21,
          background: "var(--k-bg)",
          border: `2px solid ${focus === key ? "var(--k-accent)" : "var(--k-divider)"}`,
          color: value ? "var(--k-text)" : "color-mix(in srgb, #16303c 35%, transparent)",
        }}
      >
        {value || ph}
      </div>
    </button>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ScreenTitle kicker={t.tInpatient} title={t.inpatientTitle} />

      {/* Nima uchun koyka tanlanmasligini ochiq aytamiz */}
      <div
        style={{
          flex: "none",
          margin: "0 32px 16px",
          padding: "12px 16px",
          background: "var(--k-accent-100)",
          borderLeft: "6px solid var(--k-accent)",
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          fontSize: 16,
          color: "var(--k-accent-900)",
        }}
      >
        <ShieldAlert size={20} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} />
        <span style={{ textWrap: "pretty" }}>{t.inpatientNote}</span>
      </div>

      <div style={{ flex: "none", padding: "0 32px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Bo'limlar — bo'sh joy soni bilan */}
        <div>
          <div style={{ ...KICKER, color: "var(--k-n-700)", marginBottom: 8 }}>{t.tInpatientDesc}</div>
          {!wards.length ? (
            <EmptyState msg={t.inpatientNoWards} />
          ) : (
            <div style={{ display: "grid", gap: 2, background: "var(--k-divider)", border: "2px solid var(--k-divider)" }}>
              {wards.map((w) => {
                const on = wardId === w.id;
                const full = w.free === 0;
                return (
                  <button
                    key={w.id}
                    onClick={() => onWard(on ? null : w.id)}
                    className="k-press"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "14px 18px",
                      background: on ? "var(--k-accent)" : "var(--k-bg)",
                      color: on ? "var(--k-bg)" : "var(--k-text)",
                    }}
                  >
                    <BedDouble size={24} strokeWidth={1.7} />
                    <div style={{ flex: 1, textAlign: "left" }}>
                      <div style={{ ...HEAD, fontSize: 19 }}>{w.name}</div>
                      <div
                        style={{
                          fontSize: 15,
                          marginTop: 1,
                          color: on ? "rgba(255,255,255,.85)" : full ? "var(--k-red-600)" : "var(--k-green-700)",
                        }}
                      >
                        {full ? t.wardFull : t.wardFree(w.free)}
                      </div>
                    </div>
                    {on && <Check size={22} strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Ism va telefon */}
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          {field(t.fPhone, fmtPhone(phone), t.fPhonePh, "phone")}
          {field(t.fName, name, t.fNamePh, "name")}
          {sending && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 17, color: "var(--k-n-600)" }}>
              <Loader2 size={18} className="animate-spin" /> {t.loading}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }} />

      <OnScreenKeyboard
        mode={focus === "name" ? "letters" : focus === "phone" ? "digits" : "idle"}
        lang={lang}
        onKey={onKey}
        onBackspace={onBackspace}
        onClear={onClear}
        labels={{ space: t.space, clear: t.clear, hint: t.kbHint }}
      />
    </div>
  );
}
