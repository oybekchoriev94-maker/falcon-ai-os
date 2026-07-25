"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Mic,
  Square,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  HeartPulse,
  FileText,
  Users,
  ClipboardList,
  RefreshCw,
  Phone,
  CalendarDays,
  Stethoscope,
  Building2,
  AlarmClock,
  NotebookPen,
  Sparkles,
  ArrowRight,
  RotateCcw,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

/* ─── Types ─── */

interface VoiceExtraction {
  patient_name: string;
  phone: string;
  doctor_specialty: string;
  department: string;
  preferred_time: string;
  notes: string;
}

interface VoiceRegisterResponse {
  success: boolean;
  extraction: VoiceExtraction;
  transcript: string;
}

interface QueueItem {
  id: number;
  patient_name: string;
  doctor_name: string;
  department: string;
  status: "waiting" | "in_progress" | "completed" | "cancelled";
  appointment_time: string;
  notes?: string;
  created_at: string;
}

interface QueuesResponse {
  queues: QueueItem[];
}

type AppState = "idle" | "recording" | "processing" | "success" | "error";

type StatusType = QueueItem["status"];

/* ─── Constants ─── */

const STATUS_CONFIG: Record<StatusType, { label: string; color: string }> = {
  waiting: {
    label: "Kutilmoqda",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  in_progress: {
    label: "Qabulda",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  },
  completed: {
    label: "Yakunlangan",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  cancelled: {
    label: "Bekor qilingan",
    color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  },
};

const DEPARTMENTS = [
  "Terapiya",
  "Kardiologiya",
  "Nevrologiya",
  "Pediatriya",
  "Xirurgiya",
  "Ortopediya",
  "Stomatologiya",
  "Oftalmologiya",
  "Lor",
  "Boshqa",
];

const APP_STATE_BADGE: Record<
  AppState,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  idle: { label: "Tayyor", variant: "secondary" },
  recording: { label: "Yozilmoqda", variant: "destructive" },
  processing: { label: "Tahlil qilinmoqda", variant: "outline" },
  success: { label: "\u2705 Tahlil yakunlandi", variant: "default" },
  error: { label: "Xatolik", variant: "destructive" },
};

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 24 },
  },
};

/* ─── Helpers ─── */

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("uz-UZ", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("uz-UZ", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "";
  }
}

function formatTimer(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function todayDate() {
  return new Date().toISOString().split("T")[0];
}

/* ─── Waveform ─── */

const BAR_COUNT = 24;

function Waveform() {
  return (
    <div className="flex items-end justify-center gap-[3px] h-10">
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-destructive/70 dark:bg-destructive/60"
          animate={{
            height: [
              "4px",
              `${4 + Math.random() * 28}px`,
              "4px",
              `${4 + Math.random() * 20}px`,
              "4px",
            ],
          }}
          transition={{
            duration: 0.6 + Math.random() * 0.4,
            repeat: Infinity,
            delay: i * 0.06,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

/* ─── Mic Button ─── */

function MicButton({
  state,
  onClick,
  disabled,
}: {
  state: AppState;
  onClick: () => void;
  disabled: boolean;
}) {
  const isRecording = state === "recording";
  const isProcessing = state === "processing";
  const isSuccess = state === "success";

  return (
    <div className="relative flex items-center justify-center">
      <AnimatePresence>
        {isRecording && (
          <>
            <motion.span
              key="ring-outer"
              className="absolute inset-0 rounded-full border-2 border-destructive/25"
              animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.span
              key="ring-inner"
              className="absolute inset-0 rounded-full border-2 border-destructive/15"
              animate={{ scale: [1, 1.55, 1], opacity: [0.3, 0, 0.3] }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 0.35,
              }}
            />
          </>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`relative z-10 flex items-center justify-center rounded-full transition-shadow duration-300 ${
          isRecording
            ? "bg-destructive text-destructive-foreground shadow-[0_0_32px_8px] shadow-destructive/25"
            : isSuccess
              ? "bg-emerald-500 text-white shadow-[0_0_32px_8px] shadow-emerald-500/25"
              : "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30"
        }`}
        style={{ width: 88, height: 88 }}
        whileHover={!disabled ? { scale: 1.06 } : undefined}
        whileTap={!disabled ? { scale: 0.93 } : undefined}
      >
        <AnimatePresence mode="wait">
          {isProcessing ? (
            <motion.div
              key="spinner"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Loader2 className="size-8 animate-spin" />
            </motion.div>
          ) : isSuccess ? (
            <motion.div
              key="check"
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 90 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <CheckCircle2 className="size-8" />
            </motion.div>
          ) : isRecording ? (
            <motion.div
              key="stop"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Square className="size-6 fill-current" />
            </motion.div>
          ) : (
            <motion.div
              key="mic"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Mic className="size-8" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}

/* ─── Main Page ─── */

export default function ScribePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  /* State */
  const [appState, setAppState] = useState<AppState>("idle");
  const [timer, setTimer] = useState(0);
  const [extraction, setExtraction] = useState<VoiceExtraction | null>(null);
  const [transcript, setTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  /* Form fields pre-filled by AI */
  const [formPatient, setFormPatient] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formDoctor, setFormDoctor] = useState("");
  const [formDept, setFormDept] = useState("");
  const [formDate, setFormDate] = useState(todayDate);
  const [formTime, setFormTime] = useState("");
  const [formNotes, setFormNotes] = useState("");
  // Diktant tili — model avto-aniqlay olmaydi, shuning uchun aniq tanlanadi
  const [sttLanguage, setSttLanguage] = useState<"uz" | "ru">("uz");

  /* Refs */
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Queries ── */

  const {
    data: queuesData,
    isLoading: queuesLoading,
    isError: queuesError,
    refetch: refetchQueues,
    isFetching: queuesFetching,
  } = useQuery({
    queryKey: ["queues"],
    queryFn: async () => {
      const res = await api.get<QueuesResponse>("/api/voice/queues");
      if (res.success) return res;
      throw new Error(res.error);
    },
    refetchInterval: 30_000,
  });

  const queues = queuesData?.queues ?? [];

  /* ── Mutations ── */

  const uploadMutation = useMutation({
    mutationFn: async (audioBlob: Blob) => {
      const fd = new FormData();
      fd.append("audio", audioBlob, "recording.webm");
      fd.append("language", sttLanguage);
      const res = await api.upload<VoiceRegisterResponse>(
        "/api/reception/voice-register",
        fd
      );
      if (!res.success) throw new Error((res as { error: string }).error);
      return res as unknown as VoiceRegisterResponse;
    },
    onSuccess: (data) => {
      setExtraction(data.extraction);
      setTranscript(data.transcript);
      setFormPatient(data.extraction.patient_name || "");
      setFormPhone(data.extraction.phone || "");
      setFormDoctor(data.extraction.doctor_specialty || "");
      setFormDept(
        DEPARTMENTS.includes(data.extraction.department)
          ? data.extraction.department
          : ""
      );
      setFormTime(data.extraction.preferred_time || "");
      setFormNotes(data.extraction.notes || "");
      setAppState("success");
      toast.success("Ovoz tahlil qilindi", {
        description: "Bemor ma'lumotlari avtomatik to'ldirildi",
      });
    },
    onError: (err: Error) => {
      setErrorMsg(err.message || "Server bilan bog'lanib bo'lmadi");
      setAppState("error");
      toast.error("Tahlilda xatolik", { description: err.message });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const appointmentTime = `${formDate}T${formTime || "09:00"}`;
      const res = await api.post("/api/reception/confirm", {
        patient_name: formPatient.trim(),
        doctor_name: formDoctor.trim(),
        phone: formPhone.trim(),
        department: formDept,
        appointment_time: appointmentTime,
        notes: formNotes.trim() || undefined,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Navbatga qo'shildi", {
        description: "Bemor muvaffaqiyatli navbatga qo'shildi",
      });
      queryClient.invalidateQueries({ queryKey: ["queues"] });
      handleReset();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Xatolik yuz berdi");
    },
  });

  /* ── Recording Logic ── */

  const cleanupMedia = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return () => cleanupMedia();
  }, [cleanupMedia]);

  const startRecording = useCallback(async () => {
    try {
      setErrorMsg("");
      setTimer(0);
      setAppState("recording");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size < 100) {
          toast.error("Ovoz juda qisqa, qaytadan urinib ko'ring");
          setAppState("idle");
          cleanupMedia();
          return;
        }
        setAppState("processing");
        uploadMutation.mutate(blob);
      };

      recorder.onerror = () => {
        toast.error("Yozishda xatolik yuz berdi");
        setAppState("error");
        cleanupMedia();
      };

      recorder.start(250);

      timerRef.current = setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Mikrofonga ruxsat berilmagan"
          : "Mikrofonni ishga tushirib bo'lmadi";
      setErrorMsg(message);
      setAppState("error");
      toast.error(message);
    }
  }, [cleanupMedia, uploadMutation]);

  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const handleMicClick = useCallback(() => {
    if (appState === "recording") {
      stopRecording();
    } else if (appState === "idle" || appState === "error") {
      startRecording();
    }
  }, [appState, startRecording, stopRecording]);

  const handleReset = useCallback(() => {
    cleanupMedia();
    setAppState("idle");
    setTimer(0);
    setExtraction(null);
    setTranscript("");
    setErrorMsg("");
    setFormPatient("");
    setFormPhone("");
    setFormDoctor("");
    setFormDept("");
    setFormDate(todayDate);
    setFormTime("");
    setFormNotes("");
  }, [cleanupMedia]);

  const handleConfirm = useCallback(() => {
    if (!formPatient.trim()) {
      toast.error("Bemor ismini kiriting");
      return;
    }
    if (!formDoctor.trim()) {
      toast.error("Shifokor ismini kiriting");
      return;
    }
    if (!formDept) {
      toast.error("Bo'limni tanlang");
      return;
    }
    confirmMutation.mutate();
  }, [formPatient, formDoctor, formDept, confirmMutation]);

  /* ── Derived ── */

  const micDisabled = appState === "processing";

  const todayQueues = queues.filter((q) => {
    try {
      const qd = new Date(q.created_at);
      const now = new Date();
      return qd.toDateString() === now.toDateString();
    } catch {
      return true;
    }
  });

  /* ── Render ── */

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6 pb-8"
    >
      {/* ── Header ── */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            🎙 AI Registrator
          </h1>
          <p className="text-sm text-muted-foreground">
            Front-Desk AI Scribe — Ovozli bemor qabuli
            {user?.full_name && <> &mdash; {user.full_name}</>}
          </p>
        </div>
        <Badge variant={APP_STATE_BADGE[appState].variant} className="w-fit">
          {appState === "processing" && (
            <Loader2 className="size-3 mr-1 animate-spin" />
          )}
          {APP_STATE_BADGE[appState].label}
        </Badge>
      </motion.div>

      {/* ── Main Grid ── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {/* ── Recording Panel ── */}
        <motion.div variants={itemVariants}>
          <Card className="border-border/50 h-full">
            <CardContent className="flex flex-col items-center justify-center py-10 md:py-14">
              {/* Diktant tili — model avto-aniqlay olmaydi, aniq tanlanadi */}
              <div className="mb-6 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Diktant tili:</span>
                <div className="inline-flex rounded-lg border border-border/60 p-0.5">
                  {(["uz", "ru"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setSttLanguage(lang)}
                      disabled={appState === "recording" || appState === "processing"}
                      className={`px-3 py-1 text-xs rounded-md transition-colors disabled:opacity-50 ${
                        sttLanguage === lang
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {lang === "uz" ? "🇺🇿 O'zbekcha" : "🇷🇺 Ruscha"}
                    </button>
                  ))}
                </div>
              </div>

              <MicButton
                state={appState}
                onClick={handleMicClick}
                disabled={micDisabled}
              />

              {/* Timer */}
              <AnimatePresence mode="wait">
                {appState === "recording" || appState === "processing" ? (
                  <motion.div
                    key="timer"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="mt-5"
                  >
                    <span
                      className={`font-mono text-3xl font-bold tabular-nums tracking-wider ${
                        appState === "recording"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {formatTimer(timer)}
                    </span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="placeholder"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="mt-5 h-9"
                  />
                )}
              </AnimatePresence>

              {/* Waveform */}
              <AnimatePresence>
                {appState === "recording" && (
                  <motion.div
                    key="waveform"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 40 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="mt-4 overflow-hidden"
                  >
                    <Waveform />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Status Text */}
              <p className="mt-4 text-sm text-muted-foreground text-center max-w-xs">
                {appState === "idle" &&
                  "Mikrofon tugmasini bosing va bemor ma'lumotlarini ayting"}
                {appState === "recording" &&
                  "Bemor ma'lumotlarini ayting... To'xtatish uchun tugmani bosing"}
                {appState === "processing" &&
                  "AI ovozni tahlil qilmoqda..."}
                {appState === "success" && "Ma'lumotlar tayyor! Iltimos tekshiring."}
                {appState === "error" && errorMsg}
              </p>

              {/* Transcript hint */}
              {transcript && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 w-full max-w-sm"
                >
                  <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-1 font-medium">
                    Transkript
                  </p>
                  <p className="text-xs text-muted-foreground/80 italic leading-relaxed">
                    &ldquo;{transcript}&rdquo;
                  </p>
                </motion.div>
              )}

              {/* Error retry */}
              {appState === "error" && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4"
                >
                  <Button variant="outline" size="sm" onClick={handleMicClick}>
                    <RotateCcw className="size-3.5" />
                    Qayta urinish
                  </Button>
                </motion.div>
              )}

              {/* Success actions */}
              {appState === "success" && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 flex items-center gap-2"
                >
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    <RotateCcw className="size-3.5" />
                    Yangi yozuv
                  </Button>
                </motion.div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── AI Extraction Panel ── */}
        <motion.div variants={itemVariants}>
          <Card
            className={`border-border/50 h-full transition-opacity duration-500 ${
              appState === "success" ? "opacity-100" : "opacity-40 pointer-events-none"
            }`}
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <CardTitle className="text-sm font-medium">
                  AI ajratib olgan ma'lumotlar
                </CardTitle>
              </div>
              <CardDescription>
                Ma'lumotlarni tekshiring va kerak bo'lsa tahrirlang
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AnimatePresence mode="wait">
                {appState === "success" && extraction ? (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    {/* Patient name */}
                    <div className="space-y-1.5">
                      <Label htmlFor="patient" className="text-xs">
                        <User className="size-3 inline mr-1" />
                        Bemor ismi
                      </Label>
                      <Input
                        id="patient"
                        placeholder="Bemor ismi"
                        value={formPatient}
                        onChange={(e) => setFormPatient(e.target.value)}
                      />
                    </div>

                    {/* Phone */}
                    <div className="space-y-1.5">
                      <Label htmlFor="phone" className="text-xs">
                        <Phone className="size-3 inline mr-1" />
                        Telefon
                      </Label>
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="+998 XX XXX XX XX"
                        value={formPhone}
                        onChange={(e) => setFormPhone(e.target.value)}
                      />
                    </div>

                    {/* Doctor */}
                    <div className="space-y-1.5">
                      <Label htmlFor="doctor" className="text-xs">
                        <Stethoscope className="size-3 inline mr-1" />
                        Shifokor mutaxassisligi
                      </Label>
                      <Input
                        id="doctor"
                        placeholder="Shifokor ismi"
                        value={formDoctor}
                        onChange={(e) => setFormDoctor(e.target.value)}
                      />
                    </div>

                    {/* Department */}
                    <div className="space-y-1.5">
                      <Label htmlFor="dept" className="text-xs">
                        <Building2 className="size-3 inline mr-1" />
                        Bo'lim
                      </Label>
                      <Select value={formDept} onValueChange={(val) => val && setFormDept(val)}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Bo'limni tanlang" />
                        </SelectTrigger>
                        <SelectContent>
                          {DEPARTMENTS.map((dept) => (
                            <SelectItem key={dept} value={dept}>
                              {dept}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Date + Time */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="date" className="text-xs">
                          <CalendarDays className="size-3 inline mr-1" />
                          Sana
                        </Label>
                        <Input
                          id="date"
                          type="date"
                          value={formDate}
                          onChange={(e) => setFormDate(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="time" className="text-xs">
                          <AlarmClock className="size-3 inline mr-1" />
                          Vaqt
                        </Label>
                        <Input
                          id="time"
                          type="time"
                          value={formTime}
                          onChange={(e) => setFormTime(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Notes */}
                    <div className="space-y-1.5">
                      <Label htmlFor="notes" className="text-xs">
                        <NotebookPen className="size-3 inline mr-1" />
                        Izoh
                      </Label>
                      <Textarea
                        id="notes"
                        placeholder="Qo'shimcha ma'lumot"
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                        rows={3}
                      />
                    </div>

                    <Separator className="my-1" />

                    {/* Confirm button */}
                    <Button
                      className="w-full gap-2"
                      size="lg"
                      onClick={handleConfirm}
                      disabled={confirmMutation.isPending}
                    >
                      {confirmMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ArrowRight className="size-4" />
                      )}
                      Navbatga qo'shish
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="placeholder"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center py-12 text-center"
                  >
                    <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
                      <Sparkles className="size-6 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Ovoz yozib oling
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1 max-w-[200px]">
                      Mikrofon tugmasini bosib, bemor ma'lumotlarini ayting. AI avtomatik to'ldiradi.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Today's Queue ── */}
      <motion.div variants={itemVariants}>
        <Card className="border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList className="size-4 text-primary" />
                <CardTitle className="text-sm font-medium">
                  Bugungi navbat
                </CardTitle>
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => refetchQueues()}
                disabled={queuesFetching}
              >
                <RefreshCw
                  className={`size-3 ${queuesFetching ? "animate-spin" : ""}`}
                />
                Yangilash
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {queuesLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : queuesError ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <XCircle className="size-8 text-destructive mb-2" />
                <p className="text-sm font-medium">Ma'lumotlarni yuklashda xatolik</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => refetchQueues()}
                >
                  <RefreshCw className="size-3" />
                  Qayta yuklash
                </Button>
              </div>
            ) : todayQueues.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Users className="size-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">
                  Bugun navbat bo'sh
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Ovozli yozuv orqali bemor qo'shing
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {todayQueues.map((item, index) => {
                  const statusCfg = STATUS_CONFIG[item.status];
                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.04 }}
                    >
                      <div className="group flex items-center gap-3 rounded-lg border border-border/40 bg-card/50 px-3 py-2.5 transition-colors hover:border-border/80 hover:bg-card">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {item.patient_name}
                            </span>
                            <Badge
                              variant="outline"
                              className={`shrink-0 text-[10px] px-1.5 py-0 h-4 ${statusCfg.color}`}
                            >
                              {statusCfg.label}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground/70 mt-0.5">
                            <span className="flex items-center gap-1">
                              <HeartPulse className="size-3" />
                              {item.doctor_name}
                            </span>
                            <span className="flex items-center gap-1">
                              <FileText className="size-3" />
                              {item.department}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" />
                              {formatTime(item.appointment_time)}
                            </span>
                          </div>
                        </div>
                        <span className="text-[11px] text-muted-foreground/50 shrink-0">
                          {formatDate(item.created_at)}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
