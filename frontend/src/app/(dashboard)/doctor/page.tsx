"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth, type User } from "@/lib/auth-store";
import Link from "next/link";
import { useMemo, useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  Stethoscope,
  CalendarDays,
  Clock,
  Phone,
  Users,
  DollarSign,
  Wallet,
  Mic,
  Square,
  FolderOpen,
  MapPin,
  CheckCircle2,
  Share2,
  Loader2,
  Inbox,
  ArrowRight,
  Megaphone,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface QueueItem {
  id: number;
  appointment_id: string;
  patient_id: string | null;
  patient_name: string;
  phone: string | null;
  scheduled_at: string;
  /** Bemor kiosk/registraturada "Men keldim" bosgan vaqt */
  arrived_at: string | null;
  status: string;
  payment_status: string;
  amount: number;
  service_name: string | null;
  notes: string | null;
  medical_record_number: string | null;
  district: string | null;
  address: string | null;
  has_consultation: boolean;
  // Boshqa doktordan yo'naltirilgan bo'lsa — kim yubordi
  forwarded_from_appointment_id?: number | null;
  forwarded_from_doctor_id?: string | null;
  forwarded_from_doctor_name?: string | null;
  forwarded_from_doctor_spec?: string | null;
}

// Ko'rik ochilgach chiqadigan — shu bemor bo'yicha boshqa doktorlar xulosalari
interface PriorVisit {
  id: string;
  created_at: string;
  appointment_code: string | null;
  doctor_name: string;
  doctor_spec: string | null;
  service_name: string | null;
  diagnosis: string;
  procedure: string;
  medicines: string;
  notes: string;
}

interface IncomingReferral {
  id: string;
  referral_id: string;
  patient_id: string | null;
  patient_name: string;
  service_required: string;
  status: string;
  referring_doctor: string | null;
  notes: string | null;
  to_department: string | null;
  medical_record_number: string | null;
  phone: string | null;
  created_at: string;
}

interface DoctorLite {
  id: string;
  first_name: string;
  last_name?: string;
  specialty?: string;
}

const DEPARTMENTS = ["Fizioterapiya", "Ginekologiya", "Roddom", "Xirurgiya", "Terapiya", "Laboratoriya", "UZI"];

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}
function fmtSum(n: number) { return new Intl.NumberFormat("uz-UZ").format(n) + " so'm"; }

export default function DoctorPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [visitOf, setVisitOf] = useState<QueueItem | null>(null);
  const [referralOf, setReferralOf] = useState<QueueItem | null>(null);
  const [forwardOf, setForwardOf] = useState<QueueItem | null>(null);

  // ── Bugungi navbat (asosiy panel) ──
  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ["doctor-queue"],
    queryFn: async () => {
      const res = await api.get<{ queue: QueueItem[]; date: string }>("/api/doctor/queue");
      if (res.success) return res;
      throw new Error(res.error);
    },
    refetchInterval: 20_000,
  });
  const queue = queueData?.queue ?? [];

  const waiting = queue.filter((q) => q.status !== "completed" && !q.has_consultation);
  const done = queue.filter((q) => q.status === "completed" || q.has_consultation);

  // ── Keyingi bemorni chaqirish — TV ekran va ovozli e'longa bog'langan ──
  const callNext = useMutation({
    mutationFn: async (id?: number) => {
      const res = await api.post<{ called?: { patient_name: string }; code?: string }>(
        "/api/doctor/queue/call",
        id ? { id } : {}
      );
      if (!res.success) throw new Error(res.error || "Xatolik");
      return res;
    },
    onSuccess: (res) => {
      toast.success(`${res.called?.patient_name || "Bemor"} chaqirildi — TV ekranda ko'rinadi`);
      queryClient.invalidateQueries({ queryKey: ["doctor-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Statistika ──
  const { data: stats } = useQuery({
    queryKey: ["doctor-stats"],
    queryFn: async () => {
      const res = await api.get<{
        stats: { patients_count: number; total_revenue: number };
        today_patients: number;
      }>("/api/doctor/my-stats");
      return res.success ? res : { stats: { patients_count: 0, total_revenue: 0 }, today_patients: 0 };
    },
    refetchInterval: 60_000,
  });
  const { data: balance } = useQuery({
    queryKey: ["doctor-balance"],
    queryFn: async () => {
      const res = await api.get<{ balance: number }>("/api/doctors/balance");
      return res.success ? res : { balance: 0 };
    },
  });

  // ── Kelgan yo'llanmalar ──
  const { data: incData } = useQuery({
    queryKey: ["doctor-referrals-in"],
    queryFn: async () => {
      const res = await api.get<{ referrals: IncomingReferral[] }>("/api/doctor/referrals/incoming?status=pending");
      return res.success ? res : { referrals: [] };
    },
    refetchInterval: 30_000,
  });
  const incoming = incData?.referrals ?? [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <Header user={user} />

      <StatsRow
        today={stats?.today_patients ?? 0}
        total={stats?.stats?.patients_count ?? 0}
        revenue={stats?.stats?.total_revenue ?? 0}
        balance={balance?.balance ?? 0}
      />

      {/* Ikki ustun: navbat (asosiy) + yon panel (kelgan yo'llanmalar) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <QueueSection
            title="Kutayotgan navbat"
            items={waiting}
            loading={queueLoading}
            empty="Kutayotgan bemor yo'q — tinchgina qahva iching ☕"
            onOpen={setVisitOf}
            highlight
            onCallNext={() => callNext.mutate(undefined)}
            calling={callNext.isPending}
          />
          {done.length > 0 && (
            <QueueSection
              title="Bugun yakunlangan"
              items={done}
              loading={false}
              empty=""
              onOpen={setVisitOf}
            />
          )}
        </div>

        <div className="space-y-4">
          <IncomingReferrals items={incoming} />
          <QuickActions specialization={user?.specialization} />
        </div>
      </div>

      <VisitDialog
        item={visitOf}
        onClose={() => setVisitOf(null)}
        onCompleted={() => {
          queryClient.invalidateQueries({ queryKey: ["doctor-queue"] });
          queryClient.invalidateQueries({ queryKey: ["doctor-stats"] });
        }}
        onReferral={(it) => { setReferralOf(it); setVisitOf(null); }}
        onForward={(it) => { setForwardOf(it); setVisitOf(null); }}
      />

      <ForwardDialog
        item={forwardOf}
        onClose={() => setForwardOf(null)}
        onSent={() => queryClient.invalidateQueries({ queryKey: ["doctor-queue"] })}
      />

      <ReferralDialog
        item={referralOf}
        onClose={() => setReferralOf(null)}
        onSent={() => queryClient.invalidateQueries({ queryKey: ["doctor-referrals-in"] })}
      />
    </motion.div>
  );
}

function Header({ user }: { user: User | null }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm">
          <Stethoscope className="size-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {user?.full_name || user?.username || "Shifokor"}
          </h1>
          <p className="text-sm text-muted-foreground">Shifokor paneli</p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-1.5 w-fit">
        <CalendarDays className="size-4" />
        {new Date().toLocaleDateString("uz-UZ", { weekday: "long", day: "numeric", month: "long" })}
      </div>
    </div>
  );
}

function StatsRow({ today, total, revenue, balance }: { today: number; total: number; revenue: number; balance: number }) {
  const cards = [
    { label: "Bugungi bemorlar", value: today, icon: Users, color: "text-violet-500", bg: "bg-violet-500/10" },
    { label: "Jami bemorlar", value: total, icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Jami daromad", value: fmtSum(revenue), icon: DollarSign, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Balans", value: fmtSum(balance), icon: Wallet, color: "text-amber-500", bg: "bg-amber-500/10" },
  ];
  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
      {cards.map((s) => (
        <Card key={s.label} className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.label}</span>
              <div className={cn("size-8 rounded-lg flex items-center justify-center", s.bg)}>
                <s.icon className={cn("size-4", s.color)} />
              </div>
            </div>
            <div className="text-lg font-bold tracking-tight">{s.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function QueueSection({
  title, items, loading, empty, onOpen, highlight, onCallNext, calling,
}: {
  title: string;
  items: QueueItem[];
  loading: boolean;
  empty: string;
  onOpen: (q: QueueItem) => void;
  highlight?: boolean;
  /** Keyingi bemorni chaqirish tugmasi (faqat kutayotgan navbatda) */
  onCallNext?: () => void;
  calling?: boolean;
}) {
  return (
    <Card className={cn("border-border/50", highlight && "border-primary/30")}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className={cn("size-4", highlight ? "text-primary" : "text-muted-foreground")} />
            {title}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={highlight ? "default" : "secondary"} className="text-xs">{items.length}</Badge>
            {onCallNext && (
              <Button size="sm" onClick={onCallNext} disabled={calling || items.length === 0} className="h-8">
                {calling ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}
                Keyingi bemor
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          <div className="space-y-2">
            {items.map((q) => (
              <QueueRow key={q.id} item={q} onOpen={() => onOpen(q)} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QueueRow({ item, onOpen }: { item: QueueItem; onOpen: () => void }) {
  const done = item.status === "completed" || item.has_consultation;
  const serving = item.status === "in_progress";
  return (
    <button
      onClick={onOpen}
      className={cn(
        "w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        done ? "border-border/40 bg-muted/30" : "border-border/60 hover:border-primary/50 bg-card"
      )}
    >
      <div className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        done ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
      )}>
        {fmtTime(item.scheduled_at)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={cn("text-sm font-medium truncate", done && "text-muted-foreground")}>
            {item.patient_name}
          </p>
          {serving && (
            <Badge variant="default" className="text-[10px] shrink-0 bg-emerald-600">qabulda</Badge>
          )}
          {!serving && !done && item.arrived_at && (
            <Badge variant="secondary" className="text-[10px] shrink-0">keldi</Badge>
          )}
          {item.medical_record_number && (
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">{item.medical_record_number}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground truncate">
          {item.service_name && <span className="truncate">{item.service_name}</span>}
          {item.phone && <span className="shrink-0">· {item.phone}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <Badge variant={item.payment_status === "paid" ? "default" : "outline"} className="text-[10px]">
          {item.payment_status === "paid" ? "to'landi" : "kutilmoqda"}
        </Badge>
        {done ? (
          <span className="text-[10px] text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="size-3" /> yakunlangan
          </span>
        ) : (
          <span className="text-[10px] text-primary">ochish →</span>
        )}
      </div>
    </button>
  );
}

function IncomingReferrals({ items }: { items: IncomingReferral[] }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Inbox className="size-4 text-amber-500" />
            Kelgan yo&apos;llanmalar
          </CardTitle>
          <Badge variant="secondary" className="text-xs">{items.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Kelgan yo&apos;llanma yo&apos;q</p>
        ) : (
          <div className="space-y-2">
            {items.map((r) => (
              <div key={r.id} className="rounded-lg border border-border/40 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.patient_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.service_required}</p>
                  </div>
                  {r.patient_id && (
                    <Link href={`/patients/${r.patient_id}`} className="text-[10px] text-primary hover:underline shrink-0">
                      karta →
                    </Link>
                  )}
                </div>
                {r.referring_doctor && (
                  <p className="text-[10px] text-muted-foreground/70 mt-1">← {r.referring_doctor}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActions({ specialization }: { specialization?: string }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Tezkor amallar</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <Link href={`/scribe?specialization=${specialization || ""}`}
              className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm hover:border-primary/40 hover:bg-primary/5">
          <Mic className="size-4 text-primary" />
          <span>AI Scribe</span>
          <ArrowRight className="size-3 ml-auto text-muted-foreground" />
        </Link>
        <Link href="/patients"
              className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm hover:border-primary/40 hover:bg-primary/5">
          <FolderOpen className="size-4 text-primary" />
          <span>Bemorlar</span>
          <ArrowRight className="size-3 ml-auto text-muted-foreground" />
        </Link>
      </CardContent>
    </Card>
  );
}

// ── Ko'rik dialogi: bemor kartochkasi + xulosa maydonlari + yakunlash/yo'llanma ──
function VisitDialog({
  item, onClose, onCompleted, onReferral, onForward,
}: {
  item: QueueItem | null;
  onClose: () => void;
  onCompleted: () => void;
  onReferral: (it: QueueItem) => void;
  onForward: (it: QueueItem) => void;
}) {
  const [diagnosis, setDiagnosis] = useState("");
  const [procedure, setProcedure] = useState("");
  const [medicines, setMedicines] = useState("");
  const [notes, setNotes] = useState("");
  const [nextStep, setNextStep] = useState<"home" | "labs" | "admission">("home");
  const [labTypes, setLabTypes] = useState<string[]>([]);
  const [admissionReason, setAdmissionReason] = useState("");
  const [admissionDepartment, setAdmissionDepartment] = useState("");

  /* ── Yo'nalishga xos maydonlar ──
     Shifokor yo'nalishiga qarab shablon maydonlari (reproduktologda
     sikl/tuxumdon/gormonlar, urologda buyrak/prostata) diktantdan
     keyin dinamik chiziladi. Sxema serverdan keladi — shablonlar
     yagona manbada (ai/protocols/medical-skills.js). */
  type SpecField = { key: string; label: string; icon?: string; type?: string };
  const [specialtySchema, setSpecialtySchema] = useState<SpecField[]>([]);
  const [specialtyValues, setSpecialtyValues] = useState<Record<string, string>>({});
  const [specialtyKey, setSpecialtyKey] = useState<string | null>(null);
  const [specialtyLabel, setSpecialtyLabel] = useState<string | null>(null);

  /* ── Ovozli ko'rik ── */
  const [recording, setRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceLang, setVoiceLang] = useState<"uz" | "ru">("uz");
  const [transcript, setTranscript] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  /** Mikrofon oqimini to'liq yopadi — aks holda brauzerda yozuv indikatori
      qolib ketadi va keyingi bemorda ham "yozilmoqda" bo'lib turadi. */
  function releaseMic() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRef.current = null;
  }

  // Dialog yopilganda yozuv davom etmasin (shifokor "X" bosib chiqib ketsa)
  useEffect(() => {
    if (!item) {
      if (mediaRef.current?.state === "recording") mediaRef.current.stop();
      releaseMic();
      setRecording(false);
      setTranscript("");
      // Yo'nalish maydonlari keyingi bemorga o'tib qolmasin
      setSpecialtySchema([]);
      setSpecialtyValues({});
      setSpecialtyKey(null);
      setSpecialtyLabel(null);
    }
  }, [item]);

  async function startVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Formatni ANIQ tanlaymiz va yozuvni O'SHA nom bilan yuboramiz.
      // Ilgari `new MediaRecorder(stream)` deb formatsiz yaratilardi va
      // natija har doim "audio/webm" deb belgilanardi — brauzer boshqa
      // formatda yozsa (Safari `audio/mp4`), server faylni o'qiy olmasdi
      // va shifokor "ovozni olmayapti" deb ko'rardi.
      const mime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find((m) => MediaRecorder.isTypeSupported?.(m)) || "";

      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const actual = rec.mimeType || mime || "audio/webm";
        const ext = actual.includes("mp4") ? "mp4" : actual.includes("ogg") ? "ogg" : "webm";
        void sendVoice(new Blob(chunksRef.current, { type: actual }), ext);
      };
      mediaRef.current = rec;
      // 1s bo'laklab yozamiz: uzun diktantda butun yozuv bitta bo'lakda
      // to'planib qolmaydi va brauzer fonga o'tsa ham ma'lumot yig'iladi.
      rec.start(1000);
      setRecording(true);
    } catch (e) {
      // Sababni ajratamiz — shifokorga nima qilishni aytish uchun.
      const name = (e as Error)?.name || "";
      if (name === "NotAllowedError") {
        toast.error("Mikrofonga ruxsat berilmadi", {
          description: "Brauzer manzil satridagi qulf belgisini bosib, mikrofonga ruxsat bering.",
        });
      } else if (name === "NotFoundError") {
        toast.error("Mikrofon topilmadi", { description: "Qurilma ulanganini tekshiring." });
      } else {
        toast.error("Mikrofonni ochib bo'lmadi", { description: name || "Noma'lum xato" });
      }
    }
  }

  function stopVoice() {
    mediaRef.current?.stop();
    setRecording(false);
  }

  async function sendVoice(blob: Blob, ext = "webm") {
    releaseMic();
    if (!item) return;

    // Bo'sh/juda kichik yozuvni SERVERGA YUBORMAYMIZ. Mikrofon jim
    // qolganda (noto'g'ri qurilma tanlangan, tizimda ovoz o'chirilgan)
    // server to'g'ri javob beradi — "Ovoz aniqlanmadi" — lekin shifokor
    // buni "tizim ovozimni olmayapti" deb tushunadi va sababini bilmaydi.
    // Bu yerda muammo mikrofonda ekanini aniq aytamiz.
    if (blob.size < 1024) {
      console.warn("[VOICE] bo'sh yozuv:", blob.size, "bayt,", blob.type);
      toast.error("Mikrofondan ovoz kelmadi", {
        description: "Tizim sozlamalarida to'g'ri mikrofon tanlanganini va ovozi o'chiq emasligini tekshiring.",
      });
      return;
    }

    setVoiceBusy(true);
    try {
      const fd = new FormData();
      fd.append("audio", blob, `visit.${ext}`);
      fd.append("language", voiceLang);
      const res = await api.upload<{
        transcription: string;
        fields?: Record<string, string>;
        specialty_fields?: Record<string, unknown>;
        specialty_schema?: SpecField[];
        specialty_label?: string | null;
        specialty?: string | null;
        next_step?: "home" | "labs" | "admission" | "referral" | null;
        structured?: boolean;
        note?: string | null;
      }>(`/api/doctor/visit/${item.id}/voice`, fd);

      if (!res.success) { toast.error(res.error || "Ovoz qabul qilinmadi"); return; }
      setTranscript(res.transcription || "");

      // AI TAKLIF QILADI, SHIFOKOR QAROR QILADI: qo'lda yozilgan matn
      // ustidan yozmaymiz — faqat bo'sh maydonlarni to'ldiramiz.
      const f = res.fields || {};
      if (f.diagnosis) setDiagnosis((cur) => cur || f.diagnosis);
      if (f.procedure) setProcedure((cur) => cur || f.procedure);
      if (f.medicines) setMedicines((cur) => cur || f.medicines);
      const extra = [f.complaints, f.anamnesis, f.objective, f.recommendations]
        .filter(Boolean).join("\n");
      if (extra) setNotes((cur) => (cur ? `${cur}\n${extra}` : extra));
      // "referral" alohida dialog orqali bo'ladi — bu yerda tanlanmaydi
      if (res.next_step && res.next_step !== "referral") setNextStep(res.next_step);

      // Yo'nalishga xos maydonlar. Sxema serverdan keladi (shablonlar
      // yagona manbada), qiymatlar diktantdan.
      const schema = res.specialty_schema || [];
      if (schema.length) {
        setSpecialtySchema(schema);
        setSpecialtyLabel(res.specialty_label || null);
        setSpecialtyKey(res.specialty || null);
        const sv = res.specialty_fields || {};
        setSpecialtyValues((cur) => {
          const next = { ...cur };
          for (const fld of schema) {
            const v = sv[fld.key];
            if (v === undefined || v === null || v === '') continue;
            if (String(next[fld.key] ?? '').trim()) continue;   // qo'lda yozilgan
            // Obyekt tipidagi maydon (masalan tuxumdonlar: {right, left})
            // o'qilishi uchun "kalit: qiymat" satrlariga yoyiladi.
            next[fld.key] = typeof v === 'object'
              ? Object.entries(v as Record<string, unknown>)
                  .map(([k, val]) => `${k}: ${val}`).join('\n')
              : String(v);
          }
          return next;
        });
      }

      if (res.note) toast.warning(res.note);
      else if (res.structured) toast.success("Diktant maydonlarga ajratildi — tekshirib tasdiqlang");
      else toast.info("Matn olindi, maydonlarni qo'lda to'ldiring");
    } catch {
      toast.error("Ovozni yuborishda xatolik");
    } finally {
      setVoiceBusy(false);
    }
  }

  // Shu bemorning oxirgi 30 kunlik boshqa doktorlar xulosalari
  const { data: priorData } = useQuery({
    queryKey: ["prior-visits", item?.id],
    enabled: !!item?.id,
    queryFn: async () => {
      const res = await api.get<{ prior: PriorVisit[] }>(`/api/doctor/visit/${item!.id}/prior`);
      return res.success ? res : { prior: [] };
    },
  });
  const prior = priorData?.prior ?? [];

  const complete = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("Bron topilmadi");
      const body: Record<string, unknown> = {
        diagnosis, procedure, medicines, notes,
        next_step: nextStep,
      };
      // Yo'nalishga xos maydonlar (bo'sh bo'lmaganlari) — data_json ga
      const specData = Object.fromEntries(
        Object.entries(specialtyValues).filter(([, v]) => String(v ?? '').trim())
      );
      if (Object.keys(specData).length) {
        body.specialty_data = specData;
        if (specialtyKey) body.specialty = specialtyKey;
      }
      if (nextStep === "labs" && labTypes.length) body.lab_types = labTypes;
      if (nextStep === "admission") {
        body.admission_reason = admissionReason || diagnosis;
        body.admission_department = admissionDepartment;
      }
      const res = await api.post<{
        consultation_id: string;
        lab_orders?: { id: string; test_type: string }[];
      }>(`/api/doctor/visit/${item.id}/complete`, body);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      let msg = "Ko'rik yakunlandi — kartaga yozildi";
      const created = res.lab_orders?.length || 0;
      if (nextStep === "labs" && created) {
        msg = `Ko'rik yakunlandi + ${created} ta tekshiruv buyuruldi (bemor kassaga)`;
      } else if (nextStep === "admission") {
        msg = "Ko'rik yakunlandi. Bemor statsionar navbatiga qo'yildi";
      }
      toast.success(msg);
      setDiagnosis(""); setProcedure(""); setMedicines(""); setNotes("");
      setNextStep("home"); setLabTypes([]); setAdmissionReason(""); setAdmissionDepartment("");
      setSpecialtySchema([]); setSpecialtyValues({}); setSpecialtyKey(null);
      onCompleted();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Xatolik"),
  });

  const open = !!item;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton>
        <DialogHeader>
          <DialogTitle>Ko&apos;rikni yakunlash</DialogTitle>
          <DialogDescription>
            Yozuv bemor kartasiga tushadi va bron yakunlangan deb belgilanadi.
          </DialogDescription>
        </DialogHeader>

        {item && (
          <div className="space-y-4">
            {/* Bemor kartochkasi */}
            <div className="rounded-lg border border-border/60 p-3 bg-muted/30">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{item.patient_name}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
                    {item.medical_record_number && <span className="font-mono">{item.medical_record_number}</span>}
                    {item.phone && <span className="flex items-center gap-1"><Phone className="size-3" />{item.phone}</span>}
                    {(item.district || item.address) && (
                      <span className="flex items-center gap-1"><MapPin className="size-3" />{[item.district, item.address].filter(Boolean).join(", ")}</span>
                    )}
                  </div>
                  {item.service_name && (
                    <p className="text-xs text-muted-foreground mt-1">Xizmat: <span className="text-foreground">{item.service_name}</span></p>
                  )}
                  {item.notes && (
                    <p className="text-xs text-muted-foreground mt-1">Izoh: {item.notes}</p>
                  )}
                </div>
                {item.patient_id && (
                  <Link href={`/patients/${item.patient_id}`} target="_blank"
                        className="text-xs text-primary hover:underline shrink-0">
                    Istoriya →
                  </Link>
                )}
              </div>
            </div>

            {/* Yo'naltirilgan bo'lsa — kim yubordi + darrov ko'rinuvchi 1-doktor xulosasi */}
            {item.forwarded_from_doctor_name && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Share2 className="size-4 text-amber-600" />
                  <span>
                    <strong>{item.forwarded_from_doctor_name.trim()}</strong>
                    {item.forwarded_from_doctor_spec && <span className="text-muted-foreground"> ({item.forwarded_from_doctor_spec})</span>}
                    {" tomonidan yuborilgan"}
                  </span>
                </div>
              </div>
            )}

            {/* Oldingi doktorlar xulosalari — 2-doktor shu tufayli 1-doktor natijasini darrov ko'radi */}
            {prior.length > 0 && (
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Stethoscope className="size-4 text-primary" />
                  <span className="text-sm font-medium">Oldingi doktorlar xulosalari</span>
                  <Badge variant="secondary" className="text-[10px]">{prior.length}</Badge>
                </div>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {prior.map((p) => (
                    <div key={p.id} className="rounded border border-border/40 bg-background/60 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-medium">
                          {p.doctor_name}
                          {p.doctor_spec && <span className="text-muted-foreground"> · {p.doctor_spec}</span>}
                        </span>
                        <span className="text-muted-foreground">
                          {new Date(p.created_at).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {p.service_name && (
                        <p className="text-muted-foreground">{p.service_name}</p>
                      )}
                      {p.diagnosis && (
                        <p className="mt-1"><span className="text-muted-foreground">Tashxis: </span>{p.diagnosis}</p>
                      )}
                      {p.procedure && (
                        <p><span className="text-muted-foreground">Muolaja: </span>{p.procedure}</p>
                      )}
                      {p.medicines && (
                        <p><span className="text-muted-foreground">Dorilar: </span>{p.medicines}</p>
                      )}
                      {p.notes && (
                        <p className="text-muted-foreground italic mt-1">{p.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── OVOZLI KO'RIK ──
                Shifokor natijani gapiradi; STT matnga o'giradi, `visit-scribe`
                agenti maydonlarga ajratadi. Natija TAKLIF — shifokor
                tahrirlab tasdiqlaydi, avtomatik saqlanmaydi. */}
            <div className="rounded-lg border border-primary/25 bg-primary/[0.04] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Mic className="size-4 text-primary" />
                  <span className="text-sm font-medium">Ovozli ko&apos;rik</span>
                </div>
                <div className="flex items-center gap-2">
                  <select value={voiceLang} onChange={(e) => setVoiceLang(e.target.value as "uz" | "ru")}
                    disabled={recording || voiceBusy}
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs">
                    <option value="uz">O&apos;zbekcha</option>
                    <option value="ru">Ruscha</option>
                  </select>
                  <Button type="button" size="sm" disabled={voiceBusy}
                    variant={recording ? "destructive" : "secondary"}
                    onClick={recording ? stopVoice : startVoice}>
                    {voiceBusy ? (
                      <><Loader2 className="size-4 animate-spin" /> Tahlil…</>
                    ) : recording ? (
                      <><Square className="size-4" /> To&apos;xtatish</>
                    ) : (
                      <><Mic className="size-4" /> Yozishni boshlash</>
                    )}
                  </Button>
                </div>
              </div>
              {recording && (
                <p className="text-xs text-destructive">
                  Yozilmoqda… Ko&apos;rik natijasini gapiring, tugagach &quot;To&apos;xtatish&quot;ni bosing.
                </p>
              )}
              {transcript && (
                <div className="rounded-md bg-background/70 p-2">
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">Diktant matni</p>
                  <p className="text-xs whitespace-pre-wrap">{transcript}</p>
                </div>
              )}
            </div>

            {/* Xulosa maydonlari */}
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label>Tashxis</Label>
                <Textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={2} placeholder="Klinik tashxis" />
              </div>
              <div className="space-y-1.5">
                <Label>Muolaja / protsedura</Label>
                <Input value={procedure} onChange={(e) => setProcedure(e.target.value)} placeholder="Bajarilgan muolaja" />
              </div>
              <div className="space-y-1.5">
                <Label>Buyurilgan dorilar</Label>
                <Textarea value={medicines} onChange={(e) => setMedicines(e.target.value)} rows={2} placeholder="Dori, doza, davomiylik" />
              </div>
              <div className="space-y-1.5">
                <Label>Qo&apos;shimcha izoh</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Rejim, kuzatuv, keyingi tashrif" />
              </div>
            </div>

            {/* ── YO'NALISHGA XOS MAYDONLAR ──
                Shifokor yo'nalishiga qarab diktantdan keyin paydo bo'ladi:
                reproduktologda sikl/tuxumdon/gormonlar, urologda
                buyrak/prostata. Sxema serverdan keladi, ya'ni shablonlar
                yagona manbada (ai/protocols/medical-skills.js) turadi va
                bu yerda takrorlanmaydi. */}
            {specialtySchema.length > 0 && (
              <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/[0.03] p-3">
                <div className="flex items-center gap-2">
                  <Stethoscope className="size-4 text-primary" />
                  <span className="text-sm font-medium">
                    {specialtyLabel || "Yo'nalish maydonlari"}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {specialtySchema.length}
                  </Badge>
                </div>
                <div className="grid gap-3">
                  {specialtySchema.map((f) => (
                    <div key={f.key} className="space-y-1.5">
                      <Label className="text-xs">
                        {f.icon ? `${f.icon} ` : ""}{f.label}
                      </Label>
                      <Textarea
                        rows={f.type === "object" || f.type === "table" ? 3 : 2}
                        value={specialtyValues[f.key] ?? ""}
                        onChange={(e) =>
                          setSpecialtyValues((cur) => ({ ...cur, [f.key]: e.target.value }))}
                        placeholder={f.label}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Bu maydonlar bemor kartasiga yo&apos;nalish bo&apos;yicha alohida saqlanadi.
                </p>
              </div>
            )}

            {/* Keyingi qadam — bemor keyin qayoqqa boradi */}
            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <Label className="text-sm">Keyingi qadam</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { v: "home",      label: "Uyga",           icon: "🏠" },
                  { v: "labs",      label: "Tekshiruvlar",   icon: "🧪" },
                  { v: "admission", label: "Yotqizish",      icon: "🛏" },
                ].map((o) => (
                  <button key={o.v} type="button"
                    onClick={() => setNextStep(o.v as typeof nextStep)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm font-medium",
                      nextStep === o.v ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground",
                    )}>
                    <span className="mr-1">{o.icon}</span>{o.label}
                  </button>
                ))}
              </div>

              {nextStep === "labs" && (
                <div className="pt-2">
                  <Label className="text-xs text-muted-foreground">Tekshiruv turlarini tanlang — bemor kassaga boradi, so&apos;ng laborantga</Label>
                  <div className="grid grid-cols-2 gap-1.5 mt-2">
                    {[
                      { v: "blood_general", label: "Umumiy qon" },
                      { v: "urine_general", label: "Peshob tahlili" },
                      { v: "biochemistry",  label: "Bioximik tahlil" },
                      { v: "coagulogram",   label: "Koagulogramma" },
                      { v: "ekg",           label: "EKG" },
                      { v: "xray",          label: "Rentgen" },
                      { v: "ultrasound",    label: "UZI" },
                      { v: "egds",          label: "EFGDS" },
                      { v: "ct_mri",        label: "MSKT/MRT" },
                      { v: "consult",       label: "Mutaxassis" },
                    ].map((o) => {
                      const on = labTypes.includes(o.v);
                      return (
                        <button key={o.v} type="button"
                          onClick={() => setLabTypes((cur) => on ? cur.filter((x) => x !== o.v) : [...cur, o.v])}
                          className={cn(
                            "rounded-md border px-2 py-1.5 text-xs text-left",
                            on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
                          )}>
                          {on ? "☑ " : "☐ "}{o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {nextStep === "admission" && (
                <div className="pt-2 grid gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Yotqizish sababi</Label>
                    <Input value={admissionReason} onChange={(e) => setAdmissionReason(e.target.value)}
                           placeholder="Tashxis yoki holat" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Bo&apos;lim</Label>
                    <Select value={admissionDepartment || undefined} onValueChange={(v) => v && setAdmissionDepartment(v)}>
                      <SelectTrigger><SelectValue placeholder="Bo'lim (statsionar qabuli)" /></SelectTrigger>
                      <SelectContent>
                        {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Bemor <strong>statsionar tayyorlash</strong> navbatiga qo&apos;yiladi.
                    Palata xaritasida ko&apos;rinadi.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="border-t border-border/50 pt-4 gap-2 flex-wrap sm:justify-between">
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => item && onReferral(item)} disabled={!item}>
              <Share2 className="size-4" /> Bo&apos;limga yo&apos;llanma
            </Button>
            <Button variant="outline" size="sm" onClick={() => item && onForward(item)} disabled={!item}>
              <ArrowRight className="size-4" /> Boshqa shifokorga
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Bekor qilish</Button>
            <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
              {complete.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Yakunlash
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Yo'llanma dialogi: bo'lim yoki shifokor tanlash ──
function ReferralDialog({
  item, onClose, onSent,
}: {
  item: QueueItem | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [toKind, setToKind] = useState<"department" | "doctor">("department");
  const [department, setDepartment] = useState<string>("");
  const [toDoctorId, setToDoctorId] = useState<string>("");
  const [serviceRequired, setServiceRequired] = useState("");
  const [notes, setNotes] = useState("");

  const { data: docData } = useQuery({
    queryKey: ["doctors-list-for-referral"],
    enabled: !!item,
    queryFn: async () => {
      const res = await api.get<{ doctors: DoctorLite[] }>("/api/doctors");
      return res.success ? res : { doctors: [] };
    },
  });
  const doctors = useMemo(() => docData?.doctors ?? [], [docData]);

  const send = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("Bemor tanlanmagan");
      if (!serviceRequired.trim()) throw new Error("Nima uchun yo'llanayotganini yozing");
      const body: Record<string, unknown> = {
        service_required: serviceRequired.trim(),
        notes: notes.trim() || undefined,
      };
      if (item.patient_id) body.patient_id = item.patient_id;
      else body.patient_name = item.patient_name;

      if (toKind === "department") {
        if (!department) throw new Error("Bo'limni tanlang");
        body.to_department = department;
      } else {
        if (!toDoctorId) throw new Error("Shifokorni tanlang");
        body.to_doctor_id = toDoctorId;
      }
      const res = await api.post("/api/doctor/referral", body);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Yo'llanma yuborildi");
      setDepartment(""); setToDoctorId(""); setServiceRequired(""); setNotes("");
      onSent();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Xatolik"),
  });

  const open = !!item;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Ichki yo&apos;llanma</DialogTitle>
          <DialogDescription>
            {item?.patient_name} — boshqa bo&apos;lim yoki shifokorga jo&apos;natish
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setToKind("department")}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-sm font-medium",
                toKind === "department" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
              )}
            >
              Bo&apos;limga
            </button>
            <button
              type="button"
              onClick={() => setToKind("doctor")}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-sm font-medium",
                toKind === "doctor" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
              )}
            >
              Shifokorga
            </button>
          </div>

          {toKind === "department" ? (
            <div className="space-y-1.5">
              <Label>Bo&apos;lim *</Label>
              <Select value={department || undefined} onValueChange={(v) => v && setDepartment(v)}>
                <SelectTrigger><SelectValue placeholder="Bo'limni tanlang" /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Shifokor *</Label>
              <Select value={toDoctorId || undefined} onValueChange={(v) => v && setToDoctorId(v)}>
                <SelectTrigger><SelectValue placeholder="Shifokorni tanlang" /></SelectTrigger>
                <SelectContent>
                  {doctors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.first_name} {d.last_name || ""} {d.specialty ? `· ${d.specialty}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Nima uchun *</Label>
            <Input value={serviceRequired} onChange={(e) => setServiceRequired(e.target.value)}
                   placeholder="Masalan: UZI, konsultatsiya, tug'ruq qabuli" />
          </div>

          <div className="space-y-1.5">
            <Label>Izoh</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                      placeholder="Zarur ma'lumot yoki tashxis konteksti" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor qilish</Button>
          <Button onClick={() => send.mutate()} disabled={send.isPending}>
            {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
            Yuborish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// buttonVariants — hozircha ishlatilmayapti, lekin keyinchalik ba'zi link'lar
// buttonstyled bo'lsa qo'shib qo'yishga qulay. Lint agar shikoyat qilsa olib tashlanadi.
void buttonVariants;

// ── Boshqa shifokorga yo'naltirish dialogi ──
// Doktor tanlaydi + xizmat tanlaydi → yangi appointment (pending payment) yaratiladi.
// Bemor kassaga jo'natiladi (access_code beriladi). To'lovdan keyin 2-doktor
// navbatida ko'rinadi va uning ko'rik dialogida 1-doktor xulosasi darrov ochiladi.
function ForwardDialog({
  item, onClose, onSent,
}: {
  item: QueueItem | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [toDoctorId, setToDoctorId] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [notes, setNotes] = useState("");

  interface ServiceLite { id: string; name: string; price: number; category?: string }
  const { data: docData } = useQuery({
    queryKey: ["doctors-list-for-forward"],
    enabled: !!item,
    queryFn: async () => {
      const res = await api.get<{ doctors: DoctorLite[] }>("/api/doctors");
      return res.success ? res : { doctors: [] };
    },
  });
  const doctors = docData?.doctors ?? [];

  const { data: svcData } = useQuery({
    queryKey: ["services-list-for-forward"],
    enabled: !!item,
    queryFn: async () => {
      const res = await api.get<{ services: ServiceLite[] }>("/api/services");
      return res.success ? res : { services: [] };
    },
  });
  const services = svcData?.services ?? [];

  const forward = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("Bemor tanlanmagan");
      if (!toDoctorId) throw new Error("Shifokorni tanlang");
      if (!serviceId) throw new Error("Xizmatni tanlang");
      const res = await api.post<{
        appointment: { access_code: string; amount: number };
        message: string;
      }>(`/api/doctor/visit/${item.id}/forward`, {
        to_doctor_id: toDoctorId,
        service_id: serviceId,
        notes: notes.trim() || undefined,
        payment_method: "cashier",
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      toast.success(res.message || `Kassaga yuborildi — kod: ${res.appointment.access_code}`, {
        description: `To'lov summasi: ${fmtSum(res.appointment.amount)}`,
      });
      setToDoctorId(""); setServiceId(""); setNotes("");
      onSent();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Xatolik"),
  });

  const open = !!item;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Boshqa shifokorga yo&apos;naltirish</DialogTitle>
          <DialogDescription>
            {item?.patient_name} — bemor kassaga jo&apos;natiladi. To&apos;lovdan keyin
            tanlangan shifokor navbatida ko&apos;rinadi va sizning xulosangiz ochiq bo&apos;ladi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Shifokor *</Label>
            <Select value={toDoctorId || undefined} onValueChange={(v) => v && setToDoctorId(v)}>
              <SelectTrigger><SelectValue placeholder="Shifokorni tanlang" /></SelectTrigger>
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
            <Label>Xizmat (kassaga hisob) *</Label>
            <Select value={serviceId || undefined} onValueChange={(v) => v && setServiceId(v)}>
              <SelectTrigger><SelectValue placeholder="Xizmatni tanlang" /></SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} · {fmtSum(s.price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Izoh (ixtiyoriy)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                      placeholder="2-doktor uchun qisqa maslahat, konteks" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor qilish</Button>
          <Button onClick={() => forward.mutate()} disabled={forward.isPending}>
            {forward.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            Kassaga yuborish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
