"use client";

// Ekrandagi klaviatura — teginish kioskida OS klaviaturasi chiqmasligi
// uchun. Ism uchun harflar, telefon uchun raqamlar.

import { Delete } from "lucide-react";
import { HEAD } from "./ui";

const ROWS_UZ = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", "'"],
  ["Z", "X", "C", "V", "B", "N", "M", "O'", "G'", "Sh"],
];

const ROWS_RU = [
  ["Й", "Ц", "У", "К", "Е", "Н", "Г", "Ш", "Щ", "З", "Х"],
  ["Ф", "Ы", "В", "А", "П", "Р", "О", "Л", "Д", "Ж", "Э"],
  ["Я", "Ч", "С", "М", "И", "Т", "Ь", "Б", "Ю", "Ъ", "Ё"],
];

const KEY_BASE = {
  height: 54,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  ...HEAD,
  color: "var(--k-bg)",
  background: "var(--k-n-800)",
  transition: "background .12s ease, transform .08s ease",
} as const;

function Key({
  label,
  onTap,
  width,
  flex,
  tone,
  children,
}: {
  label?: string;
  onTap: () => void;
  width?: number;
  flex?: number;
  tone?: "accent" | "muted";
  children?: React.ReactNode;
}) {
  return (
    <button
      onClick={onTap}
      style={{
        ...KEY_BASE,
        width,
        flex,
        maxWidth: flex ? 118 : undefined,
        fontSize: 21,
        background:
          tone === "accent" ? "var(--k-accent)" : tone === "muted" ? "var(--k-n-700)" : "var(--k-n-800)",
      }}
      onPointerDown={(e) => {
        e.currentTarget.style.transform = "scale(.92)";
        e.currentTarget.style.background = "var(--k-accent)";
      }}
      onPointerUp={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.background =
          tone === "accent" ? "var(--k-accent)" : tone === "muted" ? "var(--k-n-700)" : "var(--k-n-800)";
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.background =
          tone === "accent" ? "var(--k-accent)" : tone === "muted" ? "var(--k-n-700)" : "var(--k-n-800)";
      }}
    >
      {children ?? label}
    </button>
  );
}

export function OnScreenKeyboard({
  mode,
  lang,
  onKey,
  onBackspace,
  onClear,
  labels,
}: {
  mode: "letters" | "digits" | "idle";
  lang: "uz" | "ru";
  onKey: (ch: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  labels: { space: string; clear: string; hint: string };
}) {
  return (
    <div
      style={{
        flex: "none",
        background: "var(--k-n-900)",
        padding: "14px 20px",
        borderTop: "2px solid var(--k-divider)",
      }}
    >
      {mode === "idle" && (
        <div
          style={{
            height: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--k-n-400)",
            ...HEAD,
            fontSize: 20,
          }}
        >
          {labels.hint}
        </div>
      )}

      {mode === "letters" && (
        <div style={{ display: "grid", gap: 6 }}>
          {(lang === "ru" ? ROWS_RU : ROWS_UZ).map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 6, justifyContent: "center" }}>
              {row.map((k) => (
                <Key key={k} label={k} flex={1} onTap={() => onKey(k)} />
              ))}
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
            <Key flex={1} onTap={() => onKey(" ")}>
              <span style={{ fontSize: 17, letterSpacing: "0.1em", textTransform: "uppercase" }}>{labels.space}</span>
            </Key>
            <Key width={150} tone="muted" onTap={onBackspace}>
              <Delete size={28} strokeWidth={2} />
            </Key>
            <Key width={170} tone="accent" onTap={onClear}>
              <span style={{ fontSize: 17, letterSpacing: "0.06em", textTransform: "uppercase" }}>{labels.clear}</span>
            </Key>
          </div>
        </div>
      )}

      {mode === "digits" && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "flex-start" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 96px)", gap: 6 }}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((d) => (
              <Key key={d} label={d} onTap={() => onKey(d)} />
            ))}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <Key width={160} tone="muted" onTap={onBackspace}>
              <Delete size={28} strokeWidth={2} />
            </Key>
            <Key width={160} tone="accent" onTap={onClear}>
              <span style={{ fontSize: 17, letterSpacing: "0.06em", textTransform: "uppercase" }}>{labels.clear}</span>
            </Key>
          </div>
        </div>
      )}
    </div>
  );
}
