"use client";

// Bron qilish oqimi — 5 qadam: xizmat → shifokor → vaqt → ma'lumot → tasdiq.

import {
  Activity,
  Baby,
  Banknote,
  Check,
  ChevronRight,
  Clock,
  FlaskConical,
  HeartPulse,
  IdCard,
  Layers,
  Loader2,
  QrCode,
  Scan,
  Stethoscope,
  UserCheck,
  UserX,
  Waves,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { HEAD, KICKER, ContextLabel, ScreenTitle, SummaryList, SummaryRow, Spinner, EmptyState } from "./ui";
import { OnScreenKeyboard } from "./keyboard";
import { PayBrands } from "./pay-brands";
import {
  fmtSum,
  type KioskService,
  type KioskDepartment,
  type KioskSlot,
  type LookupResult,
  type KioskPayMethod,
} from "@/lib/kiosk-client";
import type { KioskT } from "@/lib/kiosk-i18n";

export interface PickedDoctor {
  id: string;
  name: string;
  department: string;
}

/* ── Yo'nalish ↔ xizmat mosligi ────────────────────────────────
   Shifokorning specialization'i (ginekolog/uzi/urolog/laborant) va
   xizmatning category/specialty maydonlari boshqa-boshqa lug'atdan.
   Bu jadval Oqtosh klinikasining real to'plamiga sozlangan — yangi
   shifokor yoki xizmat turi qo'shilsa, shu yerni ham yangilash kerak. */
const DOCTOR_MATCHES: Record<string, (s: KioskService) => boolean> = {
  ginekolog: (s) =>
    s.category === "UZI" ||
    s.category === "Laboratoriya · Gormonlar" ||
    s.category === "Laboratoriya · TORCH" ||
    s.category === "Laboratoriya · Onkomarker" ||
    s.category === "Rentgen · Kontrastli",
  uzi: (s) => s.category === "UZI",
  urolog: (s) =>
    s.specialty === "urolog" ||
    s.category === "Rentgen · Kontrastli" ||
    s.category === "Laboratoriya · Onkomarker" ||
    s.category === "UZI",
  // Reproduktolog "Shifokor ko'rigi"ni ham bajaradi — ikkalasi ham
  // services_catalog.specialty = 'reproduktolog' bilan belgilangan.
  reproduktolog: (s) => s.specialty === "reproduktolog",
  xirurg: (s) => s.specialty === "xirurg",
  laborant: (s) => (s.category || "").startsWith("Laboratoriya"),
  fizioterapevt: (s) => s.category === "Fizioterapiya",
  ekg: (s) => s.category === "Diagnostika",
  rentgen: (s) => (s.category || "").startsWith("Rentgen"),
};

/**
 * Bir odam bir nechta yo'nalishda ro'yxatdan o'tgan bo'lishi mumkin
 * (masalan Jamshid Tursunpo'latov ham urolog, ham UZI mutaxassisi —
 * bazada 2 ta alohida yozuv). Ro'yxatda ikki marta ko'rsatish bemorni
 * chalkashtiradi, shuning uchun ism bo'yicha bittaga tushiramiz.
 *
 * Qaysi yozuv qoladi? Xizmatga eng aniq mos keladigani. "Aniqlik"
 * yo'nalish filtri butun katalogdan nechta xizmatni qamrashi bilan
 * o'lchanadi: kamroq qamrasa — torroq, demak aniqroq. UZI tekshiruvi
 * uchun "uzi" (11 xizmat) "urolog"dan (23 xizmat) aniqroq.
 */
function dedupeByPerson(
  rows: (PickedDoctor & { breadth: number })[]
): PickedDoctor[] {
  const best = new Map<string, PickedDoctor & { breadth: number }>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    const prev = best.get(key);
    if (!prev || r.breadth < prev.breadth) best.set(key, r);
  }
  return [...best.values()].map(({ id, name, department }) => ({ id, name, department }));
}

/** Xizmatni bajara oladigan shifokorlar. Mos keluvchi bo'lmasa — barchasi. */
export function doctorsForService(
  departments: KioskDepartment[],
  svc: KioskService | null,
  allServices: KioskService[] = []
) {
  // Har bir yo'nalish katalogdan nechta xizmatni qamraydi
  const breadthOf = (dept: string) => {
    const f = DOCTOR_MATCHES[dept];
    if (!f || !allServices.length) return Number.MAX_SAFE_INTEGER;
    return allServices.filter(f).length;
  };

  const everyone = departments.flatMap((d) =>
    d.doctors.map((x) => ({ id: x.id, name: x.name, department: d.name, breadth: breadthOf(d.name) }))
  );

  if (!svc) return { list: dedupeByPerson(everyone), exact: true };

  const matched = departments.flatMap((d) => {
    const f = DOCTOR_MATCHES[d.name];
    if (!f || !f(svc)) return [];
    return d.doctors.map((x) => ({ id: x.id, name: x.name, department: d.name, breadth: breadthOf(d.name) }));
  });

  return matched.length
    ? { list: dedupeByPerson(matched), exact: true }
    : { list: dedupeByPerson(everyone), exact: false };
}

/* ── Kategoriya ikonkalari ── */
const CAT_ICON: { test: (c: string) => boolean; Icon: LucideIcon }[] = [
  { test: (c) => c.startsWith("Laboratoriya"), Icon: FlaskConical },
  { test: (c) => c === "UZI", Icon: Waves },
  { test: (c) => c.startsWith("Rentgen"), Icon: Scan },
  { test: (c) => c === "Fizioterapiya", Icon: Zap },
  { test: (c) => c === "Diagnostika", Icon: Activity },
  { test: (c) => c.includes("qabul"), Icon: Stethoscope },
  { test: (c) => c.includes("Tug"), Icon: Baby },
];
function catIcon(c: string): LucideIcon {
  return CAT_ICON.find((x) => x.test(c))?.Icon ?? Layers;
}

const DEPT_LABEL: Record<string, string> = {
  ginekolog: "Ginekolog",
  laborant: "Laborant",
  urolog: "Urolog",
  uzi: "UZI mutaxassisi",
  fizioterapevt: "Fizioterapevt",
  rentgen: "Rentgenolog",
  reproduktolog: "Reproduktolog",
  xirurg: "Xirurg",
  therapy: "Terapevt",
};
export function deptLabel(n: string) {
  return DEPT_LABEL[n] || n;
}

/* ── Qadam ko'rsatkichi ── */
export function StepBar({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div
      style={{
        flex: "none",
        display: "grid",
        gridTemplateColumns: `repeat(${labels.length}, 1fr)`,
        gap: 2,
        background: "var(--k-divider)",
        borderBottom: "2px solid var(--k-divider)",
      }}
    >
      {labels.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <div
            key={label}
            style={{
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: active ? "var(--k-accent)" : done ? "var(--k-accent-100)" : "var(--k-bg)",
              color: active ? "var(--k-bg)" : done ? "var(--k-accent-700)" : "var(--k-n-600)",
              transition: "background .22s ease, color .22s ease",
            }}
          >
            <span style={{ ...HEAD, fontSize: 15, opacity: 0.7 }}>{String(n).padStart(2, "0")}</span>
            <span style={{ ...HEAD, fontSize: 16, textTransform: "uppercase", letterSpacing: "0.02em" }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── 1-qadam: xizmat ── */
export function StepService({
  t,
  services,
  loading,
  activeCat,
  onCat,
  onPick,
}: {
  t: KioskT;
  services: KioskService[];
  loading: boolean;
  activeCat: string | null;
  onCat: (c: string) => void;
  onPick: (s: KioskService) => void;
}) {
  const cats = [...new Set(services.map((s) => s.category || "Boshqa"))];
  const cat = activeCat && cats.includes(activeCat) ? activeCat : cats[0];
  const list = services.filter((s) => (s.category || "Boshqa") === cat);

  if (loading) return <Spinner label={t.loading} />;
  if (!services.length) return <EmptyState msg={t.errGeneric} />;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "320px 1fr", gap: 2, background: "var(--k-divider)" }}>
      <div style={{ background: "var(--k-bg)", overflowY: "auto", padding: "20px 0" }}>
        <div style={{ ...KICKER, color: "var(--k-n-700)", padding: "0 24px 14px" }}>{t.category}</div>
        {cats.map((c, i) => {
          const Icon = catIcon(c);
          const on = c === cat;
          return (
            <button
              key={c}
              onClick={() => onCat(c)}
              className="k-side k-press"
              style={{
                animationDelay: `${Math.min(i, 8) * 0.03}s`,
                width: "100%",
                padding: "18px 24px",
                display: "grid",
                gridTemplateColumns: "26px 1fr",
                gap: 14,
                alignItems: "center",
                ...HEAD,
                fontSize: 18,
                lineHeight: 1.2,
                borderLeft: `6px solid ${on ? "var(--k-accent)" : "transparent"}`,
                background: on ? "var(--k-accent-100)" : "transparent",
                color: on ? "var(--k-accent-800)" : "var(--k-text)",
              }}
            >
              <Icon size={24} strokeWidth={1.8} />
              <span>{c}</span>
            </button>
          );
        })}
      </div>

      <div style={{ background: "var(--k-bg)", overflowY: "auto" }}>
        <div style={{ padding: "24px 32px 12px" }}>
          <div style={{ ...KICKER, color: "var(--k-accent)" }}>{t.step1}</div>
          <h2 style={{ ...HEAD, fontSize: 34, margin: "8px 0 0" }}>{cat}</h2>
        </div>
        <div style={{ display: "grid", gap: 2, background: "var(--k-divider)", borderTop: "2px solid var(--k-divider)" }}>
          {list.map((s, i) => (
            <button
              key={s.id}
              onClick={() => onPick(s)}
              className="k-up k-press k-hover"
              style={{
                animationDelay: `${Math.min(i, 10) * 0.025}s`,
                background: "var(--k-bg)",
                padding: "20px 32px",
                minHeight: 88,
                display: "grid",
                gridTemplateColumns: "1fr auto 26px",
                alignItems: "center",
                gap: 22,
              }}
            >
              <div>
                <div style={{ ...HEAD, fontSize: 21, lineHeight: 1.2, letterSpacing: "-0.01em" }}>{s.name}</div>
                {s.duration_min ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 16, color: "var(--k-n-700)", marginTop: 4 }}>
                    <Clock size={15} strokeWidth={1.8} /> {s.duration_min} daqiqa
                  </div>
                ) : null}
              </div>
              <div style={{ ...HEAD, fontSize: 22, textAlign: "right", whiteSpace: "nowrap" }}>{fmtSum(s.price)}</div>
              <ChevronRight className="k-arrow" size={26} strokeWidth={2} color="var(--k-accent)" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── 2-qadam: shifokor ── */
export function StepDoctor({
  t,
  doctors,
  exact,
  serviceName,
  onPick,
}: {
  t: KioskT;
  doctors: PickedDoctor[];
  exact: boolean;
  serviceName?: string;
  onPick: (d: PickedDoctor) => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <ScreenTitle
        kicker={t.step2}
        title={t.chooseDoctor}
        sub={exact ? undefined : t.pickOne}
        right={<ContextLabel label={t.service} value={serviceName} />}
      />
      {!doctors.length ? (
        <EmptyState msg={t.noDoctors} />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 2,
            background: "var(--k-divider)",
            borderTop: "2px solid var(--k-divider)",
          }}
        >
          {doctors.map((d, i) => (
            <button
              key={d.id + d.department}
              onClick={() => onPick(d)}
              className="k-up k-press k-hover"
              style={{
                animationDelay: `${i * 0.04}s`,
                background: "var(--k-bg)",
                padding: "20px 24px",
                minHeight: 124,
                display: "grid",
                gridTemplateColumns: "72px 1fr 24px",
                gap: 20,
                alignItems: "center",
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
                {d.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join("")
                  .toUpperCase()}
              </div>
              <div>
                <div style={{ ...HEAD, fontSize: 21, lineHeight: 1.15 }}>{d.name}</div>
                <div style={{ fontSize: 17, color: "var(--k-n-700)", marginTop: 3 }}>{deptLabel(d.department)}</div>
              </div>
              <ChevronRight className="k-arrow" size={24} strokeWidth={2} color="var(--k-accent)" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 3-qadam: vaqt ── */
export function StepTime({
  t,
  days,
  day,
  onDay,
  slots,
  loading,
  doctorName,
  onPick,
}: {
  t: KioskT;
  days: { key: string; wd: string; num: string; mon: string }[];
  day: string;
  onDay: (k: string) => void;
  slots: KioskSlot[];
  loading: boolean;
  doctorName?: string;
  onPick: (iso: string) => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ScreenTitle kicker={t.step3} title={t.chooseTime} right={<ContextLabel label={t.doctor} value={doctorName} />} />

      <div
        style={{
          flex: "none",
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 2,
          background: "var(--k-divider)",
          borderTop: "2px solid var(--k-divider)",
          borderBottom: "2px solid var(--k-divider)",
        }}
      >
        {days.map((d) => {
          const on = d.key === day;
          return (
            <button
              key={d.key}
              onClick={() => onDay(d.key)}
              className="k-press"
              style={{
                padding: "14px 10px",
                textAlign: "center",
                background: on ? "var(--k-accent)" : "var(--k-bg)",
                color: on ? "var(--k-bg)" : "var(--k-text)",
              }}
            >
              <div style={{ fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.75 }}>{d.wd}</div>
              <div style={{ ...HEAD, fontSize: 28, lineHeight: 1.1, marginTop: 2 }}>{d.num}</div>
              <div style={{ fontSize: 14, opacity: 0.75 }}>{d.mon}</div>
            </button>
          );
        })}
      </div>

      {loading ? (
        <Spinner label={t.loading} />
      ) : !slots.length ? (
        <EmptyState msg={t.noSlots} />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 32px 24px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
            <div style={{ fontSize: 15, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--k-n-700)" }}>
              {t.freeCount(slots.length)}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
            {slots.map((s, i) => (
              <button
                key={s.iso}
                onClick={() => onPick(s.iso)}
                className="k-pop k-press"
                style={{
                  animationDelay: `${Math.min(i, 18) * 0.015}s`,
                  height: 64,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  ...HEAD,
                  fontSize: 21,
                  border: "2px solid var(--k-accent-300)",
                  background: "var(--k-bg)",
                  color: "var(--k-accent-800)",
                }}
              >
                <Clock size={16} strokeWidth={2.2} style={{ opacity: 0.55 }} />
                <span>{s.time}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 4-qadam: ma'lumot ── */
export function StepData({
  t,
  lang,
  name,
  phone,
  focus,
  onFocus,
  onKey,
  onBackspace,
  onClear,
  known,
  identity,
  lookingUp,
  confirming,
  onConfirmIdentity,
  onDeclineIdentity,
  pay,
  onPay,
}: {
  t: KioskT;
  lang: "uz" | "ru";
  name: string;
  phone: string;
  focus: "name" | "phone" | null;
  onFocus: (f: "name" | "phone") => void;
  onKey: (ch: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  known: LookupResult | null;
  identity: "unknown" | "confirmed" | "manual";
  lookingUp: boolean;
  confirming: boolean;
  onConfirmIdentity: () => void;
  onDeclineIdentity: () => void;
  pay: KioskPayMethod;
  onPay: (p: KioskPayMethod) => void;
}) {
  const fmtPhone = (d: string) => {
    const p = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
    return p.length ? `+998 ${p.join(" ")}` : "";
  };

  const field = (
    label: string,
    value: string,
    ph: string,
    key: "name" | "phone",
    locked?: boolean
  ) => (
    <button onClick={() => !locked && onFocus(key)} style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: 14,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--k-n-700)",
          marginBottom: 6,
        }}
      >
        <span>{label}</span>
        <span style={{ color: value ? "var(--k-green-700)" : "var(--k-accent)" }}>{value ? "✓" : t.required}</span>
      </div>
      <div
        style={{
          width: "100%",
          height: 60,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          fontSize: 22,
          background: locked ? "var(--k-accent-100)" : "var(--k-bg)",
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
      <div style={{ flex: "none", padding: "18px 32px 12px" }}>
        <div style={{ ...KICKER, color: "var(--k-accent)" }}>{t.step4}</div>
        <h2 style={{ ...HEAD, fontSize: 30, margin: "6px 0 0" }}>{t.yourData}</h2>
      </div>

      <div style={{ flex: "none", padding: "0 32px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 24px" }}>
        {field(t.fPhone, fmtPhone(phone), t.fPhonePh, "phone")}
        {field(t.fName, name, t.fNamePh, "name", identity === "confirmed")}
      </div>

      <div style={{ flex: "none", padding: "14px 32px 0", minHeight: 96 }}>
        {lookingUp && (
          <div style={{ fontSize: 17, color: "var(--k-n-600)" }}>
            <Loader2 size={16} className="inline" style={{ marginRight: 8, verticalAlign: -2 }} />
            {t.searching}
          </div>
        )}

        {known?.found && identity === "unknown" && (
          <div className="k-fade" style={{ background: "var(--k-accent-100)", borderLeft: "6px solid var(--k-accent)", padding: "14px 18px" }}>
            <div style={{ fontSize: 17, color: "var(--k-accent-900)" }}>
              <IdCard size={18} style={{ display: "inline", marginRight: 8, verticalAlign: -4 }} />
              {t.cardFound}: <strong style={HEAD}>{known.masked_name}</strong>
              {known.mrn_tail && <span style={{ marginLeft: 8, fontFamily: "monospace" }}>…{known.mrn_tail}</span>}
              <span style={{ marginLeft: 14, color: "var(--k-n-700)" }}>{t.isThisYou}</span>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button
                onClick={onConfirmIdentity}
                disabled={confirming}
                className="k-press"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  height: 48,
                  padding: "0 22px",
                  ...HEAD,
                  fontSize: 18,
                  background: "var(--k-green-600)",
                  color: "#fff",
                }}
              >
                {confirming ? <Loader2 size={18} className="animate-spin" /> : <UserCheck size={18} />}
                {t.yesItsMe}
              </button>
              <button
                onClick={onDeclineIdentity}
                className="k-press"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  height: 48,
                  padding: "0 22px",
                  ...HEAD,
                  fontSize: 18,
                  border: "2px solid var(--k-divider)",
                }}
              >
                <UserX size={18} />
                {t.no}
              </button>
            </div>
          </div>
        )}

        {identity === "confirmed" && (
          <div
            className="k-fade"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "var(--k-green-100)",
              borderLeft: "6px solid var(--k-green-600)",
              padding: "14px 18px",
              fontSize: 17,
              color: "var(--k-green-900)",
            }}
          >
            <span>
              <HeartPulse size={18} style={{ display: "inline", marginRight: 8, verticalAlign: -4 }} />
              {t.willAddToCard}
            </span>
            <button onClick={onDeclineIdentity} style={{ fontSize: 15, textDecoration: "underline", color: "var(--k-green-800)" }}>
              {t.notMe}
            </button>
          </div>
        )}
      </div>

      {/* To'lov turi — kassada naqd yoki telefondan QR orqali */}
      <div style={{ flex: "none", padding: "6px 32px 16px" }}>
        <div
          style={{
            fontSize: 14,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--k-n-700)",
            marginBottom: 8,
          }}
        >
          {t.payment}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, background: "var(--k-divider)", border: "2px solid var(--k-divider)" }}>
          {([
            { id: "cash" as const, Icon: Banknote, label: t.payCash, hint: t.payCashHint },
            { id: "qr" as const, Icon: QrCode, label: t.payQr, hint: t.payQrHint },
          ]).map((o) => {
            const on = pay === o.id;
            return (
              <button
                key={o.id}
                onClick={() => onPay(o.id)}
                className="k-press"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 20px",
                  background: on ? "var(--k-accent)" : "var(--k-bg)",
                  color: on ? "var(--k-bg)" : "var(--k-text)",
                }}
              >
                <o.Icon size={26} strokeWidth={1.7} />
                <div style={{ flex: 1 }}>
                  <div style={{ ...HEAD, fontSize: 19 }}>{o.label}</div>
                  <div style={{ fontSize: 14, opacity: on ? 0.85 : 0.6, marginTop: 1 }}>{o.hint}</div>
                  {o.id === "qr" && (
                    <div style={{ marginTop: 6 }}>
                      <PayBrands size="sm" />
                    </div>
                  )}
                </div>
                {on && <Check size={22} strokeWidth={3} />}
              </button>
            );
          })}
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

/* ── 5-qadam: tasdiqlash ── */
export function StepConfirm({
  t,
  rows,
  total,
  pay,
}: {
  t: KioskT;
  rows: { k: string; v: string }[];
  total: number;
  pay: KioskPayMethod;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 440px", gap: 2, background: "var(--k-divider)" }}>
      <div style={{ background: "var(--k-bg)", overflowY: "auto", padding: "24px 32px" }}>
        <div style={{ ...KICKER, color: "var(--k-accent)" }}>{t.step5}</div>
        <h2 style={{ ...HEAD, fontSize: 32, margin: "8px 0 20px" }}>{t.checkData}</h2>
        <SummaryList>
          {rows.map((r) => (
            <SummaryRow key={r.k} k={r.k} v={r.v} />
          ))}
        </SummaryList>
      </div>
      <div
        style={{
          background: "var(--k-accent)",
          color: "var(--k-bg)",
          padding: 32,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 14, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.85 }}>{t.total}</div>
          <div style={{ ...HEAD, fontSize: 52, lineHeight: 1, letterSpacing: "-0.03em", marginTop: 10 }}>{fmtSum(total)}</div>
          <div style={{ height: 2, background: "rgba(255,255,255,.4)", margin: "22px 0" }} />
          <div style={{ fontSize: 18, opacity: 0.9, textWrap: "pretty" }}>
            {pay === "qr" ? t.payNoteQr : t.payNote}
          </div>
        </div>
        <div style={{ fontSize: 17, opacity: 0.9, textWrap: "pretty" }}>{t.confirmNote}</div>
      </div>
    </div>
  );
}
