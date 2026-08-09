"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatLocalPhone } from "@/lib/regions";
import {
  kioskApi,
  fmtSum,
  fmtTime,
  type LookupResult,
  type KioskDepartment,
  type KioskService,
  type KioskSlot,
  type BookResult,
} from "@/lib/kiosk-client";
import { useKioskPairing } from "@/lib/use-kiosk-pairing";
import { PairingScreen } from "@/components/kiosk/pairing-screen";
import { NumPad } from "@/components/kiosk/numpad";
import { StepIndicator } from "@/components/kiosk/step-indicator";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  HeartPulse,
  IdCard,
  Loader2,
  Printer,
  ScanLine,
  Stethoscope,
  UserCheck,
  UserX,
  Users,
  Wallet,
} from "lucide-react";

const CLINIC_NAME_FALLBACK = "Klinika";
const CLINIC_TAGLINE_FALLBACK = "Onlayn qabulga yozilish";

/* ── Types ── */
interface Doctor {
  id: string;
  name: string;
  department: string;
}

const SPECIALTY_LABEL: Record<string, string> = {
  ginekolog: "Ginekolog",
  laborant: "Laborant",
  urolog: "Urolog",
  uzi: "UZI mutaxassisi",
  fizioterapevt: "Fizioterapevt",
  therapy: "Terapevt",
  Boshqa: "Boshqa mutaxassislar",
};
function deptLabel(name: string) {
  return SPECIALTY_LABEL[name] || name;
}

// Shifokor yo'nalishiga mos xizmatlarni aniqlash.
// doctor.department (ginekolog/uzi/urolog/laborant) va service.specialty/category
// kalitlari har xil bo'lgani uchun yo'nalish bo'yicha mapping qilinadi. Bu Oqtosh
// klinikasining real xizmatlar to'plamiga mos — yangi shifokor/xizmat qo'shilsa
// mapping ham yangilanishi kerak.
const DOCTOR_SERVICE_FILTERS: Record<string, (s: KioskService) => boolean> = {
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
  laborant: (s) => (s.category || "").startsWith("Laboratoriya"),
  fizioterapevt: (s) => s.category === "Fizioterapiya",
  ekg: (s) => s.category === "Diagnostika",
  rentgen: (s) => (s.category || "").startsWith("Rentgen"),
};

function serviceMatchesDoctor(doc: Doctor | null, s: KioskService): boolean {
  if (!doc) return true;
  const f = DOCTOR_SERVICE_FILTERS[doc.department];
  if (!f) return true;
  return f(s);
}

const WEEKDAYS_UZ = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
const MONTHS_UZ = [
  "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
  "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr",
];

function nextDays(count = 8) {
  const days: { key: string; label: string; sub: string; isToday: boolean }[] = [];
  const base = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const key = d.toLocaleDateString("en-CA"); // YYYY-MM-DD local
    days.push({
      key,
      label: WEEKDAYS_UZ[d.getDay()],
      sub: `${d.getDate()} ${MONTHS_UZ[d.getMonth()]?.slice(0, 3) || ""}`,
      isToday: i === 0,
    });
  }
  return days;
}

type Screen = "home" | "doctors" | "services" | "date" | "slots" | "info" | "done" | "catalog";
type Identity = "unknown" | "confirmed" | "manual";

const BOOKING_STEPS: Screen[] = ["doctors", "services", "date", "slots", "info"];

export default function KioskPage() {
  const { status, config, pairing, error: pairError, pair } = useKioskPairing();

  if (status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
      </div>
    );
  }
  if (status === "unpaired") {
    return <PairingScreen onSubmit={pair} error={pairError} loading={pairing} />;
  }
  return <KioskBooking clinicName={config?.clinic.name} />;
}

function KioskBooking({ clinicName }: { clinicName?: string }) {
  const [screen, setScreen] = useState<Screen>("home");
  const [lang, setLang] = useState<"uz" | "ru">("uz");

  const [departments, setDepartments] = useState<KioskDepartment[]>([]);
  const [services, setServices] = useState<KioskService[]>([]);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [service, setService] = useState<KioskService | null>(null);
  const [days] = useState(() => nextDays(8));
  const [day, setDay] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [slots, setSlots] = useState<KioskSlot[]>([]);
  const [slot, setSlot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fName, setFName] = useState("");
  const [fPhone, setFPhone] = useState("");

  // Bemor kartasi topilganda identifikatsiya oqimi:
  // "unknown" — hali so'ralmagan, "confirmed" — "Ha, bu men" bosilgan
  // (ism DB'dan olindi va qulflandi), "manual" — o'zi yozadi.
  const [known, setKnown] = useState<LookupResult | null>(null);
  const [identity, setIdentity] = useState<Identity>("unknown");
  const [lookingUp, setLookingUp] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [result, setResult] = useState<{
    access_code?: string;
    doctor_name?: string;
    service_name?: string;
    scheduled_at?: string;
    amount?: number;
  } | null>(null);

  const T = (uz: string, ru: string) => (lang === "uz" ? uz : ru);

  /* ── Boshiga qaytish (avto-reset va "Boshidan" tugmasi uchun) ── */
  const resetAll = useCallback(() => {
    setScreen("home");
    setDoctor(null); setService(null); setSlot(null);
    setFName(""); setFPhone(""); setKnown(null); setIdentity("unknown");
    setResult(null);
    setError(""); setLoading(false);
    setDay(new Date().toLocaleDateString("en-CA"));
  }, []);

  /* ── Harakatsizlik taymeri: 90s tegilmasa boshiga qaytadi.
        Bemor yarim yo'lda ketib qolsa, keyingi odam toza ekran ko'radi
        (va oldingi bemor ma'lumoti ekranda qolmaydi — PII himoyasi). ── */
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const bump = () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      if (screen === "home") return;
      idleRef.current = setTimeout(resetAll, 90_000);
    };
    bump();
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown"];
    events.forEach((e) => window.addEventListener(e, bump));
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      if (idleRef.current) clearTimeout(idleRef.current);
    };
  }, [screen, resetAll]);

  /* ── Telefon 9 raqamga to'lganda kartani izlaymiz (qurilma tokeni orqali). ── */
  useEffect(() => {
    setIdentity("unknown");
    if (fPhone.length !== 9) { setKnown(null); return; }
    let cancelled = false;
    setLookingUp(true);
    kioskApi
      .post<LookupResult>("/api/kiosk/lookup", { phone: `+998${fPhone}` })
      .then((r) => {
        if (cancelled) return;
        setKnown(r);
        if (!r.found) setIdentity("manual");
      })
      .catch(() => { if (!cancelled) { setKnown(null); setIdentity("manual"); } })
      .finally(() => { if (!cancelled) setLookingUp(false); });
    return () => { cancelled = true; };
  }, [fPhone]);

  async function confirmIdentity() {
    if (!known?.found) return;
    setConfirming(true);
    setError("");
    try {
      const res = await kioskApi.post<{ patient: { full_name: string } }>("/api/kiosk/confirm", {
        session_id: known.session_id,
        confirm_token: known.confirm_token,
      });
      setFName(res.patient.full_name);
      setIdentity("confirmed");
    } catch {
      setError(T("Tasdiqlashda xatolik. Ismingizni o'zingiz yozing", "Ошибка подтверждения. Введите имя вручную"));
      setIdentity("manual");
    } finally {
      setConfirming(false);
    }
  }
  function declineIdentity() {
    setIdentity("manual");
    setFName("");
  }

  async function loadDepartments() {
    setLoading(true);
    setError("");
    try {
      const res = await kioskApi.get<{ departments: KioskDepartment[] }>("/api/kiosk/departments");
      setDepartments(res.departments || []);
    } catch {
      setError(T("Shifokorlar ro'yxatini yuklashda xatolik", "Ошибка загрузки списка врачей"));
    } finally {
      setLoading(false);
    }
  }
  async function loadServices() {
    if (services.length) return;
    setLoading(true);
    setError("");
    try {
      const res = await kioskApi.get<{ services: KioskService[] }>("/api/kiosk/services");
      setServices(res.services || []);
    } catch {
      setError(T("Xizmatlar ro'yxatini yuklashda xatolik", "Ошибка загрузки списка услуг"));
    } finally {
      setLoading(false);
    }
  }
  async function loadSlots(doctorId: string, date: string) {
    setLoading(true);
    setError("");
    setSlot(null);
    setSlots([]);
    try {
      const res = await kioskApi.get<{ slots: KioskSlot[] }>(
        `/api/kiosk/slots?doctor_id=${doctorId}&date=${date}`
      );
      setSlots(res.slots || []);
    } catch {
      setError(T("Bo'sh vaqtlarni yuklashda xatolik", "Ошибка загрузки времени"));
    } finally {
      setLoading(false);
    }
  }

  async function bookNow() {
    const phoneDigits = fPhone.replace(/\D/g, "");
    if (!fName.trim() || phoneDigits.length !== 9) {
      setError(T("Ism va 9 xonali telefon kiriting", "Введите имя и 9-значный телефон"));
      return;
    }
    if (!doctor || !service || !slot) {
      setError(T("Ma'lumot to'liq emas, boshidan boshlang", "Недостаточно данных, начните заново"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const phone = `+998${phoneDigits}`;
      let sessionId = known?.session_id;
      if (!sessionId) {
        const lk = await kioskApi.post<LookupResult>("/api/kiosk/lookup", { phone });
        sessionId = lk.session_id;
      }
      const res = await kioskApi.post<BookResult>("/api/kiosk/book", {
        session_id: sessionId,
        patient_name: fName.trim(),
        phone,
        doctor_id: doctor.id,
        service_id: service.id,
        scheduled_at: slot,
      });
      setResult({
        access_code: res.access_code,
        doctor_name: res.doctor_name,
        service_name: res.service_name,
        scheduled_at: res.scheduled_at,
        amount: res.amount,
      });
      setScreen("done");
      setDoctor(null); setService(null); setSlot(null);
      setFName(""); setFPhone(""); setKnown(null); setIdentity("unknown");
    } catch (e) {
      setError(e instanceof Error ? e.message : T("Server bilan bog'lanishda xatolik", "Ошибка соединения"));
    } finally {
      setLoading(false);
    }
  }

  const goDoctors = async () => {
    await loadDepartments();
    setScreen("doctors");
  };
  const goCatalog = async () => {
    await loadServices();
    setScreen("catalog");
  };
  const pickDoctor = async (d: Doctor) => {
    setDoctor(d);
    await loadServices();
    setScreen("services");
  };
  const goSlots = async (date: string) => {
    setDay(date);
    if (doctor) await loadSlots(doctor.id, date);
    setScreen("slots");
  };

  const stepIndex = BOOKING_STEPS.indexOf(screen);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-indigo-950/60 to-slate-950 p-4 text-white">
      <div className="w-full max-w-6xl">
        {screen !== "home" && (
          <div className="mb-4 flex items-center justify-between">
            <button
              onClick={() => setScreen("home")}
              className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-lg font-medium transition hover:bg-white/20"
            >
              <ArrowLeft className="h-5 w-5" /> {T("Bosh sahifa", "Главная")}
            </button>
            <div className="flex gap-2">
              {(["uz", "ru"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold uppercase transition ${
                    lang === l ? "bg-white text-slate-900" : "bg-white/10 text-white/80"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}

        {stepIndex >= 0 && <StepIndicator step={stepIndex} total={BOOKING_STEPS.length} />}

        <AnimatePresence mode="wait">
          {screen === "home" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {/* Hero */}
              <div className="mb-10 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-500/20">
                  <HeartPulse className="h-9 w-9 text-white" />
                </div>
                <h1 className="text-5xl font-bold tracking-tight">{clinicName || CLINIC_NAME_FALLBACK}</h1>
                <p className="mt-2 text-xl text-emerald-200/80">{CLINIC_TAGLINE_FALLBACK}</p>
                <Clock className="mx-auto mt-4 h-6 w-6 text-slate-400" />
                <p className="mt-1 text-lg text-slate-300">
                  {new Date().toLocaleDateString("uz-UZ", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <button
                  onClick={goDoctors}
                  className="group flex flex-col items-center gap-4 rounded-3xl bg-white/5 p-8 text-center shadow-xl ring-1 ring-white/10 backdrop-blur transition hover:bg-white/10 hover:ring-emerald-400/40"
                >
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-400/30">
                    <Stethoscope className="h-10 w-10 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{T("Qabulga yozilish", "Запись на приём")}</div>
                    <div className="mt-1 text-slate-400">{T("Shifokor va vaqtni tanlang", "Выбор врача и времени")}</div>
                  </div>
                  <ChevronRight className="h-6 w-6 text-emerald-400 transition group-hover:translate-x-1" />
                </button>

                <button
                  onClick={goCatalog}
                  className="group flex flex-col items-center gap-4 rounded-3xl bg-white/5 p-8 text-center shadow-xl ring-1 ring-white/10 backdrop-blur transition hover:bg-white/10 hover:ring-cyan-400/40"
                >
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-cyan-500/20 ring-1 ring-cyan-400/30">
                    <Wallet className="h-10 w-10 text-cyan-400" />
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{T("Xizmatlar va narxlar", "Услуги и цены")}</div>
                    <div className="mt-1 text-slate-400">{T("Katalog va narxlarni ko'ring", "Каталог услуг")}</div>
                  </div>
                  <ChevronRight className="h-6 w-6 text-cyan-400 transition group-hover:translate-x-1" />
                </button>
              </div>
            </motion.div>
          )}

          {screen === "doctors" && (
            <motion.div
              key="doctors"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <h2 className="mb-6 text-3xl font-semibold">{T("Mutaxassis tanlang", "Выберите специалиста")}</h2>
              {loading ? (
                <Loader />
              ) : (
                <div className="max-h-[70vh] space-y-8 overflow-y-auto pr-2">
                  {departments.map((dept) => (
                    <div key={dept.name}>
                      <h3 className="mb-3 text-lg font-semibold text-emerald-300">{deptLabel(dept.name)}</h3>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {dept.doctors.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => pickDoctor({ id: d.id, name: d.name, department: dept.name })}
                            className="flex flex-col gap-3 rounded-2xl bg-white/5 p-6 text-left ring-1 ring-white/10 transition hover:bg-emerald-500/10 hover:ring-emerald-400/40"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20">
                                <Users className="h-6 w-6 text-emerald-400" />
                              </div>
                              {d.today_booked > 0 && (
                                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-slate-300">
                                  {T(`Bugun ${d.today_booked} bemor`, `Сегодня ${d.today_booked}`)}
                                </span>
                              )}
                            </div>
                            <div className="text-xl font-semibold">{d.name}</div>
                            <ChevronRight className="mt-auto h-5 w-5 text-slate-500" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!departments.length && <EmptyBox msg={T("Hozircha shifokorlar mavjud emas", "Пока нет доступных врачей")} />}
                </div>
              )}
              {error && <ErrorBox msg={error} />}
            </motion.div>
          )}

          {screen === "services" && (
            <motion.div
              key="services"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <h2 className="mb-2 text-3xl font-semibold">{T("Xizmat tanlang", "Выберите услугу")}</h2>
              {doctor && (
                <p className="mb-6 text-lg text-emerald-300">
                  👨‍⚕️ {doctor.name} — {deptLabel(doctor.department)}
                </p>
              )}
              {loading ? (
                <Loader />
              ) : (
                <div className="grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto pr-2 sm:grid-cols-2 lg:grid-cols-3">
                  {services.filter((s) => serviceMatchesDoctor(doctor, s)).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setService(s);
                        setScreen("date");
                      }}
                      className={`flex items-center justify-between gap-3 rounded-2xl p-5 text-left ring-1 transition ${
                        service?.id === s.id
                          ? "bg-emerald-500/20 ring-emerald-400/50"
                          : "bg-white/5 ring-white/10 hover:bg-white/10"
                      }`}
                    >
                      <div>
                        <div className="text-lg font-medium">{s.name}</div>
                        {s.category ? (
                          <div className="mt-0.5 text-xs text-cyan-300/70">{s.category}</div>
                        ) : null}
                        {s.duration_min ? (
                          <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                            <Clock className="h-3.5 w-3.5" /> {s.duration_min} {T("daqiqa", "мин")}
                          </div>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right font-semibold text-emerald-300">{fmtSum(s.price)}</div>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {screen === "date" && (
            <motion.div
              key="date"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <h2 className="mb-2 text-3xl font-semibold">{T("Kun tanlang", "Выберите дату")}</h2>
              <p className="mb-6 text-slate-400">
                {doctor && service && (
                  <>{doctor.name} · {service.name} — {fmtSum(service.price)}</>
                )}
              </p>
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
                {days.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => goSlots(d.key)}
                    className={`rounded-2xl p-4 text-center ring-1 transition ${
                      day === d.key ? "bg-emerald-500 text-white ring-emerald-400" : "bg-white/5 ring-white/10 hover:bg-white/10"
                    }`}
                  >
                    <div className="text-sm opacity-80">{d.label}</div>
                    <div className="text-2xl font-bold">{d.sub}</div>
                    {d.isToday && <div className="mt-1 text-xs font-semibold">{T("Bugun", "Сегодня")}</div>}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {screen === "slots" && (
            <motion.div
              key="slots"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <h2 className="mb-2 text-3xl font-semibold">{T("Vaqt tanlang", "Выберите время")}</h2>
              <p className="mb-6 text-slate-400">
                {days.find((d) => d.key === day)?.label} {days.find((d) => d.key === day)?.sub} · {doctor?.name}
                {service ? ` · ${service.name} — ${fmtSum(service.price)}` : ""}
              </p>
              {loading ? (
                <Loader />
              ) : slots.length ? (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                  {slots.map((s) => (
                    <button
                      key={s.iso}
                      onClick={() => {
                        setSlot(s.iso);
                        setScreen("info");
                      }}
                      className="rounded-2xl bg-emerald-500/15 py-5 text-center text-xl font-semibold text-emerald-300 ring-1 ring-emerald-400/40 transition hover:bg-emerald-500 hover:text-white"
                    >
                      {s.time}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl bg-amber-500/10 p-8 text-center text-lg text-amber-200 ring-1 ring-amber-400/30">
                  {error ? error : T("Bu kunga bo'sh vaqt yo'q. Boshqa kun tanlang", "На этот день нет свободного времени")}
                </div>
              )}
            </motion.div>
          )}

          {screen === "info" && (
            <motion.div
              key="info"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <h2 className="mb-6 text-3xl font-semibold">{T("Ismingiz va telefon", "Имя и телефон")}</h2>
              <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Telefon</label>
                    <input
                      value={fPhone ? `+998 ${formatLocalPhone(fPhone)}` : ""}
                      readOnly
                      inputMode="none"
                      placeholder="+998 90 123 45 67"
                      className="w-full rounded-2xl bg-white/10 px-4 py-3 text-xl tracking-wide text-white placeholder-slate-500 ring-1 ring-white/20 outline-none focus:ring-emerald-400"
                    />
                  </div>
                  <NumPad
                    onDigit={(d) => setFPhone((p) => (p.length < 9 ? p + d : p))}
                    onBackspace={() => setFPhone((p) => p.slice(0, -1))}
                  />
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">{T("Ism, familiya", "Имя, фамилия")}</label>
                    <input
                      value={fName}
                      onChange={(e) => setFName(e.target.value)}
                      readOnly={identity === "confirmed"}
                      placeholder="Aliyev Vali"
                      className={`w-full rounded-2xl px-4 py-3 text-lg text-white placeholder-slate-500 ring-1 outline-none focus:ring-emerald-400 ${
                        identity === "confirmed" ? "bg-blue-500/10 ring-blue-400/40" : "bg-white/10 ring-white/20"
                      }`}
                    />
                  </div>

                  {lookingUp && (
                    <div className="rounded-xl bg-white/5 px-4 py-3 text-sm text-slate-300 ring-1 ring-white/10">
                      {T("Karta izlanmoqda...", "Поиск карты...")}
                    </div>
                  )}

                  {/* Karta topildi, tasdiqlash so'ralmoqda */}
                  {known?.found && identity === "unknown" && (
                    <div className="rounded-xl bg-blue-500/10 p-4 ring-1 ring-blue-400/30">
                      <p className="text-sm text-blue-200">
                        <IdCard className="mr-2 inline h-4 w-4" />
                        {T("Kartangiz topildi", "Ваша карта найдена")}: <strong>{known.masked_name}</strong>
                        {known.mrn_tail && <span className="ml-2 font-mono text-blue-300">…{known.mrn_tail}</span>}
                      </p>
                      <p className="mt-2 text-sm text-blue-300/70">{T("Bu sizmisiz?", "Это вы?")}</p>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={confirmIdentity}
                          disabled={confirming}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                        >
                          {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                          {T("Ha, bu men", "Да, это я")}
                        </button>
                        <button
                          onClick={declineIdentity}
                          disabled={confirming}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 py-2.5 font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/20"
                        >
                          <UserX className="h-4 w-4" />
                          {T("Yo'q", "Нет")}
                        </button>
                      </div>
                    </div>
                  )}

                  {identity === "confirmed" && (
                    <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 ring-1 ring-emerald-400/30">
                      <span><CheckCircle2 className="mr-2 inline h-4 w-4" />{T("Kartangizga qo'shiladi", "Будет добавлено в вашу карту")}</span>
                      <button onClick={declineIdentity} className="text-xs text-emerald-300 underline">
                        {T("Bu men emasman", "Это не я")}
                      </button>
                    </div>
                  )}

                  {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200 ring-1 ring-rose-400/30">{error}</div>}

                  <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                    <h3 className="mb-3 font-semibold">{T("Yozilish", "Запись")}</h3>
                    <Row label={T("Shifokor", "Врач")} value={doctor?.name || ""} />
                    <Row label={T("Xizmat", "Услуга")} value={service?.name || ""} />
                    <Row label={T("Kun", "Дата")} value={days.find((d) => d.key === day)?.label || day} />
                    <Row label={T("Soat", "Время")} value={slot ? fmtTime(slot) : ""} />
                    <Row label={T("Summa", "Сумма")} value={fmtSum(service?.price || 0)} highlight />
                  </div>

                  <button
                    onClick={bookNow}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 py-5 text-xl font-bold shadow-lg shadow-emerald-500/25 transition hover:brightness-110 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : T("Yozilish", "Записаться")}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {screen === "done" && result && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mx-auto max-w-lg text-center"
            >
              <motion.div
                className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/20 ring-2 ring-emerald-400/50"
                initial={{ scale: 0.5 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 12 }}
              >
                <CheckCircle2 className="h-12 w-12 text-emerald-400" />
              </motion.div>
              <h2 className="mt-6 text-3xl font-bold">{T("Muvaffaqiyatli!", "Успешно!")}</h2>
              <p className="mt-2 text-slate-300">{T("Sizning navbatingiz qayd etildi", "Ваша запись оформлена")}</p>

              <div className="mt-8 space-y-4">
                <div className="rounded-2xl bg-emerald-500/10 p-6 ring-1 ring-emerald-400/30">
                  <div className="text-3xl font-black tracking-[0.35em] text-emerald-300">{result.access_code}</div>
                  <div className="mt-2 flex items-center justify-center gap-1 text-sm text-emerald-200">
                    <ScanLine className="h-4 w-4" /> {T("Kodni kassaga ayting", "Назовите код на кассе")}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/5 p-6 text-left ring-1 ring-white/10">
                  <Row label={T("Shifokor", "Врач")} value={result.doctor_name || ""} />
                  <Row label={T("Xizmat", "Услуга")} value={result.service_name || ""} />
                  {result.scheduled_at && (
                    <Row label={T("Vaqt", "Время")} value={new Date(result.scheduled_at).toLocaleString("uz-UZ")} />
                  )}
                  {result.amount != null && <Row label={T("Summa", "Сумма")} value={fmtSum(result.amount)} highlight />}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => window.print()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/10 py-4 text-lg font-semibold ring-1 ring-white/20 hover:bg-white/20"
                  >
                    <Printer className="h-5 w-5" /> {T("Chop etish", "Печать")}
                  </button>
                  <button
                    onClick={() => setScreen("home")}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-4 text-lg font-bold hover:brightness-110"
                  >
                    <ArrowRight className="h-5 w-5" /> {T("Yangi yozilish", "Запись")}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {screen === "catalog" && (
            <motion.div
              key="catalog"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <h2 className="mb-2 text-3xl font-semibold">{T("Xizmatlar va narxlar", "Услуги и цены")}</h2>
              <p className="mb-6 text-slate-400">
                {T("Hammasi bo'lib", "Всего")} {services.length} {T("xizmat", "услуг")}
              </p>
              {loading ? (
                <Loader />
              ) : (
                <div className="grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto pr-2 md:grid-cols-2">
                  {services.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 p-5 ring-1 ring-white/10"
                    >
                      <div className="text-left">
                        <div className="text-lg font-medium">{s.name}</div>
                        {s.category ? (
                          <div className="mt-1 text-xs text-cyan-300/80">{s.category}</div>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right font-semibold text-emerald-300">{fmtSum(s.price)}</div>
                    </div>
                  ))}
                </div>
              )}
              {error && <ErrorBox msg={error} />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Small components ── */
function Row({ label, value, highlight }: { label: string; value?: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-slate-400">{label}</span>
      <span className={`font-semibold ${highlight ? "text-emerald-300" : ""}`}>{value || "—"}</span>
    </div>
  );
}

function Loader() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-emerald-400" />
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200 ring-1 ring-rose-400/30">
      {msg}
    </div>
  );
}

function EmptyBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-2xl bg-white/5 py-12 text-center text-slate-400 ring-1 ring-white/10">
      {msg}
    </div>
  );
}
