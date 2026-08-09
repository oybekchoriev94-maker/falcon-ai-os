"use client";

// Ekran-saver — kiosk bo'sh turganda. Bosilsa bosh sahifaga o'tadi.
//
// Bitta takrorlanuvchi animatsiya bor: "EKRANGA TEGING" sekin
// yonib-o'chadi. Bu bezak emas — uzoqdan turgan odamga ekran tirik
// ekanini bildiradi. Boshqa hech narsa harakatlanmaydi.

import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { HEAD, KICKER } from "./ui";
import type { KioskT } from "@/lib/kiosk-i18n";

export function Screensaver({
  t,
  clinicName,
  logoUrl,
  onStart,
}: {
  t: KioskT;
  clinicName: string;
  logoUrl?: string | null;
  onStart: () => void;
}) {
  const [first, ...rest] = clinicName.toUpperCase().split(" ");

  return (
    <button
      onClick={onStart}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        background: "var(--k-bg)",
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 48px",
          borderRight: "2px solid var(--k-divider)",
        }}
      >
        <div>
          {logoUrl && (
            <Image
              src={logoUrl}
              alt=""
              width={124}
              height={124}
              style={{ objectFit: "contain", margin: "-16px 0 4px -10px" }}
              unoptimized
            />
          )}
          <div style={{ ...KICKER, ...HEAD, fontSize: 15, letterSpacing: "0.22em", color: "var(--k-accent-700)" }}>
            {t.idleKicker}
          </div>
          <h1 style={{ ...HEAD, fontSize: 88, lineHeight: 0.92, letterSpacing: "-0.04em", margin: "22px 0 0" }}>
            {first}
          </h1>
          {rest.length > 0 && (
            <h1
              style={{
                ...HEAD,
                fontSize: 88,
                lineHeight: 0.92,
                letterSpacing: "-0.04em",
                margin: 0,
                color: "var(--k-accent)",
              }}
            >
              {rest.join(" ")}
            </h1>
          )}
          <div style={{ height: 2, background: "var(--k-divider)", margin: "32px 0 24px" }} />
          <div
            style={{
              display: "grid",
              gap: 10,
              ...HEAD,
              fontSize: 22,
              textTransform: "uppercase",
              letterSpacing: "0.02em",
            }}
          >
            <div>{t.tBook}</div>
            <div>{t.tPrices}</div>
            <div>{t.tDoctors}</div>
            <div>{t.tQueue}</div>
          </div>
        </div>

        <div>
          <div style={{ ...KICKER, fontSize: 14, letterSpacing: "0.2em", color: "var(--k-n-700)", marginBottom: 10 }}>
            {t.idleStart}
          </div>
          <div className="k-glow" style={{ display: "flex", alignItems: "center", gap: 20, color: "var(--k-accent)" }}>
            <span style={{ ...HEAD, fontSize: 44, lineHeight: 1 }}>{t.touch}</span>
            <ArrowRight size={44} strokeWidth={1.8} />
          </div>
        </div>
      </div>

      <div style={{ position: "relative", background: "var(--k-n-200)" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            background: "var(--k-accent)",
            color: "var(--k-bg)",
            padding: "26px 32px",
          }}
        >
          <div style={{ ...HEAD, fontSize: 26, letterSpacing: "-0.01em" }}>{t.idleTag}</div>
          <div style={{ fontSize: 17, opacity: 0.85, marginTop: 4 }}>{t.idleHours}</div>
        </div>
      </div>
    </button>
  );
}
