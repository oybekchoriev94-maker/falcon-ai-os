"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  RefreshCw,
  Loader2,
  UserPlus,
  Mic,
  Square,
  Wallet,
  Printer,
  CreditCard,
  Banknote,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SURXONDARYO_DISTRICTS, DEFAULT_REGION, toStoredPhone, toLocalPhone, formatLocalPhone } from "@/lib/regions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";

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
  specialty?: string;
  duration_min?: number;
  icon?: string;
  category?: string | null;
}
interface Slot {
  time: string;
  scheduled_at: string;
  available: boolean;
}
interface Appointment {
  id: number;
  appointment_id: string;
  patient_name: string;
  phone?: string;
  doctor_name?: string;
  scheduled_at: string;
  amount: number;
  status: string;
  payment_status: "pending" | "paid" | "refunded" | "cancelled";
  payment_method?: string;
  access_code?: string;
  source?: string;
  service_name?: string;
}

const PAY_BADGE: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  cancelled: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  refunded: "bg-slate-500/10 text-slate-500 border-slate-500/20",
};
const PAY_LABEL: Record<string, string> = {
  paid: "To'langan",
  pending: "To'lov kutilmoqda",
  cancelled: "Bekor qilingan",
  refunded: "Qaytarilgan",
};

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const itemAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

function fmtSum(n: number) {
  return (Number(n) || 0).toLocaleString("uz-UZ") + " so'm";
}
function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReceptionPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [date, setDate] = useState(todayStr());
  const [search, setSearch] = useState("");
  const [bookOpen, setBookOpen] = useState(false);

  /* Booking form state */
  const [lang, setLang] = useState<"uz" | "ru">("uz");
  const [fName, setFName] = useState("");
  const [fPhone, setFPhone] = useState("");          // faqat 9 raqam
  const [fDistrict, setFDistrict] = useState("");
  const [fMahalla, setFMahalla] = useState("");
  const [fDoctor, setFDoctor] = useState("");
  const [fService, setFService] = useState("");
  const [fCategory, setFCategory] = useState("");  // xizmat bo'limi filtri
  const [fDate, setFDate] = useState(todayStr());
  const [fSlot, setFSlot] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<"cashier" | "online">("cashier");

  /* Voice */
  const [recording, setRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  /* Cashier dialog */
  const [payFor, setPayFor] = useState<Appointment | null>(null);
  const [cashReceived, setCashReceived] = useState("");

  /* Bemor kartasi (telefon bo'yicha topilgan) — takroriy bemorni ko'rsatib qo'yish uchun */
  const [foundPatient, setFoundPatient] = useState<{ id: string; mrn?: string; visits: number } | null>(null);

  // Telefon 9 raqamga to'lganda kartani izlab, ism va tumani bo'sh bo'lsa to'ldiramiz
  useEffect(() => {
    if (fPhone.length !== 9) { setFoundPatient(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const stored = toStoredPhone(fPhone);
        if (!stored) return;
        const res = await api.get<{ patient: {
          id: string; first_name: string; last_name?: string; middle_name?: string;
          district?: string; address?: string; medical_record_number?: string;
        } | null }>(`/api/patients/lookup?phone=${encodeURIComponent(stored)}`);
        if (cancelled) return;
        if (res.success && res.patient) {
          const p = res.patient;
          const full = `${p.last_name || ""} ${p.first_name} ${p.middle_name || ""}`.replace(/\s+/g, " ").trim();
          setFName((cur) => cur.trim() ? cur : full);
          if (p.district) setFDistrict((cur) => cur || p.district!);
          if (p.address) setFMahalla((cur) => cur || p.address!);
          // Necha marta kelganini istoriyadan olamiz (yumshoq — xato bo'lsa ko'rsatmaymiz)
          try {
            const h = await api.get<{ appointments: unknown[] }>(`/api/patients/${p.id}/history`);
            setFoundPatient({ id: p.id, mrn: p.medical_record_number, visits: h.success ? h.appointments.length : 0 });
          } catch {
            setFoundPatient({ id: p.id, mrn: p.medical_record_number, visits: 0 });
          }
        } else {
          setFoundPatient(null);
        }
      } catch {
        if (!cancelled) setFoundPatient(null);
      }
    })();
    return () => { cancelled = true; };
  }, [fPhone]);

  /* ── Queries ── */
  const { data: apptData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["booking-list", date],
    queryFn: async () => {
      const res = await api.get<{ appointments: Appointment[] }>(`/api/booking/list?date=${date}`);
      if (res.success) return res;
      throw new Error(res.error);
    },
    refetchInterval: 30_000,
  });
  const appointments = apptData?.appointments ?? [];

  const { data: docData } = useQuery({
    queryKey: ["doctors"],
    queryFn: async () => {
      const res = await api.get<{ doctors: Doctor[] }>("/api/doctors?limit=100");
      if (res.success) return res;
      throw new Error(res.error);
    },
  });
  const doctors = docData?.doctors ?? [];

  const { data: svcData } = useQuery({
    queryKey: ["services-active"],
    queryFn: async () => {
      const res = await api.get<{ services: Service[] }>("/api/services?active_only=true");
      if (res.success) return res;
      throw new Error(res.error);
    },
  });
  const services = svcData?.services ?? [];

  const { data: mahallaData } = useQuery({
    queryKey: ["mahallas", fDistrict],
    enabled: !!fDistrict,
    queryFn: async () => {
      const res = await api.get<{ mahallas: string[] }>(`/api/booking/mahallas?district=${encodeURIComponent(fDistrict)}`);
      if (res.success) return res; throw new Error(res.error);
    },
  });
  const mahallaOptions = mahallaData?.mahallas ?? [];

  const selectedDoctor = doctors.find((d) => d.id === fDoctor) || null;
  const selectedService = services.find((s) => s.id === fService) || null;

  // Xizmatlarni bo'limlarga ajratamiz — klinikada 80+ xizmat bo'lishi mumkin
  const svcCategories = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of services) m.set(s.category || "Boshqa", (m.get(s.category || "Boshqa") || 0) + 1);
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [services]);

  const groupedServices = useMemo(() => {
    const list = fCategory ? services.filter((s) => (s.category || "Boshqa") === fCategory) : services;
    const m = new Map<string, Service[]>();
    for (const s of list) {
      const k = s.category || "Boshqa";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return [...m.entries()]
      .map(([name, items]) => ({ name, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [services, fCategory]);

  const { data: slotData, isFetching: slotsFetching } = useQuery({
    queryKey: ["slots", fDoctor, fDate, fService],
    enabled: !!fDoctor && !!fDate,
    queryFn: async () => {
      let url = `/api/booking/slots?doctor_id=${fDoctor}&date=${fDate}`;
      if (fService) url += `&service_id=${fService}`;
      const res = await api.get<{ slots: Slot[]; reason?: string }>(url);
      if (res.success) return res;
      throw new Error(res.error);
    },
  });
  const slots = slotData?.slots ?? [];

  /* ── Mutations ── */
  const bookMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ appointment: Appointment; payment: { payment_url?: string; access_code?: string } }>(
        "/api/booking/create",
        {
          patient_name: fName.trim(),
          phone: toStoredPhone(fPhone),
          region: fDistrict ? DEFAULT_REGION : null,
          district: fDistrict || null,
          mahalla: fMahalla.trim() || null,
          doctor_id: fDoctor,
          service_id: fService,
          scheduled_at: fSlot,
          payment_method: payMethod,
          source: "reception",
        }
      );
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["booking-list"] });
      const a = res.appointment;
      if (payMethod === "online" && res.payment?.payment_url) {
        toast.success("Bron qilindi", { description: "Onlayn to'lov havolasi ochilmoqda" });
        window.open(res.payment.payment_url, "_blank");
      } else {
        toast.success(`Bron qilindi — kod: ${a.access_code}`, {
          description: "Kassa uchun shu kod. Endi to'lovni qabul qiling.",
        });
      }
      resetBook();
      setBookOpen(false);
    },
    onError: (err: Error) => {
      if (err.message?.toLowerCase().includes("band")) {
        toast.error("Bu vaqt endi band", { description: "Boshqa vaqt tanlang" });
        queryClient.invalidateQueries({ queryKey: ["slots"] });
      } else {
        toast.error(err.message || "Xatolik");
      }
    },
  });

  const payMutation = useMutation({
    mutationFn: async (args: { appt: Appointment; cash: number }) => {
      const res = await api.post<{ payment: { receipt_number: number; change: number }; receipt_html?: string }>(
        "/api/cashier/pay",
        { appointment_id: args.appt.id, cash_received: args.cash, method: "cash" }
      );
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["booking-list"] });
      toast.success(`To'lov qabul qilindi — chek #${res.payment.receipt_number}`, {
        description: res.payment.change > 0 ? `Qaytim: ${fmtSum(res.payment.change)}` : "Qaytim yo'q",
      });
      // Chek HTML'ini yangi oynaga yozamiz (authli tab GET ishlamaydi)
      if (res.receipt_html) {
        const w = window.open("", "_blank");
        if (w) { w.document.write(res.receipt_html); w.document.close(); }
      }
      setPayFor(null);
      setCashReceived("");
    },
    onError: (err: Error) => toast.error(err.message || "Xatolik"),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.post("/api/booking/cancel", { id });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Bekor qilindi");
      queryClient.invalidateQueries({ queryKey: ["booking-list"] });
    },
    onError: (err: Error) => toast.error(err.message || "Xatolik"),
  });

  /* ── Derived ── */
  const filtered = useMemo(() => {
    if (!search.trim()) return appointments;
    const q = search.toLowerCase();
    return appointments.filter(
      (a) =>
        a.patient_name.toLowerCase().includes(q) ||
        (a.doctor_name || "").toLowerCase().includes(q) ||
        (a.service_name || "").toLowerCase().includes(q)
    );
  }, [appointments, search]);

  const stats = useMemo(() => {
    const paid = appointments.filter((a) => a.payment_status === "paid");
    const pending = appointments.filter((a) => a.payment_status === "pending");
    const revenue = paid.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    return { total: appointments.length, paid: paid.length, pending: pending.length, revenue };
  }, [appointments]);

  /* ── Helpers ── */
  function resetBook() {
    setFName(""); setFPhone(""); setFDistrict(""); setFMahalla(""); setFDoctor(""); setFService(""); setFCategory("");
    setFSlot(null); setFDate(todayStr()); setPayMethod("cashier");
  }

  async function toggleMic() {
    if (recording && mediaRef.current) {
      mediaRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = onRecStop;
      mr.start();
      setRecording(true);
    } catch {
      toast.error("Mikrofon ruxsati kerak");
    }
  }

  async function onRecStop() {
    setRecording(false);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    setVoiceBusy(true);
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const fd = new FormData();
      fd.append("audio", blob, "rec.webm");
      fd.append("language", lang);
      const res = await api.upload<{ extraction: { patient_name?: string; phone?: string; doctor_specialty?: string } }>(
        "/api/reception/voice-register",
        fd
      );
      if (!res.success) throw new Error(res.error);
      const ex = res.extraction || {};
      if (ex.patient_name) setFName(ex.patient_name);
      if (ex.phone) setFPhone(toLocalPhone(ex.phone));
      if (ex.doctor_specialty) {
        const match = doctors.find(
          (d) =>
            (d.specialty || "").toLowerCase().includes(ex.doctor_specialty!.toLowerCase()) ||
            (d.specialization || "").toLowerCase().includes(ex.doctor_specialty!.toLowerCase())
        );
        if (match) setFDoctor(match.id);
      }
      toast.success("Ovoz tahlil qilindi", { description: ex.patient_name || "To'ldirildi" });
    } catch (e) {
      toast.error((e as Error).message || "Tushunarli emas");
    } finally {
      setVoiceBusy(false);
    }
  }

  function submitBooking() {
    if (!fName.trim()) return toast.error("Bemor ismini kiriting");
    if (!fDoctor) return toast.error("Shifokorni tanlang");
    if (!fService) return toast.error("Xizmatni tanlang");
    if (!fSlot) return toast.error("Vaqtni tanlang");
    bookMutation.mutate();
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemAnim} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Qabulxona</h1>
          <p className="text-sm text-muted-foreground">
            Bron, to&apos;lov va chek — bitta oqimda
            {user?.full_name && <> &mdash; {user.full_name}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Yangilash
          </Button>
          <Button onClick={() => { resetBook(); setBookOpen(true); }}>
            <UserPlus className="size-4" />
            Yangi bron
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemAnim} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Bugungi bronlar", value: stats.total, icon: Users, color: "from-blue-500/20 to-blue-500/5" },
          { label: "To'langan", value: stats.paid, icon: CheckCircle2, color: "from-emerald-500/20 to-emerald-500/5" },
          { label: "To'lov kutilmoqda", value: stats.pending, icon: Clock, color: "from-amber-500/20 to-amber-500/5" },
          { label: "Tushum", value: fmtSum(stats.revenue), icon: Wallet, color: "from-purple-500/20 to-purple-500/5" },
        ].map((s) => (
          <Card key={s.label} className={`bg-gradient-to-br ${s.color}`}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-xl font-bold">{s.value}</p>
              </div>
              <s.icon className="size-8 opacity-40" />
            </CardContent>
          </Card>
        ))}
      </motion.div>

      {/* Search */}
      <motion.div variants={itemAnim}>
        <Input placeholder="Bemor / shifokor / xizmat bo'yicha qidirish..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </motion.div>

      {/* List */}
      <motion.div variants={itemAnim} className="space-y-3">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Bu kunga bron yo&apos;q</CardContent></Card>
        ) : (
          filtered.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{a.patient_name}</span>
                    <Badge variant="outline" className={PAY_BADGE[a.payment_status] || ""}>
                      {PAY_LABEL[a.payment_status] || a.payment_status}
                    </Badge>
                    {a.source === "telegram" && <Badge variant="outline">Telegram</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {a.doctor_name} · {a.service_name || "—"} · {fmtTime(a.scheduled_at)} · <span className="font-medium text-foreground">{fmtSum(a.amount)}</span>
                    {a.payment_status === "pending" && a.access_code && <> · kod <span className="font-mono">{a.access_code}</span></>}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  {a.payment_status === "pending" && (
                    <Button size="sm" onClick={() => { setPayFor(a); setCashReceived(String(a.amount)); }}>
                      <Wallet className="size-3.5" /> Kassa
                    </Button>
                  )}
                  {a.payment_status === "paid" && (
                    <Badge variant="outline" className="gap-1 border-emerald-500/20 text-emerald-600">
                      <Printer className="size-3.5" /> Chek berilgan
                    </Badge>
                  )}
                  {a.payment_status !== "cancelled" && a.payment_status !== "paid" && (
                    <Button size="sm" variant="ghost" onClick={() => cancelMutation.mutate(a.id)} disabled={cancelMutation.isPending}>
                      <XCircle className="size-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </motion.div>

      {/* ── Booking dialog ── */}
      <Dialog open={bookOpen} onOpenChange={setBookOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Yangi bron</DialogTitle>
            <DialogDescription>Ovoz yoki qo&apos;lda: bemor → shifokor → xizmat → vaqt → to&apos;lov</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Til + ovoz */}
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {(["uz", "ru"] as const).map((l) => (
                  <button key={l} onClick={() => setLang(l)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${lang === l ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {l === "uz" ? "🇺🇿 UZ" : "🇷🇺 RU"}
                  </button>
                ))}
              </div>
              <Button type="button" variant={recording ? "destructive" : "outline"} size="sm" onClick={toggleMic} disabled={voiceBusy}>
                {voiceBusy ? <Loader2 className="size-4 animate-spin" /> : recording ? <Square className="size-4" /> : <Mic className="size-4" />}
                {recording ? "To'xtatish" : voiceBusy ? "Tahlil..." : "Ovoz"}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Bemor ismi *</Label>
                <Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Ism familiya" />
              </div>
              <div className="space-y-1.5">
                <Label>Telefon</Label>
                <div className="flex items-center rounded-lg border border-input focus-within:border-ring">
                  <span className="select-none border-r px-2.5 py-2 text-sm text-muted-foreground">+998</span>
                  <input value={formatLocalPhone(fPhone)}
                    onChange={(e) => setFPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))}
                    inputMode="numeric" placeholder="90 123 45 67"
                    className="w-full bg-transparent px-2.5 py-2 text-sm outline-none" />
                </div>
              </div>
            </div>

            {/* Bemor kartasi topildi — takroriy tashrifni darhol ko'rsatamiz */}
            {foundPatient && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-primary">●</span>
                  <span className="truncate">
                    Bemor topildi
                    {foundPatient.mrn && <span className="text-muted-foreground"> · {foundPatient.mrn}</span>}
                    {foundPatient.visits > 0 && <span className="text-muted-foreground"> · {foundPatient.visits} ta tashrif</span>}
                  </span>
                </div>
                <a href={`/patients/${foundPatient.id}`} target="_blank" rel="noopener"
                   className="shrink-0 text-xs font-medium text-primary hover:underline">
                  Kartani ochish →
                </a>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tuman</Label>
                <select value={fDistrict} onChange={(e) => { setFDistrict(e.target.value); setFMahalla(""); }}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus:border-ring">
                  <option value="">— tanlang —</option>
                  {SURXONDARYO_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Mahalla</Label>
                <Input list="mahalla-list-r" value={fMahalla} onChange={(e) => setFMahalla(e.target.value)}
                  placeholder={fDistrict ? "Mahalla nomi" : "Avval tuman"} disabled={!fDistrict} />
                <datalist id="mahalla-list-r">
                  {mahallaOptions.map((m) => <option key={m} value={m} />)}
                </datalist>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Shifokor *</Label>
              <Select value={fDoctor} onValueChange={(v) => { setFDoctor(v ?? ""); setFSlot(null); }}>
                <SelectTrigger>
                  {/* Base UI SelectValue tanlangan QIYMATNI (uuid) chiqaradi — yorliqni o'zimiz beramiz */}
                  <span data-slot="select-value" className="line-clamp-1 flex-1 text-left">
                    {selectedDoctor
                      ? `${selectedDoctor.first_name} ${selectedDoctor.last_name || ""}`.trim()
                      : <span className="text-muted-foreground">Shifokorni tanlang</span>}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.first_name} {d.last_name || ""} {d.specialty ? `· ${d.specialty}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Xizmat *</Label>
              {/* Bo'lim chiplari — 80+ xizmatni tekis ro'yxatdan topish qiyin */}
              {svcCategories.length > 1 && (
                <div className="flex flex-wrap gap-1.5 pb-1">
                  <button type="button" onClick={() => setFCategory("")}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${!fCategory ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary"}`}>
                    Barchasi ({services.length})
                  </button>
                  {svcCategories.map((c) => (
                    <button key={c.name} type="button" onClick={() => setFCategory(c.name)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${fCategory === c.name ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary"}`}>
                      {c.name} ({c.count})
                    </button>
                  ))}
                </div>
              )}
              <Select value={fService} onValueChange={(v) => { setFService(v ?? ""); setFSlot(null); }}>
                <SelectTrigger>
                  <span data-slot="select-value" className="line-clamp-1 flex-1 text-left">
                    {selectedService
                      ? `${selectedService.icon ? selectedService.icon + " " : ""}${selectedService.name} — ${fmtSum(selectedService.price)}`
                      : <span className="text-muted-foreground">{fCategory ? `${fCategory} — xizmatni tanlang` : "Xizmatni tanlang"}</span>}
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-[60vh] w-[min(94vw,520px)]" alignItemWithTrigger={false}>
                  {groupedServices.map((g) => (
                    <SelectGroup key={g.name}>
                      <SelectLabel>{g.name}</SelectLabel>
                      {g.items.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.icon ? s.icon + " " : ""}{s.name} — {fmtSum(s.price)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {selectedService && (
                <p className="text-right text-sm font-semibold text-emerald-600 dark:text-emerald-400">{fmtSum(selectedService.price)}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Sana</Label>
              <Input type="date" min={todayStr()} value={fDate} onChange={(e) => { setFDate(e.target.value); setFSlot(null); }} />
            </div>

            {/* Slots */}
            <div className="space-y-1.5">
              <Label>Vaqt *</Label>
              {!fDoctor ? (
                <p className="text-sm text-muted-foreground">Avval shifokorni tanlang</p>
              ) : slotsFetching ? (
                <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline size-3 animate-spin" />Yuklanmoqda...</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-amber-600">{slotData?.reason || "Bo'sh vaqt yo'q"}</p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {slots.map((s) => (
                    <button key={s.scheduled_at} disabled={!s.available}
                      onClick={() => setFSlot(s.scheduled_at)}
                      className={`rounded-md border py-2 text-sm ${
                        fSlot === s.scheduled_at ? "border-primary bg-primary text-primary-foreground"
                        : s.available ? "border-border hover:border-primary" : "cursor-not-allowed border-border opacity-30 line-through"
                      }`}>
                      {s.time}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* To'lov turi */}
            <div className="space-y-1.5">
              <Label>To&apos;lov turi</Label>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setPayMethod("cashier")}
                  className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium ${payMethod === "cashier" ? "border-primary bg-primary/5" : "border-border"}`}>
                  <Banknote className="size-4" /> Kassada
                </button>
                <button onClick={() => setPayMethod("online")}
                  className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium ${payMethod === "online" ? "border-primary bg-primary/5" : "border-border"}`}>
                  <CreditCard className="size-4" /> Online
                </button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBookOpen(false)}>Bekor</Button>
            <Button onClick={submitBooking} disabled={bookMutation.isPending}>
              {bookMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Bron qilish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cashier dialog ── */}
      <Dialog open={!!payFor} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Kassa — to&apos;lov qabul qilish</DialogTitle>
            <DialogDescription>{payFor?.patient_name} · {payFor?.service_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex justify-between rounded-lg bg-muted p-3">
              <span className="text-muted-foreground">To&apos;lov summasi</span>
              <span className="text-lg font-bold">{fmtSum(payFor?.amount || 0)}</span>
            </div>
            <div className="space-y-1.5">
              <Label>Berilgan naqd (qaytim avtomatik)</Label>
              <Input type="number" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} />
            </div>
            {payFor && Number(cashReceived) > payFor.amount && (
              <p className="text-right text-sm">Qaytim: <span className="font-bold text-emerald-600">{fmtSum(Number(cashReceived) - payFor.amount)}</span></p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayFor(null)}>Bekor</Button>
            <Button
              onClick={() => payFor && payMutation.mutate({ appt: payFor, cash: Number(cashReceived) || payFor.amount })}
              disabled={payMutation.isPending}>
              {payMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
              To&apos;lash + chek
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

