"use client";

// "Men keldim" — bemor bron qilingan (kiosk/registratura/telegram, farqi
// yo'q) tashrifini kirish kodi bilan tasdiqlaydi. Shundan keyingina
// navbat ekranida (va reception panelida) ko'rinadi — bron qilib
// kelmagan odamlar navbatni "shishirmaydi".
//
// Kodlar CODE_ALPHABET bilan yaratiladi (backend/routes/booking.js) —
// O/0 va I/1 chalkashmasin deb ataylab olib tashlangan. Shu sababli
// bu yerda ham xuddi shu belgilar to'plami ko'rsatiladi — bemor
// chalkashadigan harf-raqam tanlamaydi.

import { CheckCircle2, Delete, KeyRound, Loader2 } from "lucide-react";
import { HEAD, KICKER, ScreenTitle, ErrorBanner } from "./ui";
import type { KioskT } from "@/lib/kiosk-i18n";
import type { CheckinResult } from "@/lib/kiosk-client";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".split("");

export function CheckinScreen({
  t,
  code,
  onKey,
  onBackspace,
  onClear,
  onSubmit,
  loading,
  result,
  error,
}: {
  t: KioskT;
  code: string;
  onKey: (ch: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onSubmit: () => void;
  loading: boolean;
  result: CheckinResult | null;
  error: string;
}) {
  if (result) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          padding: 32,
          textAlign: "center",
        }}
      >
        <CheckCircle2 size={76} strokeWidth={1.5} color="var(--k-green-600)" className="k-pop" />
        <div style={{ ...HEAD, fontSize: 36 }}>
          {result.already ? t.checkinAlreadyTitle : t.checkinDoneTitle}
        </div>
        {result.appointment?.doctor_name && (
          <div style={{ fontSize: 20, color: "var(--k-n-700)", maxWidth: 460, textWrap: "pretty" }}>
            {t.checkinDoneNote(result.appointment.doctor_name)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ScreenTitle kicker={t.tCheckin} title={t.checkinTitle} sub={t.checkinDesc} />
      {error && <ErrorBanner msg={error} />}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--k-n-600)" }}>
          <KeyRound size={20} strokeWidth={1.8} />
          <span style={KICKER}>{t.checkinCodeLabel}</span>
        </div>
        <div
          style={{
            ...HEAD,
            fontSize: 60,
            letterSpacing: "0.16em",
            minWidth: 340,
            textAlign: "center",
            padding: "8px 20px",
            borderBottom: "4px solid var(--k-accent)",
            color: code ? "var(--k-text)" : "var(--k-n-400)",
          }}
        >
          {code || "······"}
        </div>
      </div>

      <div style={{ padding: "0 20px 22px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(9, 1fr)",
            gap: 6,
            maxWidth: 760,
            margin: "0 auto",
          }}
        >
          {CODE_CHARS.map((c) => (
            <button
              key={c}
              onClick={() => onKey(c)}
              className="k-press"
              style={{
                height: 54,
                ...HEAD,
                fontSize: 21,
                background: "var(--k-n-800)",
                color: "var(--k-bg)",
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 12 }}>
          <button
            onClick={onBackspace}
            className="k-press"
            style={{
              height: 56, padding: "0 24px", display: "flex", alignItems: "center", gap: 8,
              background: "var(--k-n-700)", color: "var(--k-bg)", ...HEAD, fontSize: 16,
            }}
          >
            <Delete size={20} strokeWidth={2} /> {t.checkinBackspace}
          </button>
          <button
            onClick={onClear}
            className="k-press"
            style={{ height: 56, padding: "0 24px", background: "var(--k-n-700)", color: "var(--k-bg)", ...HEAD, fontSize: 16 }}
          >
            {t.clear}
          </button>
          <button
            onClick={onSubmit}
            disabled={code.length < 4 || loading}
            className="k-press"
            style={{
              height: 56, padding: "0 34px", display: "flex", alignItems: "center", gap: 10,
              background: "var(--k-accent)", color: "var(--k-bg)", ...HEAD, fontSize: 17,
              opacity: code.length < 4 || loading ? 0.4 : 1,
            }}
          >
            {loading ? <Loader2 size={20} style={{ animation: "kcSpin .8s linear infinite" }} /> : <CheckCircle2 size={20} strokeWidth={2} />}
            {t.checkinSubmit}
          </button>
        </div>
      </div>
      <style>{`@keyframes kcSpin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
