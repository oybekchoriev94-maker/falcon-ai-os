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
  KioskApiError,
  fmtSum,
  fmtDateTime,
  type KioskDepartment,
  type KioskService,
  type KioskSlot,
  type LookupResult,
  type BookResult,
  type QueueItem,
  type KioskPayMethod,
  type KioskWard,
  type AdmissionRequestResult,
  type CheckinResult,
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
  type PickedDoctor,
} from "@/components/kiosk/booking-flow";
import { PricesScreen, DoctorsScreen, QueueScreen, TicketScreen } from "@/components/kiosk/info-screens";
import { CartScreen, type CartVisit } from "@/components/kiosk/cart-screen";
import { InpatientScreen } from "@/components/kiosk/inpatient-screen";
import { CheckinScreen } from "@/components/kiosk/checkin-screen";
import { ErrorBanner, Spinner } from "@/components/kiosk/ui";

type Screen = "idle" | "home" | "book" | "prices" | "doctors" | "queue" | "ticket" | "inpatient" | "checkin";
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

  // Savat — bir kelishda bir nechta shifokorga yozilish
  const [cart, setCart] = useState<CartVisit[]>([]);

  // Statsionar so'rovi
  const [wards, setWards] = useState<KioskWard[]>([]);
  const [wardId, setWardId] = useState<string | null>(null);
  const [admSending, setAdmSending] = useState(false);
  const [admDone, setAdmDone] = useState(false);

  // Forma
  const [name, setName] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [focus, setFocus] = useState<"name" | "phone" | null>("phone");
  const [pay, setPay] = useState<KioskPayMethod>("cash");

  // Bemor kartasi
  const [known, setKnown] = useState<LookupResult | null>(null);
  const [identity, setIdentity] = useState<Identity>("unknown");
  const [lookingUp, setLookingUp] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [ticket, setTicket] = useState<BookResult | null>(null);

  // "Men keldim" — check-in
  const [checkinCode, setCheckinCode] = useState("");
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinResult, setCheckinResult] = useState<CheckinResult | null>(null);
  const [checkinError, setCheckinError] = useState("");

  /* ── Soat ── */
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(id);
  }, []);

  /* ── Boshiga qaytish ── */
  const resetAll = useCallback(() => {
    setScreen("idle");
    setStep(1);
    setService(null); setDoctor(null); setSlots([]); setCart([]);
    setName(""); setPhoneDigits(""); setFocus("phone"); setPay("cash");
    setKnown(null); setIdentity("unknown");
    setTicket(null); setError(""); setCat(null);
    setWardId(null); setAdmDone(false); setAdmSending(false);
    setDay(new Date().toLocaleDateString("en-CA"));
    setCheckinCode(""); setCheckinResult(null); setCheckinError(""); setCheckinLoading(false);
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
    setLoading(true); setError(""); setSlots([]);
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
    if (!cart.length) return;
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
        payment_method: pay,
        // Barcha tashriflar bitta tranzaksiyada — bittasi band bo'lsa
        // hech biri yozilmaydi.
        visits: cart.map((v) => ({
          doctor_id: v.doctor_id,
          service_id: v.service_id,
          scheduled_at: v.scheduled_at,
        })),
      });
      setTicket(r);
      setScreen("ticket");
    } catch (e) {
      const msg = e instanceof Error ? e.message : t.errGeneric;
      setError(msg);
      // Vaqt boshqa kanaldan (Telegram/qabulxona) band qilingan bo'lsa —
      // savatni tozalab, boshidan tanlashga qaytaramiz. Qaysi tashrif
      // to'qnashganini bilmaymiz, shuning uchun butun savat qayta ko'riladi.
      if (e instanceof KioskApiError && e.code === "SLOT_TAKEN") {
        setCart([]);
        setService(null); setDoctor(null); setCat(null);
        setStep(1);
      }
    } finally {
      setLoading(false);
    }
  }

  /* ── Navigatsiya ── */
  const startBooking = async () => { await loadServices(); setScreen("book"); setStep(1); };
  const goPrices = async () => { await loadServices(); setScreen("prices"); };
  const goDoctors = async () => { await loadDepartments(); setScreen("doctors"); };
  const goQueue = async () => { await loadQueue(); setScreen("queue"); };

  const goCheckin = () => {
    setCheckinCode(""); setCheckinResult(null); setCheckinError("");
    setScreen("checkin");
  };
  function checkinKey(ch: string) {
    setCheckinCode((p) => (p.length < 8 ? p + ch : p));
  }
  function checkinBackspace() {
    setCheckinCode((p) => p.slice(0, -1));
  }
  function checkinClear() {
    setCheckinCode("");
  }
  async function submitCheckin() {
    if (checkinCode.length < 4) return;
    setCheckinLoading(true); setCheckinError("");
    try {
      const r = await kioskApi.post<CheckinResult>("/api/kiosk/checkin", { access_code: checkinCode });
      setCheckinResult(r);
    } catch (e) {
      setCheckinError(e instanceof Error ? e.message : t.errGeneric);
    } finally {
      setCheckinLoading(false);
    }
  }

  const goInpatient = async () => {
    setError(""); setAdmDone(false); setWardId(null); setFocus("phone");
    setLoading(true);
    try {
      const r = await kioskApi.get<{ wards: KioskWard[] }>("/api/kiosk/wards");
      setWards(r.wards || []);
    } catch {
      setError(t.errGeneric);
    } finally {
      setLoading(false);
    }
    setScreen("inpatient");
  };

  /** Yotqizish so'rovi — koyka tayinlanmaydi, xodim hal qiladi */
  async function sendAdmissionRequest() {
    setAdmSending(true); setError("");
    try {
      let sessionId = known?.session_id;
      if (!sessionId) {
        const lk = await kioskApi.post<LookupResult>("/api/kiosk/lookup", { phone: `+998${phoneDigits}` });
        sessionId = lk.session_id;
      }
      await kioskApi.post<AdmissionRequestResult>("/api/kiosk/admission-request", {
        session_id: sessionId,
        patient_name: name.trim(),
        phone: `+998${phoneDigits}`,
        ward_id: wardId || undefined,
      });
      setAdmDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errGeneric);
    } finally {
      setAdmSending(false);
    }
  }

  const goHome = () => { setScreen("home"); setStep(1); setError(""); };

  const pickService = async (s: KioskService) => {
    setService(s); setDoctor(null);
    await loadDepartments();
    setStep(2);
  };
  const pickDoctor = async (d: PickedDoctor) => {
    setDoctor(d);
    setStep(3);
    await loadSlots(d.id, day);
  };
  const pickDay = async (k: string) => {
    setDay(k);
    if (doctor) await loadSlots(doctor.id, k);
  };

  /* ── Vaqt tanlandi -> savatga qo'shamiz ── */
  function pickSlot(iso: string) {
    if (!service || !doctor) return;
    setCart((prev) => [
      ...prev,
      {
        doctor_id: doctor.id,
        doctor_name: doctor.name,
        department: doctor.department,
        service_id: service.id,
        service_name: service.name,
        price: service.price,
        scheduled_at: iso,
      },
    ]);
    setStep(4); // savat
  }

  /** Savatdan "yana shifokor" — tanlovni tozalab 1-qadamga qaytamiz */
  function addAnother() {
    setService(null); setDoctor(null); setSlots([]);
    setCat(null);
    setStep(1);
  }

  function removeFromCart(i: number) {
    setCart((prev) => {
      const next = prev.filter((_, x) => x !== i);
      // Oxirgisi ham o'chirilsa — boshidan boshlaymiz
      if (next.length === 0) {
        setService(null); setDoctor(null); setCat(null);
        setStep(1);
      }
      return next;
    });
  }

  function back() {
    setError("");
    if (screen === "book" && step > 1) {
      // Savatdan orqaga — oxirgi tashrifni ham olib tashlaymiz, aks holda
      // bemor vaqtni qayta tanlab, ikkita bir xil yozuv hosil qiladi.
      if (step === 4) {
        setCart((prev) => prev.slice(0, -1));
       
      }
      setStep(step - 1);
      return;
    }
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
      // Savat — davom etish
      nextLabel = t.finish;
      nextEnabled = cart.length > 0;
      nextAction = () => setStep(5);
    } else if (step === 5) {
      nextLabel = t.next;
      nextEnabled = nameOk && phoneOk;
      nextAction = () => setStep(6);
      if (!nextEnabled) hint = t.fillFields;
    } else if (step === 6) {
      nextLabel = t.confirmBtn;
      nextEnabled = !loading;
      nextAction = book;
    }
  } else if (screen === "inpatient" && !admDone) {
    nextLabel = t.inpatientSend;
    nextEnabled = nameOk && phoneOk && !admSending;
    nextAction = sendAdmissionRequest;
    if (!nameOk || !phoneOk) hint = t.fillFields;
  }

  const { list: doctorList, exact } = useMemo(
    () => doctorsForService(departments, service, services),
    [departments, service, services]
  );

  const prettyPhone = phoneDigits
    ? `+998 ${[phoneDigits.slice(0, 2), phoneDigits.slice(2, 5), phoneDigits.slice(5, 7), phoneDigits.slice(7, 9)]
        .filter(Boolean)
        .join(" ")}`
    : "—";

  const cartTotal = cart.reduce((s, v) => s + (v.price || 0), 0);

  // Summa bu ro'yxatda YO'Q — u o'ng tomondagi ko'k panelda katta
  // qilib ko'rsatiladi, ikki marta takrorlash shart emas.
  const summaryRows = [
    ...cart.map((v, i) => ({
      k: cart.length > 1 ? t.visitN(i + 1) : t.service,
      v: `${v.service_name} · ${v.doctor_name} · ${fmtDateTime(v.scheduled_at)}`,
    })),
    { k: t.fName, v: name || "—" },
    { k: t.fPhone, v: prettyPhone },
    { k: t.payment, v: pay === "qr" ? t.payQr : t.payCash },
  ];

  const ticketRows = ticket
    ? [
        ...ticket.visits.map((v, i) => ({
          k: ticket.visits.length > 1 ? `${t.visitN(i + 1)} · ${v.access_code}` : t.service,
          v: `${v.service_name} · ${v.doctor_name} · ${fmtDateTime(v.scheduled_at)}`,
        })),
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
          <HomeScreen
            t={t}
            onBook={startBooking}
            onPrices={goPrices}
            onDoctors={goDoctors}
            onQueue={goQueue}
            onInpatient={goInpatient}
            onCheckin={goCheckin}
          />
        )}

        {screen === "checkin" && (
          <div className="k-fade" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <CheckinScreen
              t={t}
              code={checkinCode}
              onKey={checkinKey}
              onBackspace={checkinBackspace}
              onClear={checkinClear}
              onSubmit={submitCheckin}
              loading={checkinLoading}
              result={checkinResult}
              error={checkinError}
            />
          </div>
        )}

        {screen === "inpatient" && (
          <div className="k-fade" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {error && <ErrorBanner msg={error} />}
            <InpatientScreen
              t={t}
              lang={lang}
              wards={wards}
              loading={loading}
              wardId={wardId}
              onWard={setWardId}
              name={name}
              phone={phoneDigits}
              focus={focus}
              onFocus={setFocus}
              onKey={onKey}
              onBackspace={onBackspace}
              onClear={onClear}
              sending={admSending}
              done={admDone}
            />
          </div>
        )}

        {screen === "book" && (
          <div className="k-fade" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <StepBar step={step} labels={[t.stService, t.stDoctor, t.stTime, t.cart, t.stData, t.stConfirm]} />
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
              <CartScreen t={t} visits={cart} onAdd={addAnother} onRemove={removeFromCart} />
            )}
            {step === 5 && (
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
                pay={pay}
                onPay={setPay}
              />
            )}
            {step === 6 && <StepConfirm t={t} rows={summaryRows} total={cartTotal} pay={pay} />}
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
              payMethod={ticket.payment_method}
              paymentQr={ticket.payment_qr}
              clinicQr={qrUrl}
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
