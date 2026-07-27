"use client";

import { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

/* ── Types ── */
interface Doctor { id: string; first_name: string; last_name?: string; specialty?: string; specialization?: string; }
interface Service { id: string; name: string; price: number; icon?: string; }
interface Slot { time: string; scheduled_at: string; available: boolean; }
interface Extraction {
  patient_name?: string; phone?: string; doctor_specialty?: string;
  department?: string; preferred_time?: string; notes?: string;
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const itemAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };
const fmtSum = (n: number) => (Number(n) || 0).toLocaleString("uz-UZ") + " so'm";
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function ReceptionVoicePage() {
  const queryClient = useQueryClient();

  const [lang, setLang] = useState<"uz" | "ru">("uz");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [doctor, setDoctor] = useState("");
  const [service, setService] = useState("");
  const [date, setDate] = useState(todayStr());
  const [slot, setSlot] = useState<string | null>(null);
  const [pay, setPay] = useState<"cashier" | "online">("cashier");

  const [result, setResult] = useState<{ access_code?: string; payment_url?: string; amount: number; doctor_name: string; service_name: string; scheduled_at: string } | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const selectedService = services.find((s) => s.id === service) || null;

  const { data: slotData, isFetching: slotsFetching } = useQuery({
    queryKey: ["slots", doctor, date, service],
    enabled: !!doctor && !!date,
    queryFn: async () => {
      let url = `/api/booking/slots?doctor_id=${doctor}&date=${date}`;
      if (service) url += `&service_id=${service}`;
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
      if (ex.patient_name) setName(ex.patient_name);
      if (ex.phone) setPhone(ex.phone);
      if (ex.doctor_specialty) {
        const m = doctors.find((d) =>
          (d.specialty || "").toLowerCase().includes(ex.doctor_specialty!.toLowerCase()) ||
          (d.specialization || "").toLowerCase().includes(ex.doctor_specialty!.toLowerCase()));
        if (m) setDoctor(m.id);
      }
      toast.success("Ovoz tahlil qilindi", { description: ex.patient_name || "Ma'lumot to'ldirildi" });
    },
    onError: (e: Error) => toast.error("Xatolik", { description: e.message }),
  });

  const bookMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ appointment: { access_code?: string; amount: number; doctor_name: string; service_name: string; scheduled_at: string }; payment: { payment_url?: string } }>(
        "/api/booking/create",
        { patient_name: name.trim(), phone: phone.trim() || null, doctor_id: doctor, service_id: service, scheduled_at: slot, payment_method: pay, source: "reception" }
      );
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["booking-list"] });
      const a = res.appointment;
      setResult({ access_code: a.access_code, payment_url: res.payment?.payment_url, amount: a.amount, doctor_name: a.doctor_name, service_name: a.service_name, scheduled_at: a.scheduled_at });
      if (pay === "online" && res.payment?.payment_url) window.open(res.payment.payment_url, "_blank");
    },
    onError: (e: Error) => {
      if (e.message?.toLowerCase().includes("band")) { toast.error("Bu vaqt endi band"); queryClient.invalidateQueries({ queryKey: ["slots"] }); }
      else toast.error(e.message || "Xatolik");
    },
  });

  function reset() {
    setName(""); setPhone(""); setDoctor(""); setService(""); setSlot(null);
    setDate(todayStr()); setPay("cashier"); setTranscript(""); setResult(null);
  }

  function submit() {
    if (!name.trim()) return toast.error("Bemor ismini kiriting");
    if (!doctor) return toast.error("Shifokorni tanlang");
    if (!service) return toast.error("Xizmatni tanlang");
    if (!slot) return toast.error("Vaqtni tanlang");
    bookMutation.mutate();
  }

  const busy = voiceMutation.isPending;

  if (result) {
    return (
      <motion.div variants={container} initial="hidden" animate="show" className="mx-auto max-w-md space-y-4">
        <Card className="border-emerald-500/30">
          <CardContent className="space-y-3 p-6 text-center">
            <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
            <h2 className="text-xl font-bold">Ro&apos;yxatga olindi</h2>
            <div className="space-y-1 text-left text-sm">
              <div className="flex justify-between border-b py-1"><span className="text-muted-foreground">Bemor</span><span>{name}</span></div>
              <div className="flex justify-between border-b py-1"><span className="text-muted-foreground">Shifokor</span><span>{result.doctor_name}</span></div>
              <div className="flex justify-between border-b py-1"><span className="text-muted-foreground">Xizmat</span><span>{result.service_name}</span></div>
              <div className="flex justify-between border-b py-1"><span className="text-muted-foreground">Vaqt</span><span>{new Date(result.scheduled_at).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" })}</span></div>
              <div className="flex justify-between py-1"><span className="text-muted-foreground">Summa</span><span className="font-bold text-emerald-600">{fmtSum(result.amount)}</span></div>
            </div>
            {result.access_code && (
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">Kassa uchun kod</p>
                <p className="font-mono text-3xl font-bold tracking-widest text-primary">{result.access_code}</p>
                <p className="text-xs text-muted-foreground">Bemor kassaga shu kodni aytadi</p>
              </div>
            )}
            {result.payment_url && (
              <a href={result.payment_url} target="_blank" rel="noopener noreferrer">
                <Button className="w-full"><CreditCard className="size-4" /> Onlayn to&apos;lov havolasi</Button>
              </a>
            )}
            <Button variant="outline" className="w-full" onClick={reset}><RotateCcw className="size-4" /> Yangi bemor</Button>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="mx-auto max-w-md space-y-5">
      <motion.div variants={itemAnim}>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Mic className="size-6 text-primary" /> Ovozli qabul</h1>
        <p className="text-sm text-muted-foreground">Gapiring — bemor ma&apos;lumoti avtomatik to&apos;ldiriladi</p>
      </motion.div>

      {/* Til + mikrofon */}
      <motion.div variants={itemAnim}>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6">
            <div className="flex gap-1.5 self-stretch">
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
            <p className="text-sm text-muted-foreground">
              {busy ? "Tahlil qilinmoqda..." : recording ? `Yozilmoqda — ${seconds}s (to'xtatish uchun bosing)` : "Gapirish uchun bosing"}
            </p>
            <p className="text-center text-xs text-muted-foreground">Masalan: &quot;Aziz Karimov, terapevt, telefon 90 123 45 67&quot;</p>
            {transcript && <p className="w-full rounded-lg bg-muted p-2 text-xs">{transcript}</p>}
          </CardContent>
        </Card>
      </motion.div>

      {/* Forma */}
      <motion.div variants={itemAnim}>
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Bemor ismi *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ism familiya" /></div>
              <div className="space-y-1.5"><Label>Telefon</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998..." /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Shifokor *</Label>
              <Select value={doctor} onValueChange={(v) => { setDoctor(v ?? ""); setSlot(null); }}>
                <SelectTrigger><SelectValue placeholder="Shifokorni tanlang" /></SelectTrigger>
                <SelectContent>{doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.first_name} {d.last_name || ""} {d.specialty ? `· ${d.specialty}` : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Xizmat *</Label>
              <Select value={service} onValueChange={(v) => { setService(v ?? ""); setSlot(null); }}>
                <SelectTrigger><SelectValue placeholder="Xizmatni tanlang" /></SelectTrigger>
                <SelectContent>{services.map((s) => <SelectItem key={s.id} value={s.id}>{s.icon ? s.icon + " " : ""}{s.name} — {fmtSum(s.price)}</SelectItem>)}</SelectContent>
              </Select>
              {selectedService && <p className="text-right text-sm font-semibold text-emerald-600">{fmtSum(selectedService.price)}</p>}
            </div>
            <div className="space-y-1.5"><Label>Sana</Label><Input type="date" min={todayStr()} value={date} onChange={(e) => { setDate(e.target.value); setSlot(null); }} /></div>
            <div className="space-y-1.5">
              <Label>Vaqt *</Label>
              {!doctor ? <p className="text-sm text-muted-foreground">Avval shifokorni tanlang</p>
                : slotsFetching ? <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline size-3 animate-spin" />Yuklanmoqda...</p>
                : slots.length === 0 ? <p className="text-sm text-amber-600">{slotData?.reason || "Bo'sh vaqt yo'q"}</p>
                : (
                  <div className="grid grid-cols-4 gap-2">
                    {slots.map((s) => (
                      <button key={s.scheduled_at} disabled={!s.available} onClick={() => setSlot(s.scheduled_at)}
                        className={`rounded-md border py-2 text-sm ${slot === s.scheduled_at ? "border-primary bg-primary text-primary-foreground" : s.available ? "border-border hover:border-primary" : "cursor-not-allowed border-border opacity-30 line-through"}`}>
                        {s.time}
                      </button>
                    ))}
                  </div>
                )}
            </div>
            <div className="space-y-1.5">
              <Label>To&apos;lov turi</Label>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setPay("cashier")} className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium ${pay === "cashier" ? "border-primary bg-primary/5" : "border-border"}`}><Banknote className="size-4" /> Kassada</button>
                <button onClick={() => setPay("online")} className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium ${pay === "online" ? "border-primary bg-primary/5" : "border-border"}`}><CreditCard className="size-4" /> Online</button>
              </div>
            </div>
            <Button className="w-full" size="lg" onClick={submit} disabled={bookMutation.isPending}>
              {bookMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} Ro&apos;yxatga olish
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
