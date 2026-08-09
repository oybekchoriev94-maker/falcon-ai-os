"use client";

// Qurilmani birinchi marta sozlash — administrator token kiritadi.
// Bemor ko'radigan ekran emas, shuning uchun oddiy va aniq.

import { useState } from "react";
import { KeyRound, Loader2, MonitorCog } from "lucide-react";
import { HEAD, KICKER } from "./ui";

export function PairingScreen({
  onSubmit,
  error,
  loading,
}: {
  onSubmit: (token: string) => void;
  error: string;
  loading: boolean;
}) {
  const [token, setToken] = useState("");
  const ok = token.trim().length >= 8;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--k-bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520, border: "2px solid var(--k-divider)", background: "var(--k-bg)" }}>
        <div style={{ background: "var(--k-n-900)", color: "var(--k-bg)", padding: "28px 32px" }}>
          <MonitorCog size={40} strokeWidth={1.6} />
          <div style={{ ...KICKER, opacity: 0.7, marginTop: 16 }}>Falcon AI OS</div>
          <h1 style={{ ...HEAD, fontSize: 34, margin: "6px 0 0" }}>Qurilmani sozlash</h1>
        </div>

        <form
          style={{ padding: 32 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onSubmit(token.trim());
          }}
        >
          <p style={{ fontSize: 17, color: "var(--k-n-700)", marginTop: 0, marginBottom: 20, textWrap: "pretty" }}>
            Administrator panelidan olingan qurilma tokenini kiriting.
          </p>

          <div style={{ position: "relative" }}>
            <KeyRound
              size={20}
              strokeWidth={2}
              style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--k-n-500)" }}
            />
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="kd_..."
              autoFocus
              spellCheck={false}
              style={{
                width: "100%",
                height: 64,
                padding: "0 16px 0 48px",
                fontSize: 19,
                fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                border: "2px solid var(--k-divider)",
                background: "var(--k-bg)",
              }}
            />
          </div>

          {error && (
            <div
              style={{
                marginTop: 14,
                padding: "12px 16px",
                background: "var(--k-red-100)",
                borderLeft: "6px solid var(--k-red-600)",
                color: "var(--k-red-700)",
                fontSize: 16,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !ok}
            className="k-press"
            style={{
              marginTop: 20,
              width: "100%",
              height: 62,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              ...HEAD,
              fontSize: 20,
              background: ok ? "var(--k-accent)" : "var(--k-n-300)",
              color: ok ? "var(--k-bg)" : "var(--k-n-600)",
            }}
          >
            {loading && <Loader2 size={20} className="animate-spin" />}
            Ulash
          </button>

          <div style={{ marginTop: 24, paddingTop: 20, borderTop: "2px solid var(--k-divider)", fontSize: 15, color: "var(--k-n-600)" }}>
            Boshqarish paneli → Kiosk qurilmalari → Yangi qurilma
          </div>
        </form>
      </div>
    </div>
  );
}
