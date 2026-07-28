"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Mic,
  Square,
  Loader2,
  CheckCircle2,
  Banknote,
  CreditCard,
  RotateCcw,
  Printer,
  ChevronLeft,
  Search,
  X,
  Plus,
  Check,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SURXONDARYO_DISTRICTS, DEFAULT_REGION, toStoredPhone, toLocalPhone, formatLocalPhone } from "@/lib/regions";

/* ── Types ── */
interface Doctor {
  id: string; first_name: string; last_name?: string;
  specialty?: string; specialization?: string;
}
interface Service {
  id: string; name: string; price: number;
  icon?: string; category?: string | null; duration_min?: number;
}
interface Slot { time: string; scheduled_at: string; available: boolean }
interface Extraction {
  patient_name?: string; phone?: string; doctor_specialty?: string;
  district?: string; mahalla?: string;
  doctor_id?: string | null; doctor_name?: string;
  service_ids?: string[]; service_names?: string[];
  preferred_time?: string; notes?: string;
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const itemAnim = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };
const fmtSum = (n: number) => (Number(n) || 0).toLocaleString("uz-UZ") + " so'm";
const todayStr = () => new Date().toISOString().slice(0, 10);
const docName = (d: Doctor) => `${d.first_name} ${d.last_name || ""}`.trim();
const initials = (d: Doctor) =>
  `${d.first_name?.[0] || ""}${d.last_name?.[0] || ""}`.toUpperCase() || "?";

/** Bo'lim nomidan qisqa sarlavha: "Laboratoriya · Gormonlar" -> "Gormonlar" */
const shortCat = (c: string) => (c.includes("·") ? c.split("·").pop()!.trim() : c);
/** Bo'limning asosiy guruhi: "Laboratoriya · Gormonlar" -> "Laboratoriya" */
const rootCat = (c: string) => (c.includes("·") ? c.split("·")[0].trim() : c);

const CAT_ICON: Record<string, string> = {
  UZI: "🔬", Laboratoriya: "🧪", Rentgen: "📷",
  Fizioterapiya: "⚡", Diagnostika: "📈", Ginekologiya: "🤰",
  Urologiya: "🩺", Konsultatsiya: "👨‍⚕️", Boshqa: "📋",
};

export default function ReceptionVoicePage() {
  const queryClient = useQueryClient();

  const [lang, setLang] = useState<"uz" | "ru">("uz");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");            // faqat 9 raqam (901234567)
  const [district, setDistrict] = useState("");
  const [mahalla, setMahalla] = useState("");
  const [doctor, setDoctor] = useState("");
  const [picked, setPicked] = useState<string[]>([]);      // tanlangan xizmatlar
  const [openCat, setOpenCat] = useState<string | null>(null); // ochilgan bo'lim
  const [svcSearch, setSvcSearch] = useState("");
  const [date, setDate] = useState(todayStr());
  const [slot, setSlot] = useState<string | null>(null);
  const [pay, setPay] = useState<"cashier" | "online">("cashier");

  const [result, setResult] = useState<{
    access_code?: string; payment_url?: string; amount: number;
    doctor_name: string; services: { name: string; price: number }[]; scheduled_at: string;
  } | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Data ── */
  const { data: docData } = useQuery({
    queryKey: ["doctors"],
    queryFn: async () => {
      const res = await api.get<{ doctors: Doctor[] }>("/api/doctors?limit=100");
      if (res.success) return res; throw new Error(res.error);
    },
  });
  const doctors = docData?.doctors ?? [];

  const { data: svcData } = useQuery({
    queryKey: ["services-active"],
    queryFn: async () => {
      const res = await api.get<{ services: Service[] }>("/api/services?active_only=true");
      if (res.success) return res; throw new Error(res.error);
    },
  });
  const services = svcData?.services ?? [];

  // Mahalla takliflari — klinikaning o'z yozuvlaridan (tuman bo'yicha)
  const { data: mahallaData } = useQuery({
    queryKey: ["mahallas", district],
    enabled: !!district,
    queryFn: async () => {
      const res = await api.get<{ mahallas: string[] }>(`/api/booking/mahallas?district=${encodeURIComponent(district)}`);
      if (res.success) return res; throw new Error(res.error);
    },
  });
  const mahallaOptions = mahallaData?.mahallas ?? [];

  const selectedDoctor = doctors.find((d) => d.id === doctor) || null;
  const pickedServices = useMemo(
    () => picked.map((id) => services.find((s) => s.id === id)).filter(Boolean) as Service[],
    [picked, services]
  );
  const total = pickedServices.reduce((s, x) => s + (x.price || 0), 0);
  const totalMin = pickedServices.reduce((s, x) => s + (x.duration_min || 30), 0);

  /* Bo'limlar: asosiy guruh bo'yicha (UZI, Laboratoriya, Rentgen...) */
  const groups = useMemo(() => {
    const m = new Map<string, Service[]>();
    for (const s of services) {
      const g = rootCat(s.category || "Boshqa");
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(s);
    }
    return [...m.entries()]
      .map(([name, items]) => ({ name, items, count: items.length }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [services]);

  /* Ochilgan bo'lim ichidagi xizmatlar — kichik bo'limlarga ajratilgan */
  const openGroupSections = useMemo(() => {
    if (!openCat) return [];
    const list = (groups.find((g) => g.name === openCat)?.items ?? []).filter((s) =>
      !svcSearch.trim() || s.name.toLowerCase().includes(svcSearch.trim().toLowerCase())
    );
    const m = new Map<string, Service[]>();
    for (const s of list) {
      const sub = shortCat(s.category || "Boshqa");
      if (!m.has(sub)) m.set(sub, []);
      m.get(sub)!.push(s);
    }
    return [...m.entries()]
      .map(([sub, items]) => ({ sub, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.sub.localeCompare(b.sub));
  }, [openCat, groups, svcSearch]);

  const { data: slotData, isFetching: slotsFetching } = useQuery({
    queryKey: ["slots", doctor, date, picked.join(",")],
    enabled: !!doctor && !!date,
    queryFn: async () => {
      let url = `/api/booking/slots?doctor_id=${doctor}&date=${date}`;
      if (picked.length) url += `&service_ids=${picked.join(",")}`;
      const res = await api.get<{ slots: Slot[]; reason?: string }>(url);
      if (res.success) return res; throw new Error(res.error);
    },
  });
  const slots = slotData?.slots ?? [];

  /* ── Voice ── */
  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
        if (blob.size > 0) voiceMutation.mutate(blob);
      };
      mr.start();
      setRecording(true); setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("Mikrofonga ruxsat berilmadi", { description: "Brauzer sozlamalaridan mikrofonni yoqing" });
    }
  }
  function stopRec() {
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const voiceMutation = useMutation({
    mutationFn: async (audio: Blob) => {
      const fd = new FormData();
      fd.append("audio", audio, "rec.webm");
      fd.append("language", lang);
      const res = await api.upload<{ transcript: string; extraction: Extraction }>("/api/reception/voice-register", fd);
      if (!res.success) throw new Error((res as { error?: string }).error || "Tushunarli emas");
      return res as unknown as { transcript: string; extraction: Extraction };
    },
    onSuccess: (res) => {
      const ex = res.extraction || {};
      setTranscript(res.transcript || "");
      const filled: string[] = [];

      if (ex.patient_name) { setName(ex.patient_name); filled.push(ex.patient_name); }
      if (ex.phone) setPhone(toLocalPhone(ex.phone));
      if (ex.district) { setDistrict(ex.district); filled.push(ex.district); }
      if (ex.mahalla) setMahalla(ex.mahalla);

      // Shifokorni backend allaqachon aniqlab beradi (klinika ro'yxatidan)
      if (ex.doctor_id && doctors.some((d) => d.id === ex.doctor_id)) {
        setDoctor(ex.doctor_id); setSlot(null);
        if (ex.doctor_name) filled.push(ex.doctor_name);
      } else if (ex.doctor_specialty) {
        const m = doctors.find((d) =>
          (d.specialty || "").toLowerCase().includes(ex.doctor_specialty!.toLowerCase()) ||
          (d.specialization || "").toLowerCase().includes(ex.doctor_specialty!.toLowerCase()));
        if (m) { setDoctor(m.id); setSlot(null); }
      }

      // Aytilgan xizmatlar — mavjudlariga qo'shamiz (takrorlanmasin)
      const ids = (ex.service_ids || []).filter((id) => services.some((s) => s.id === id));
      if (ids.length) {
        setPicked((prev) => [...new Set([...prev, ...ids])]);
        setSlot(null);
        filled.push(`${ids.length} ta xizmat`);
      }

      toast.success("Ovoz tahlil qilindi", {
        description: filled.length ? filled.join(" · ") : "Ma'lumot to'ldirildi",
      });
    },
    onError: (e: Error) => toast.error("Xatolik", { description: e.message }),
  });

  const bookMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{
        appointment: { access_code?: string; amount: number; doctor_name: string; scheduled_at: string; services?: { name: string; price: number }[] };
        payment: { payment_url?: string };
      }>("/api/booking/create", {
        patient_name: name.trim(),
        phone: toStoredPhone(phone),
        region: district ? DEFAULT_REGION : null,
        district: district || null,
        mahalla: mahalla.trim() || null,
        doctor_id: doctor, service_ids: picked,
        scheduled_at: slot, payment_method: pay, source: "reception",
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["booking-list"] });
      const a = res.appointment;
      setResult({
        access_code: a.access_code, payment_url: res.payment?.payment_url,
        amount: a.amount, doctor_name: a.doctor_name,
        services: a.services ?? pickedServices.map((s) => ({ name: s.name, price: s.price })),
        scheduled_at: a.scheduled_at,
      });
      if (pay === "online" && res.payment?.payment_url) window.open(res.payment.payment_url, "_blank");
    },
    onError: (e: Error) => {
      if (e.message?.toLowerCase().includes("band")) {
        toast.error("Bu vaqt endi band"); queryClient.invalidateQueries({ queryKey: ["slots"] });
      } else toast.error(e.message || "Xatolik");
    },
  });

  function reset() {
    setName(""); setPhone(""); setDistrict(""); setMahalla(""); setDoctor(""); setPicked([]); setOpenCat(null);
    setSvcSearch(""); setSlot(null); setDate(todayStr()); setPay("cashier");
    setTranscript(""); setResult(null);
  }
  function toggleService(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    setSlot(null);
  }
  function submit() {
    if (!name.trim()) return toast.error("Bemor ismini kiriting");
    if (!doctor) return toast.error("Shifokorni tanlang");
    if (!picked.length) return toast.error("Kamida bitta xizmat tanlang");
    if (!slot) return toast.error("Vaqtni tanlang");
    bookMutation.mutate();
  }

  const busy = voiceMutation.isPending;

  /* ── Natija ekrani ── */
  if (result) {
    return (
      <motion.div variants={container} initial="hidden" animate="show" className="mx-auto max-w-lg">
        <Card className="border-emerald-500/40">
          <CardContent className="space-y-4 p-8 text-center">
            <CheckCircle2 className="mx-auto size-14 text-emerald-500" />
            <h2 className="text-2xl font-bold">Ro&apos;yxatga olindi</h2>
            <div className="space-y-1 text-left text-sm">
              <div className="flex justify-between border-b py-1.5"><span className="text-muted-foreground">Bemor</span><span className="font-medium">{name}</span></div>
              <div className="flex justify-between border-b py-1.5"><span className="text-muted-foreground">Shifokor</span><span>{result.doctor_name}</span></div>
              <div className="flex justify-between border-b py-1.5"><span className="text-muted-foreground">Vaqt</span><span>{new Date(result.scheduled_at).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" })}</span></div>
              {result.services.map((s, i) => (
                <div key={i} className="flex justify-between border-b py-1.5">
                  <span className="text-muted-foreground">{s.name}</span><span>{fmtSum(s.price)}</span>
                </div>
              ))}
              <div className="flex justify-between py-2 text-base"><span className="font-semibold">JAMI</span><span className="font-bold text-emerald-600">{fmtSum(result.amount)}</span></div>
            </div>
            {result.access_code && (
              <div className="rounded-xl bg-muted p-4">
                <p className="text-xs text-muted-foreground">Kassa uchun kod</p>
                <p className="font-mono text-4xl font-bold tracking-widest text-primary">{result.access_code}</p>
                <p className="text-xs text-muted-foreground">Bemor kassaga shu kodni aytadi</p>
              </div>
            )}
            {result.payment_url && (
              <a href={result.payment_url} target="_blank" rel="noopener noreferrer">
                <Button className="w-full" size="lg"><CreditCard className="size-4" /> Onlayn to&apos;lov havolasi</Button>
              </a>
            )}
            <Button variant="outline" size="lg" className="w-full" onClick={reset}>
              <RotateCcw className="size-4" /> Yangi bemor
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-5">
      {/* Sarlavha */}
      <motion.div variants={itemAnim} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Mic className="size-6 text-primary" /> Ovozli qabul
          </h1>
          <p className="text-sm text-muted-foreground">Gapiring yoki qo&apos;lda to&apos;ldiring — bemorni bir necha xizmatga yozish mumkin</p>
        </div>
        {picked.length > 0 && (
          <Badge variant="outline" className="gap-1.5 border-emerald-500/30 px-3 py-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            {picked.length} ta xizmat · {fmtSum(total)}
          </Badge>
        )}
      </motion.div>

      {/* 3 ustunli keng maket */}
      <div className="grid gap-5 xl:grid-cols-[340px_1fr_320px]">
        {/* ── Chap: ovoz + bemor ── */}
        <motion.div variants={itemAnim} className="space-y-5">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-5">
              <div className="flex w-full gap-1.5">
                {(["uz", "ru"] as const).map((l) => (
                  <button key={l} onClick={() => setLang(l)}
                    className={`flex-1 rounded-md px-2 py-2 text-sm font-medium ${lang === l ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {l === "uz" ? "🇺🇿 O'zbekcha" : "🇷🇺 Ruscha"}
                  </button>
                ))}
              </div>
              <button onClick={recording ? stopRec : startRec} disabled={busy}
                className={`flex size-24 items-center justify-center rounded-full transition ${recording ? "animate-pulse bg-rose-500/20 text-rose-500" : "bg-primary/10 text-primary hover:bg-primary/20"} disabled:opacity-50`}>
                {busy ? <Loader2 className="size-10 animate-spin" /> : recording ? <Square className="size-10" /> : <Mic className="size-11" />}
              </button>
              <p className="text-center text-sm text-muted-foreground">
                {busy ? "Tahlil qilinmoqda..." : recording ? `Yozilmoqda — ${seconds}s` : "Gapirish uchun bosing"}
              </p>
              {!recording && !busy && (
                <div className="w-full rounded-lg bg-muted/60 p-2.5 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Namuna:</span> &quot;Nazokat Aliyeva,
                  Denov tumani Navbahor mahallasi, telefon <span className="font-semibold text-foreground">to&apos;qqiz
                  uch besh besh besh ikki bir nol to&apos;qqiz</span>, Musayeva Barnoga qorin UZI va
                  umumiy qon tahlili&quot;
                  <br />
                  <span className="text-amber-600 dark:text-amber-500">
                    Telefonni raqam-raqam ayting — shunda xatosiz yoziladi.
                  </span>
                </div>
              )}
              {transcript && <p className="w-full rounded-lg bg-muted p-2 text-xs">{transcript}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="space-y-1.5"><Label>Bemor ismi *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ism familiya" className="h-11 text-base" /></div>
              <div className="space-y-1.5">
                <Label>Telefon</Label>
                {/* +998 doimiy prefiks — xodim faqat 9 raqam kiritadi */}
                <div className="flex items-center gap-0 rounded-lg border border-input focus-within:border-ring">
                  <span className="select-none border-r px-3 py-2.5 text-base text-muted-foreground">+998</span>
                  <input
                    value={formatLocalPhone(phone)}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    inputMode="numeric" placeholder="90 123 45 67"
                    className="h-11 w-full bg-transparent px-3 text-base outline-none"
                  />
                </div>
                {phone.length > 0 && phone.length < 9 && (
                  <p className="text-xs text-amber-600">9 ta raqam kerak ({phone.length}/9)</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Tuman</Label>
                <select value={district} onChange={(e) => { setDistrict(e.target.value); setMahalla(""); }}
                  className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base outline-none focus:border-ring">
                  <option value="">— tanlang —</option>
                  {SURXONDARYO_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Mahalla</Label>
                <Input list="mahalla-list" value={mahalla} onChange={(e) => setMahalla(e.target.value)}
                  placeholder={district ? "Mahalla nomi" : "Avval tumanni tanlang"}
                  disabled={!district} className="h-11 text-base" />
                <datalist id="mahalla-list">
                  {mahallaOptions.map((m) => <option key={m} value={m} />)}
                </datalist>
                {mahallaOptions.length > 0 && (
                  <p className="text-xs text-muted-foreground">{mahallaOptions.length} ta oldingi mahalla taklif qilinadi</p>
                )}
              </div>
              <div className="space-y-1.5"><Label>Sana</Label>
                <Input type="date" min={todayStr()} value={date} onChange={(e) => { setDate(e.target.value); setSlot(null); }} className="h-11" /></div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── O'rta: shifokor kartochkalari + xizmat bo'limlari ── */}
        <motion.div variants={itemAnim} className="space-y-5">
          {/* Shifokorlar */}
          <div>
            <Label className="mb-2 block">Shifokor *</Label>
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {doctors.map((d) => {
                const on = doctor === d.id;
                return (
                  <button key={d.id} onClick={() => { setDoctor(d.id); setSlot(null); }}
                    className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition ${on ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
                    <span className={`flex size-11 flex-none items-center justify-center rounded-xl text-sm font-bold ${on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {initials(d)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{docName(d)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{d.specialty || d.specialization || "Shifokor"}</span>
                    </span>
                    {on && <Check className="ml-auto size-4 flex-none text-primary" />}
                  </button>
                );
              })}
              {doctors.length === 0 && <p className="text-sm text-muted-foreground">Shifokor qo&apos;shilmagan</p>}
            </div>
          </div>

          {/* Xizmatlar */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Xizmatlar * {picked.length > 0 && <span className="text-muted-foreground">({picked.length} tanlandi)</span>}</Label>
              {openCat && (
                <Button variant="ghost" size="sm" onClick={() => { setOpenCat(null); setSvcSearch(""); }}>
                  <ChevronLeft className="size-4" /> Bo&apos;limlar
                </Button>
              )}
            </div>

            {!openCat ? (
              /* Bo'lim kartochkalari */
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {groups.map((g) => {
                  const inThis = g.items.filter((s) => picked.includes(s.id)).length;
                  return (
                    <button key={g.name} onClick={() => setOpenCat(g.name)}
                      className={`relative flex items-center gap-3 rounded-xl border-2 p-4 text-left transition ${inThis ? "border-emerald-500/50 bg-emerald-500/5" : "border-border hover:border-primary/50"}`}>
                      <span className="text-3xl">{CAT_ICON[g.name] || "📋"}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{g.name}</span>
                        <span className="block text-xs text-muted-foreground">{g.count} ta xizmat</span>
                      </span>
                      {inThis > 0 && (
                        <span className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
                          {inThis}
                        </span>
                      )}
                    </button>
                  );
                })}
                {groups.length === 0 && <p className="text-sm text-muted-foreground">Xizmat qo&apos;shilmagan</p>}
              </div>
            ) : (
              /* Bo'lim ichidagi xizmatlar */
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{CAT_ICON[openCat] || "📋"}</span>
                    <span className="font-semibold">{openCat}</span>
                    <div className="relative ml-auto w-full max-w-56">
                      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input value={svcSearch} onChange={(e) => setSvcSearch(e.target.value)}
                        placeholder="Qidirish..." className="h-9 pl-8" />
                    </div>
                  </div>
                  <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
                    {openGroupSections.map((sec) => (
                      <div key={sec.sub}>
                        {openGroupSections.length > 1 && (
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{sec.sub}</p>
                        )}
                        <div className="grid gap-2 lg:grid-cols-2">
                          {sec.items.map((s) => {
                            const on = picked.includes(s.id);
                            return (
                              <button key={s.id} onClick={() => toggleService(s.id)}
                                className={`flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition ${on ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
                                <span className={`flex size-6 flex-none items-center justify-center rounded-md border ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"}`}>
                                  {on ? <Check className="size-3.5" /> : <Plus className="size-3.5 text-muted-foreground" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-medium leading-tight">{s.icon ? s.icon + " " : ""}{s.name}</span>
                                  <span className="block text-xs text-muted-foreground">{s.duration_min || 30} daq</span>
                                </span>
                                <span className="flex-none text-sm font-bold">{fmtSum(s.price)}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {openGroupSections.length === 0 && (
                      <p className="py-6 text-center text-sm text-muted-foreground">Topilmadi</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Vaqt */}
          <div>
            <Label className="mb-2 block">
              Vaqt * {picked.length > 0 && <span className="text-muted-foreground">({totalMin} daqiqa kerak)</span>}
            </Label>
            {!doctor ? <p className="text-sm text-muted-foreground">Avval shifokorni tanlang</p>
              : slotsFetching ? <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline size-3 animate-spin" />Yuklanmoqda...</p>
              : slots.length === 0 ? <p className="text-sm text-amber-600">{slotData?.reason || "Bo'sh vaqt yo'q"}</p>
              : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 2xl:grid-cols-8">
                  {slots.map((s) => (
                    <button key={s.scheduled_at} disabled={!s.available} onClick={() => setSlot(s.scheduled_at)}
                      className={`rounded-lg border py-2.5 text-sm font-medium transition ${
                        slot === s.scheduled_at ? "border-primary bg-primary text-primary-foreground"
                        : s.available ? "border-border hover:border-primary" : "cursor-not-allowed border-border opacity-30 line-through"}`}>
                      {s.time}
                    </button>
                  ))}
                </div>
              )}
          </div>
        </motion.div>

        {/* ── O'ng: savat ── */}
        <motion.div variants={itemAnim}>
          <Card className="xl:sticky xl:top-4">
            <CardContent className="space-y-3 p-5">
              <h3 className="font-semibold">Tanlangan xizmatlar</h3>
              {pickedServices.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Bo&apos;limdan xizmat tanlang</p>
              ) : (
                <div className="space-y-1.5">
                  {pickedServices.map((s) => (
                    <div key={s.id} className="flex items-start gap-2 border-b pb-1.5 last:border-0">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-tight">{s.name}</span>
                        <span className="text-xs text-muted-foreground">{fmtSum(s.price)}</span>
                      </span>
                      <button onClick={() => toggleService(s.id)} className="text-muted-foreground hover:text-rose-500" title="Olib tashlash">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between border-t pt-3">
                <span className="font-semibold">JAMI</span>
                <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{fmtSum(total)}</span>
              </div>

              {selectedDoctor && (
                <p className="text-xs text-muted-foreground">
                  {docName(selectedDoctor)}
                  {slot && ` · ${new Date(slot).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}`}
                </p>
              )}

              <div className="space-y-1.5">
                <Label>To&apos;lov turi</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setPay("cashier")}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border-2 p-2.5 text-sm font-medium ${pay === "cashier" ? "border-primary bg-primary/5" : "border-border"}`}>
                    <Banknote className="size-4" /> Kassada
                  </button>
                  <button onClick={() => setPay("online")}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border-2 p-2.5 text-sm font-medium ${pay === "online" ? "border-primary bg-primary/5" : "border-border"}`}>
                    <CreditCard className="size-4" /> Online
                  </button>
                </div>
              </div>

              <Button className="h-12 w-full text-base" onClick={submit} disabled={bookMutation.isPending}>
                {bookMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : <Printer className="size-5" />}
                Ro&apos;yxatga olish
              </Button>
              {picked.length > 0 && (
                <button onClick={() => { setPicked([]); setSlot(null); }}
                  className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <X className="size-3" /> Xizmatlarni tozalash
                </button>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
