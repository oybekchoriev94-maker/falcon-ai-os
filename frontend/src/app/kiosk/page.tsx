"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api-client";
import { formatLocalPhone, toStoredPhone } from "@/lib/regions";
import { kioskApi, getKioskToken, type LookupResult } from "@/lib/kiosk-client";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  HeartPulse,
  Printer,
  ScanLine,
  Stethoscope,
  Users,
  Wallet,
} from "lucide-react";

const CLINIC_CODE = process.env.NEXT_PUBLIC_CLINIC_CODE || "talkmce-ms31nmae";
const CLINIC_NAME = "Oqtosh Klinikasi";
const CLINIC_TAGLINE = "Termiz · Oqrang";

/* ── Types ── */
interface Doctor {
  id: string;
  first_name: string;
  last_name?: string;
  specialty?: string;
  specialization?: string;
}
interface Service {
  id: string;
  name: string;
  price: number;
  category?: string | null;
  specialty?: string;
  duration_min?: number;
}
interface Slot {
  time: string;
  scheduled_at: string;
  available: boolean;
}

const SPECIALTY_LABEL: Record<string, string> = {
  ginekolog: "Ginekolog",
  laborant: "Laborant",
  urolog: "Urolog",
  uzi: "UZI mutaxassisi",
  fizioterapevt: "Fizioterapevt",
};

// Shifokor yo'nalishiga mos xizmatlarni aniqlash.
// doctor.specialization (ginekolog/uzi/urolog/laborant) va service.specialty
// (ekg/laborant/rentgen/urolog/uzi/fizioterapevt) kalitlari har xil bo'lgani
// uchun kioskda yo'nalish bo'yicha kategoriya mapping qilinadi. Bu Oqtosh
// klinikasining real xizmatlar to'plamiga mos — yangi shifokor/xizmat
// qo'shilsa mapping ham yangilanishi kerak.
const DOCTOR_SERVICE_FILTERS: Record<string, (s: Service) => boolean> = {
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

function serviceMatchesDoctor(doc: Doctor | null, s: Service): boolean {
  if (!doc) return true;
  const f = DOCTOR_SERVICE_FILTERS[doc.specialization || ""];
  if (!f) return true;
  return f(s);
}

interface AppointmentResult {
  appointment: {
    id: string;
    appointment_id: string;
    access_code: string;
    doctor_name?: string;
    service_name?: string;
    scheduled_at?: string;
    amount?: number;
  };
  payment: { access_code?: string } | { payment_url?: string };
}

function firstName(d: Doctor) {
  return `${d.first_name} ${d.last_name || ""}`.trim();
}
function doctorLabel(d: Doctor) {
  const spec = SPECIALTY_LABEL[d.specialization || ""] || d.specialization || d.specialty || "";
  return spec ? `${firstName(d)} — ${spec}` : firstName(d);
}
function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
function fmtSum(n: number) {
  return (Number(n) || 0).toLocaleString("uz-UZ") + " so'm";
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
      sub: `${d.getDate()} ${d.getMonth() < MONTHS_UZ.length ? MONTHS_UZ[d.getMonth()].slice(0, 3) : ""}`,
      isToday: i === 0,
    });
  }
  return days;
}

type Screen = "home" | "doctors" | "services" | "catalog" | "date" | "slots" | "info" | "done";

export default function KioskPage() {
  const [screen, setScreen] = useState<Screen>("home");
  const [lang, setLang] = useState<"uz" | "ru">("uz");

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [days] = useState(() => nextDays(8));
  const [day, setDay] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fName, setFName] = useState("");
  const [fPhone, setFPhone] = useState("");
  // Qurilma tokeni sozlangan bo'lsa — telefon bo'yicha kartani topamiz.
  // Token yo'q bo'lsa kiosk baribir ishlaydi (bemor ismini o'zi yozadi).
  const [known, setKnown] = useState<LookupResult | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [result, setResult] = useState<{
    access_code?: string;
    appointment_id?: string;
    doctor_name?: string;
    service_name?: string;
    scheduled_at?: string;
    amount?: number;
  } | null>(null);

  const T = (uz: string, ru: string) => (lang === "uz" ? uz : ru);

  /* ── Boshiga qaytish (avto-reset va "Boshidan" tugmasi uchun) ── */
  const resetAll = useCallback(() => {
    setScreen("home");
    setDoctor(null); setService(null); setSlot(null); setAmount(0);
    setFName(""); setFPhone(""); setKnown(null); setResult(null);
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
      if (screen === "home") return;              // bosh ekranda taymer kerak emas
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

  /* ── Telefon 9 raqamga to'lganda kartani izlaymiz.
        Faqat qurilma tokeni sozlangan bo'lsa ishlaydi — token yo'q bo'lsa
        kiosk avvalgidek ishlayveradi (bemor ismini o'zi yozadi). ── */
  useEffect(() => {
    if (fPhone.length !== 9 || !getKioskToken()) { setKnown(null); return; }
    let cancelled = false;
    setLookingUp(true);
    kioskApi
      .post<LookupResult>("/api/kiosk/lookup", { phone: `+998${fPhone}` })
      .then((r) => {
        if (cancelled) return;
        setKnown(r);
        // Karta topilsa va ism hali yozilmagan bo'lsa — maskalangan ismni
        // ko'rsatamiz, lekin inputni to'ldirmaymiz (bemor o'zi tasdiqlasin).
      })
      .catch(() => { if (!cancelled) setKnown(null); })
      .finally(() => { if (!cancelled) setLookingUp(false); });
    return () => { cancelled = true; };
  }, [fPhone]);

  async function loadDoctors() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ doctors: Doctor[] }>(
        `/api/v1/booking/public/doctors?clinic=${encodeURIComponent(CLINIC_CODE)}`
      );
      if (res.success) setDoctors(res.doctors || []);
      else setError(res.error || "Xatolik");
    } catch {
      setError("Serverga bog'lanishda xatolik");
    } finally {
      setLoading(false);
    }
  }
  async function loadServices() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ services: Service[] }>(
        `/api/v1/booking/public/services?clinic=${encodeURIComponent(CLINIC_CODE)}`
      );
      if (res.success) setServices(res.services || []);
      else setError(res.error || "Xatolik");
    } catch {
      setError("Serverga bog'lanishda xatolik");
    } finally {
      setLoading(false);
    }
  }

  async function loadSlots(doctorId: string, date: string, serviceId?: string) {
    setLoading(true);
    setError("");
    setSlot(null);
    setSlots([]);
    try {
      let url = `/api/v1/booking/public/slots?clinic=${encodeURIComponent(CLINIC_CODE)}&doctor_id=${doctorId}&date=${date}`;
      if (serviceId) url += `&service_id=${serviceId}`;
      const res = await api.get<{ slots: Slot[]; amount?: number }>(url);
      if (res.success) {
        setSlots(res.slots || []);
        setAmount(res.amount || 0);
      } else setError(res.error || "Xatolik");
    } catch {
      setError("Bo'sh vaqtlarni yuklashda xatolik");
    } finally {
      setLoading(false);
    }
  }

  async function bookNow() {
    if (!fName.trim() || fPhone.replace(/\D/g, "").length !== 9) {
      setError(T("Ism va 9 xonali telefon kiriting", "Введите имя и 9-значный телефон"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await api.post<AppointmentResult>("/api/v1/booking/public/create", {
        clinic: CLINIC_CODE,
        patient_name: fName.trim(),
        phone: toStoredPhone(fPhone),
        doctor_id: doctor?.id,
        service_id: service?.id,
        service_ids: service ? [service.id] : undefined,
        scheduled_at: slot,
        payment_method: "cashier",
        source: "walk_in",
      });
      if (res.success) {
        setResult({
          access_code: res.appointment.access_code,
          appointment_id: res.appointment.appointment_id,
          doctor_name: res.appointment.doctor_name,
          service_name: res.appointment.service_name,
          scheduled_at: res.appointment.scheduled_at,
          amount: res.appointment.amount,
        });
        setScreen("done");
        setDoctor(null);
        setService(null);
        setSlot(null);
        setFName("");
        setFPhone("");
      } else {
        setError(res.error || "Bron qilishda xatolik");
      }
    } catch {
      setError("Server bilan bog'lanishda xatolik");
    } finally {
      setLoading(false);
    }
  }

  const goDoctors = async () => {
    await loadDoctors();
    setScreen("doctors");
  };
  const goCatalog = async () => {
    await loadServices();
    setScreen("catalog");
  };
  const goSlots = async (date: string) => {
    setDay(date);
    if (doctor) await loadSlots(doctor.id, date, service?.id);
    setScreen("slots");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-indigo-950/60 to-slate-950 p-4 text-white">
      <div className="w-full max-w-6xl">
        {screen !== "home" && (
          <div className="mb-4 flex items-center justify-between">
            <button
              onClick={() => setScreen("home")}
              className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-lg font-medium hover:bg-white/20"
            >
              <ArrowLeft className="h-5 w-5" /> {T("Bosh sahifa", "Главная")}
            </button>
            <div className="flex gap-2">
              {(["uz", "ru"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold uppercase ${
                    lang === l ? "bg-white text-slate-900" : "bg-white/10 text-white/80"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}

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
                <h1 className="text-5xl font-bold tracking-tight">{CLINIC_NAME}</h1>
                <p className="mt-2 text-xl text-emerald-200/80">{CLINIC_TAGLINE}</p>
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
                    <div className="text-2xl font-semibold">{T("Qabûlga yozilish", "Запись на приём")}</div>
                    <div className="mt-1 text-slate-400">{T("Shbaqqa belgilangan vaqtni tanlang", "Выбор времени и врача")}</div>
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
                    <div className="text-2xl font-semibold">{T("Xixmatlar va narxlar", "Услуги и цены")}</div>
                    <div className="mt-1 text-slate-400">{T("Katlogue va narxlarni ko'ring", "Каталог услуг")}</div>
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
              <h2 className="mb-6 text-3xl font-semibold">{T("Mutahasis tanlang", "Выберите специалиста")}</h2>
              {loading ? (
                <Loader />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {doctors.map((d) => (
                    <button
                      key={d.id}
                      onClick={async () => {
                        setDoctor(d);
                        await loadServices();
                        setScreen("services");
                      }}
                      className="flex flex-col gap-3 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10 transition hover:bg-emerald-500/10 hover:ring-emerald-400/40"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20">
                        <Users className="h-6 w-6 text-emerald-400" />
                      </div>
                      <div className="text-xl font-semibold">{firstName(d)}</div>
                      <div className="text-emerald-300">
                        {SPECIALTY_LABEL[d.specialization || ""] || d.specialization || d.specialty || ""}
                      </div>
                      <ChevronRight className="mt-auto h-5 w-5 text-slate-500" />
                    </button>
                  ))}
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
              <h2 className="mb-2 text-3xl font-semibold">{T("Xixmat tanlang", "Выберите услугу")}</h2>
              {doctor && <p className="mb-6 text-lg text-emerald-300">👨‍⚕️ {doctorLabel(doctor)}</p>}
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
                      className={`flex items-center justify-between gap-3 rounded-2xl p-5 ring-1 transition ${
                        service?.id === s.id
                          ? "bg-emerald-500/20 ring-emerald-400/50"
                          : "bg-white/5 ring-white/10 hover:bg-white/10"
                      }`}
                    >
                      <div className="text-left">
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
                      <div className="text-right font-semibold text-emerald-300">{fmtSum(s.price)}</div>
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
                  <>
                    {doctorLabel(doctor)} · {service.name} — {fmtSum(service.price)}
                  </>
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
                {day} · {doctor?.first_name} {doctor?.last_name}
                {service ? ` · ${service.name} — ${fmtSum(amount || service.price)}` : ""}
              </p>
              {loading ? (
                <Loader />
              ) : slots.length ? (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                  {slots.map((s) =>
                    s.available ? (
                      <button
                        key={s.scheduled_at}
                        onClick={() => {
                          setSlot(s.scheduled_at);
                          setScreen("info");
                        }}
                        className="rounded-2xl bg-emerald-500/15 py-5 text-center text-xl font-semibold text-emerald-300 ring-1 ring-emerald-400/40 transition hover:bg-emerald-500 hover:text-white"
                      >
                        {s.time}
                      </button>
                    ) : (
                      <div key={s.scheduled_at} className="rounded-2xl bg-white/5 py-5 text-center text-xl font-semibold text-slate-600 ring-1 ring-white/5">
                        {s.time}
                      </div>
                    )
                  )}
                </div>
              ) : (
                <div className="rounded-2xl bg-amber-500/10 p-8 text-center text-lg text-amber-200 ring-1 ring-amber-400/30">
                  {error ? error : T("Bu kunga bo'sh vaqt yo'q", "На этот день нет свободного времени")}
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
              <div className="mx-auto max-w-md space-y-4">
                <div>
                  <label className="mb-1 block text-sm text-slate-400">{T("Ism, familiya", "Имя, фамилия")}</label>
                  <input
                    value={fName}
                    onChange={(e) => setFName(e.target.value)}
                    placeholder="Orzubek Aliyeva"
                    className="w-full rounded-2xl bg-white/10 px-4 py-3 text-lg text-white placeholder-slate-500 ring-1 ring-white/20 outline-none focus:ring-emerald-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Telefon</label>
                  <input
                    value={fPhone}
                    onChange={(e) => setFPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    placeholder="90 123 45 67"
                    inputMode="numeric"
                    className="w-full rounded-2xl bg-white/10 px-3 py-3 text-xl text-white placeholder-slate-500 ring-1 ring-white/20 outline-none focus:ring-emerald-400"
                  />
                </div>
                {fPhone.length === 9 && (
                  <div className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 ring-1 ring-emerald-400/30">
                    <CheckCircle2 className="mr-2 inline h-4 w-4" />
                    +998{formatLocalPhone(fPhone).replace(/\D/g, "")}
                  </div>
                )}

                {/* Karta topildi — takroriy bemor (qurilma tokeni sozlangan bo'lsa) */}
                {lookingUp && (
                  <div className="rounded-xl bg-white/5 px-4 py-3 text-sm text-slate-300 ring-1 ring-white/10">
                    {T("Karta izlanmoqda...", "Поиск карты...")}
                  </div>
                )}
                {known?.found && (
                  <div className="rounded-xl bg-blue-500/10 px-4 py-3 ring-1 ring-blue-400/30">
                    <p className="text-sm text-blue-200">
                      <Users className="mr-2 inline h-4 w-4" />
                      {T("Kartangiz topildi", "Ваша карта найдена")}: <strong>{known.masked_name}</strong>
                      {known.mrn_tail && <span className="ml-2 font-mono text-blue-300">...{known.mrn_tail}</span>}
                    </p>
                    <p className="mt-1 text-xs text-blue-300/70">
                      {T(
                        "Ismingizni to'liq yozing — tarixingiz shu kartaga qo'shiladi",
                        "Напишите имя полностью — история добавится в эту карту",
                      )}
                    </p>
                  </div>
                )}
                {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200 ring-1 ring-rose-400/30">{error}</div>}

                <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                  <h3 className="mb-3 font-semibold">{T("Yozilish", "Запись")}</h3>
                  <Row label={T("Shф", "Врач")} value={doctor ? firstName(doctor) : ""} />
                  <Row label={T("Xizmat", "Услуга")} value={service?.name || ""} />
                  <Row label={T("Kun", "Дата")} value={days.find((d) => d.key === day)?.label || day} />
                  <Row label={T("Soat", "Время")} value={slot ? fmtTime(slot) : ""} />
                  <Row label={T("Sum", "Сумма")} value={fmtSum(amount || service?.price || 0)} highlight />
                </div>

                <button
                  onClick={bookNow}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 py-5 text-xl font-bold shadow-lg shadow-emerald-500/25 transition hover:brightness-110 disabled:opacity-50"
                >
                  {loading ? "..." : T("Yozilish", "Записаться")}
                </button>
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
                    <ScanLine className="h-4 w-4" /> {T("Kodia kasaga ayting yoki gваллёга сӱоли", "Назовите код на кассе")}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/5 p-6 text-left ring-1 ring-white/10">
                  <Row label={T("Shфок", "Врач")} value={result.doctor_name || ""} />
                  <Row label={T("Xizmat", "Услуга")} value={result.service_name || ""} />
                  {result.scheduled_at && (
                    <Row label={T("Vaqt", "Время")} value={new Date(result.scheduled_at).toLocaleString("uz-UZ")} />
                  )}
                  {result.amount != null && <Row label={T("Сумма", "Сумма")} value={fmtSum(result.amount)} highlight />}
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
                      <div className="text-right font-semibold text-emerald-300">{fmtSum(s.price)}</div>
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