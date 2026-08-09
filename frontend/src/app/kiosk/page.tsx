"use client";

// ============================================================
// Oqtosh Klinikasi — kirish kioski
//
// Dizayn: "Modernist" — o'tkir burchaklar, qalin Archivo sarlavhalar,
// 2px chiziqlar, ko'k + yashil aksent. Kiosk 1280x800 uchun
// mo'ljallangan, lekin kichikroq ekranga ham sig'adi.
//
// Ma'lumot faqat qurilma tokeni bilan himoyalangan /api/kiosk/*
// orqali olinadi — ochiq booking API ishlatilmaydi.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  kioskApi,
  fmtSum,
  fmtDateTime,
  type KioskDepartment,
  type KioskService,
  type KioskSlot,
  type LookupResult,
  type BookResult,
  type QueueItem,
} from "@/lib/kiosk-client";
import { useKioskPairing } from "@/lib/use-kiosk-pairing";
import { KIOSK_TEXT, type KioskLang } from "@/lib/kiosk-i18n";
import { PairingScreen } from "@/components/kiosk/pairing-screen";
import { KioskHeader, KioskFooter } from "@/components/kiosk/chrome";
import { Screensaver } from "@/components/kiosk/screensaver";
import { HomeScreen } from "@/components/kiosk/home-screen";
import {
  StepBar,
  StepService,
  StepDoctor,
  StepTime,
  StepData,
  StepConfirm,
  doctorsForService,
  deptLabel,
  type PickedDoctor,
} from "@/components/kiosk/booking-flow";
import { PricesScreen, DoctorsScreen, QueueScreen, TicketScreen } from "@/components/kiosk/info-screens";
import { ErrorBanner, Spinner } from "@/components/kiosk/ui";

type Screen = "idle" | "home" | "book" | "prices" | "doctors" | "queue" | "ticket";
type Identity = "unknown" | "confirmed" | "manual";

const IDLE_MS = 90_000;

const WD_UZ = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
const MON_UZ = ["Yan", "Fev", "Mar", "Apr", "May", "Iyn", "Iyl", "Avg", "Sen", "Okt", "Noy", "Dek"];

function nextDays(count = 7) {
  const base = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return {
      key: d.toLocaleDateString("en-CA"),
      wd: WD_UZ[d.getDay()],
      num: String(d.getDate()),
      mon: MON_UZ[d.getMonth()],
    };
  });
}

export default function KioskPage() {
  const { status, config, pairing, error: pairError, pair } = useKioskPairing();

  if (status === "checking") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }
  if (status === "unpaired") {
    return <PairingScreen onSubmit={pair} error={pairError} loading={pairing} />;
  }
  return (
    <Kiosk
      clinicName={config?.clinic.name || "Klinika"}
      logoUrl={config?.clinic.logo_url}
      phone={config?.clinic.phone}
      qrUrl={config?.clinic.payment_qr_url}
    />
  );
}

function Kiosk({
  clinicName,
  logoUrl,
  phone,
  qrUrl,
}: {
  clinicName: string;
  logoUrl?: string | null;
  phone?: string | null;
  qrUrl?: string | null;
}) {
  const [screen, setScreen] = useState<Screen>("idle");
  const [step, setStep] = useState(1);
  const [lang, setLang] = useState<KioskLang>("uz");
  const t = KIOSK_TEXT[lang];

  const [now, setNow] = useState(() => new Date());

  // Ma'lumotlar
  const [departments, setDepartments] = useState<KioskDepartment[]>([]);
  const [services, setServices] = useState<KioskService[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Tanlovlar
  const [cat, setCat] = useState<string | null>(null);
  const [priceCat, setPriceCat] = useState<string | null>(null);
  const [service, setService] = useState<KioskService | null>(null);
  const [doctor, setDoctor] = useState<PickedDoctor | null>(null);
  const days = useMemo(() => nextDays(7), []);
  const [day, setDay] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [slots, setSlots] = useState<KioskSlot[]>([]);
  const [slot, setSlot] = useState<string | null>(null);

  // Forma
  const [name, setName] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [focus, setFocus] = useState<"name" | "phone" | null>("phone");

  // Bemor kartasi
  const [known, setKnown] = useState<LookupResult | null>(null);
  const [identity, setIdentity] = useState<Identity>("unknown");
  const [lookingUp, setLookingUp] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [ticket, setTicket] = useState<BookResult | null>(null);

  /* ── Soat ── */
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(id);
  }, []);

  /* ── Boshiga qaytish ── */
  const resetAll = useCallback(() => {
    setScreen("idle");
    setStep(1);
    setService(null); setDoctor(null); setSlot(null); setSlots([]);
    setName(""); setPhoneDigits(""); setFocus("phone");
    setKnown(null); setIdentity("unknown");
    setTicket(null); setError(""); setCat(null);
    setDay(new Date().toLocaleDateString("en-CA"));
  }, []);

  /* ── Harakatsizlik: 90s tegilmasa ekran-saverga qaytadi.
        Oldingi bemorning ma'lumoti ekranda qolmaydi (PII himoyasi). ── */
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const bump = () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      if (screen === "idle") return;
      idleRef.current = setTimeout(resetAll, IDLE_MS);
    };
    bump();
    const evs: (keyof WindowEventMap)[] = ["pointerdown", "keydown"];
    evs.forEach((e) => window.addEventListener(e, bump));
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      if (idleRef.current) clearTimeout(idleRef.current);
    };
  }, [screen, resetAll]);

  /* ── Yuklovchilar ── */
  const loadServices = useCallback(async () => {
    if (services.length) return;
    setLoading(true); setError("");
    try {
      const r = await kioskApi.get<{ services: KioskService[] }>("/api/kiosk/services");
      setServices(r.services || []);
    } catch {
      setError(t.errGeneric);
    } finally {
      setLoading(false);
    }
  }, [services.length, t]);

  const loadDepartments = useCallback(async () => {
    if (departments.length) return;
    setLoading(true); setError("");
    try {
      const r = await kioskApi.get<{ departments: KioskDepartment[] }>("/api/kiosk/departments");
      setDepartments(r.departments || []);
    } catch {
      setError(t.errGeneric);
    } finally {
      setLoading(false);
    }
  }, [departments.length, t]);

  const loadSlots = useCallback(async (doctorId: string, date: string) => {
    setLoading(true); setError(""); setSlots([]); setSlot(null);
    try {
      const r = await kioskApi.get<{ slots: KioskSlot[] }>(`/api/kiosk/slots?doctor_id=${doctorId}&date=${date}`);
      setSlots(r.slots || []);
    } catch {
      setError(t.errGeneric);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadQueue = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await kioskApi.get<{ queue: QueueItem[] }>("/api/kiosk/queue");
      setQueue(r.queue || []);
    } catch {
      setError(t.errGeneric);
    } finally {
      setLoading(false);
    }
  }, [t]);

  /* ── Telefon to'lganda kartani izlash ── */
  useEffect(() => {
    setIdentity("unknown");
    if (phoneDigits.length !== 9) { setKnown(null); return; }
    let dead = false;
    setLookingUp(true);
    kioskApi
      .post<LookupResult>("/api/kiosk/lookup", { phone: `+998${phoneDigits}` })
      .then((r) => { if (!dead) { setKnown(r); if (!r.found) setIdentity("manual"); } })
      .catch(() => { if (!dead) { setKnown(null); setIdentity("manual"); } })
      .finally(() => { if (!dead) setLookingUp(false); });
    return () => { dead = true; };
  }, [phoneDigits]);

  async function confirmIdentity() {
    if (!known?.found) return;
    setConfirming(true); setError("");
    try {
      const r = await kioskApi.post<{ patient: { full_name: string } }>("/api/kiosk/confirm", {
        session_id: known.session_id,
        confirm_token: known.confirm_token,
      });
      setName(r.patient.full_name);
      setIdentity("confirmed");
      setFocus(null);
    } catch {
      setIdentity("manual");
      setFocus("name");
    } finally {
      setConfirming(false);
    }
  }

  function declineIdentity() {
    setIdentity("manual");
    setName("");
    setFocus("name");
  }

  /* ── Klaviatura ── */
  function onKey(ch: string) {
    if (focus === "phone") setPhoneDigits((p) => (p.length < 9 ? p + ch.replace(/\D/g, "") : p));
    else if (focus === "name") setName((p) => (p.length < 60 ? p + (p ? ch.toLowerCase() : ch) : p));
  }
  function onBackspace() {
    if (focus === "phone") setPhoneDigits((p) => p.slice(0, -1));
    else if (focus === "name") setName((p) => p.slice(0, -1));
  }
  function onClear() {
    if (focus === "phone") setPhoneDigits("");
    else if (focus === "name") setName("");
  }

  /* ── Bron yaratish ── */
  async function book() {
    if (!service || !doctor || !slot) return;
    setLoading(true); setError("");
    try {
      let sessionId = known?.session_id;
      if (!sessionId) {
        const lk = await kioskApi.post<LookupResult>("/api/kiosk/lookup", { phone: `+998${phoneDigits}` });
        sessionId = lk.session_id;
      }
      const r = await kioskApi.post<BookResult>("/api/kiosk/book", {
        session_id: sessionId,
        patient_name: name.trim(),
        phone: `+998${phoneDigits}`,
        doctor_id: doctor.id,
        service_id: service.id,
        scheduled_at: slot,
      });
      setTicket(r);
      setScreen("ticket");
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errGeneric);
    } finally {
      setLoading(false);
    }
  }

  /* ── Navigatsiya ── */
  const startBooking = async () => { await loadServices(); setScreen("book"); setStep(1); };
  const goPrices = async () => { await loadServices(); setScreen("prices"); };
  const goDoctors = async () => { await loadDepartments(); setScreen("doctors"); };
  const goQueue = async () => { await loadQueue(); setScreen("queue"); };
  const goHome = () => { setScreen("home"); setStep(1); setError(""); };

  const pickService = async (s: KioskService) => {
    setService(s); setDoctor(null); setSlot(null);
    await loadDepartments();
    setStep(2);
  };
  const pickDoctor = async (d: PickedDoctor) => {
    setDoctor(d); setSlot(null);
    setStep(3);
    await loadSlots(d.id, day);
  };
  const pickDay = async (k: string) => {
    setDay(k);
    if (doctor) await loadSlots(doctor.id, k);
  };
  const pickSlot = (iso: string) => { setSlot(iso); setStep(4); };

  function back() {
    setError("");
    if (screen === "book" && step > 1) { setStep(step - 1); return; }
    goHome();
  }

  /* ── Pastki panel holati ── */
  const nameOk = name.trim().length >= 2;
  const phoneOk = phoneDigits.length === 9;

  let nextLabel: string | undefined;
  let nextEnabled = false;
  let nextAction: (() => void) | undefined;
  let hint: string | undefined;

  if (screen === "book") {
    if (step === 4) {
      nextLabel = t.next;
      nextEnabled = nameOk && phoneOk;
      nextAction = () => setStep(5);
      if (!nextEnabled) hint = t.fillFields;
    } else if (step === 5) {
      nextLabel = t.confirmBtn;
      nextEnabled = !loading;
      nextAction = book;
    }
  }

  const { list: doctorList, exact } = useMemo(
    () => doctorsForService(departments, service, services),
    [departments, service, services]
  );

  const slotTime = slot
    ? new Date(slot).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })
    : "";
  const dayLabel = days.find((d) => d.key === day);

  const summaryRows = [
    { k: t.service, v: service?.name || "—" },
    { k: t.doctor, v: doctor ? `${doctor.name} — ${deptLabel(doctor.department)}` : "—" },
    { k: t.stTime, v: dayLabel ? `${dayLabel.num} ${dayLabel.mon}, ${slotTime}` : slotTime },
    { k: t.fName, v: name || "—" },
    { k: t.fPhone, v: phoneDigits ? `+998 ${phoneDigits}` : "—" },
    { k: t.total, v: fmtSum(service?.price || 0) },
  ];

  const ticketRows = ticket
    ? [
        { k: t.service, v: ticket.service_name },
        { k: t.doctor, v: ticket.doctor_name },
        { k: t.stTime, v: fmtDateTime(ticket.scheduled_at) },
        { k: t.total, v: fmtSum(ticket.amount) },
      ]
    : [];

  const showChrome = screen !== "idle";

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        height: "100vh",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {screen === "idle" && (
        <Screensaver t={t} clinicName={clinicName} logoUrl={logoUrl} onStart={goHome} />
      )}

      {showChrome && (
        <KioskHeader
          clinicName={clinicName}
          logoUrl={logoUrl}
          phone={phone}
          now={now}
          lang={lang}
          onLang={setLang}
          onHome={goHome}
        />
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {screen === "home" && (
          <HomeScreen t={t} onBook={startBooking} onPrices={goPrices} onDoctors={goDoctors} onQueue={goQueue} />
        )}

        {screen === "book" && (
          <div className="k-fade" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <StepBar step={step} labels={[t.stService, t.stDoctor, t.stTime, t.stData, t.stConfirm]} />
            {error && <ErrorBanner msg={error} />}

            {step === 1 && (
              <StepService t={t} services={services} loading={loading} activeCat={cat} onCat={setCat} onPick={pickService} />
            )}
            {step === 2 && (
              <StepDoctor t={t} doctors={doctorList} exact={exact} serviceName={service?.name} onPick={pickDoctor} />
            )}
            {step === 3 && (
              <StepTime
                t={t}
                days={days}
                day={day}
                onDay={pickDay}
                slots={slots}
                loading={loading}
                doctorName={doctor?.name}
                onPick={pickSlot}
              />
            )}
            {step === 4 && (
              <StepData
                t={t}
                lang={lang}
                name={name}
                phone={phoneDigits}
                focus={focus}
                onFocus={setFocus}
                onKey={onKey}
                onBackspace={onBackspace}
                onClear={onClear}
                known={known}
                identity={identity}
                lookingUp={lookingUp}
                confirming={confirming}
                onConfirmIdentity={confirmIdentity}
                onDeclineIdentity={declineIdentity}
              />
            )}
            {step === 5 && <StepConfirm t={t} rows={summaryRows} total={service?.price || 0} />}
          </div>
        )}

        {screen === "prices" && (
          <div className="k-fade" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PricesScreen t={t} services={services} loading={loading} activeCat={priceCat} onCat={setPriceCat} />
          </div>
        )}

        {screen === "doctors" && (
          <div className="k-fade" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <DoctorsScreen t={t} departments={departments} loading={loading} />
          </div>
        )}

        {screen === "queue" && (
          <div className="k-fade" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <QueueScreen t={t} queue={queue} loading={loading} />
          </div>
        )}

        {screen === "ticket" && ticket && (
          <div className="k-fade" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <TicketScreen
              t={t}
              rows={ticketRows}
              code={ticket.access_code}
              qrUrl={qrUrl}
              onNew={resetAll}
            />
          </div>
        )}
      </div>

      {showChrome && screen !== "ticket" && (
        <KioskFooter
          canBack={screen !== "home"}
          onBack={back}
          onHome={goHome}
          hint={hint}
          nextLabel={nextLabel}
          nextEnabled={nextEnabled}
          onNext={nextAction}
          labels={{ back: t.back, home: t.home }}
        />
      )}
    </div>
  );
}
