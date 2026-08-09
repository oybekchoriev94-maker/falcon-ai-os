"use client";

// Bosh sahifa — 4 ta amal. Chapda katta "Qabulga yozilish" (asosiy
// harakat), o'ngda 3 ta yordamchi plitka.

import { ArrowRight, BedDouble, CalendarPlus, ClipboardList, Stethoscope, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { HEAD } from "./ui";
import type { KioskT } from "@/lib/kiosk-i18n";

function SmallTile({
  n,
  Icon,
  title,
  desc,
  onClick,
  delay,
  tone = "light",
}: {
  n: string;
  Icon: LucideIcon;
  title: string;
  desc: string;
  onClick: () => void;
  delay: string;
  tone?: "light" | "green";
}) {
  const green = tone === "green";
  return (
    <button
      onClick={onClick}
      className="k-fade k-press"
      style={{
        animationDelay: delay,
        background: green ? "var(--k-green-600)" : "var(--k-bg)",
        color: green ? "#fff" : "var(--k-text)",
        padding: 28,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minHeight: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <span
          style={{
            ...HEAD,
            fontSize: 16,
            letterSpacing: "0.16em",
            color: green ? "rgba(255,255,255,.75)" : "var(--k-accent)",
          }}
        >
          {n}
        </span>
        <Icon size={32} strokeWidth={1.6} color={green ? "currentColor" : "var(--k-accent)"} />
      </div>
      <div>
        <div style={{ ...HEAD, fontSize: 30, lineHeight: 1.05 }}>{title}</div>
        <div
          style={{
            fontSize: 17,
            color: green ? "rgba(255,255,255,.8)" : "var(--k-n-700)",
            marginTop: 8,
            textWrap: "pretty",
          }}
        >
          {desc}
        </div>
      </div>
    </button>
  );
}

export function HomeScreen({
  t,
  onBook,
  onPrices,
  onDoctors,
  onQueue,
  onInpatient,
}: {
  t: KioskT;
  onBook: () => void;
  onPrices: () => void;
  onDoctors: () => void;
  onQueue: () => void;
  onInpatient: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 2,
        background: "var(--k-divider)",
      }}
    >
      <button
        onClick={onBook}
        className="k-fade k-press"
        style={{
          background: "var(--k-accent)",
          color: "var(--k-bg)",
          padding: 40,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <span style={{ ...HEAD, fontSize: 16, letterSpacing: "0.16em" }}>01</span>
          {/* Asosiy harakat — strelka o'ngga imo qiladi */}
          <ArrowRight className="k-nudge" size={40} strokeWidth={1.6} />
        </div>
        <div>
          <CalendarPlus size={56} strokeWidth={1.5} style={{ marginBottom: 16 }} />
          <div style={{ fontSize: 14, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.8, marginBottom: 14 }}>
            {t.welcome}
          </div>
          <div style={{ ...HEAD, fontSize: 60, lineHeight: 0.98, letterSpacing: "-0.03em" }}>{t.tBook}</div>
          <div style={{ fontSize: 20, opacity: 0.9, marginTop: 14, maxWidth: 420, textWrap: "pretty" }}>
            {t.tBookDesc}
          </div>
        </div>
      </button>

      <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 2, background: "var(--k-divider)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, background: "var(--k-divider)" }}>
          <SmallTile n="02" Icon={ClipboardList} title={t.tPrices} desc={t.tPricesDesc} onClick={onPrices} delay=".06s" />
          <SmallTile n="03" Icon={Stethoscope} title={t.tDoctors} desc={t.tDoctorsDesc} onClick={onDoctors} delay=".12s" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, background: "var(--k-divider)" }}>
          <SmallTile n="04" Icon={BedDouble} title={t.tInpatient} desc={t.tInpatientDesc} onClick={onInpatient} delay=".18s" />
          <SmallTile n="05" Icon={Users} title={t.tQueue} desc={t.tQueueDesc} onClick={onQueue} delay=".24s" tone="green" />
        </div>
      </div>
    </div>
  );
}
