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
  FileText,
  Download,
  Stethoscope,
  Keyboard,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

/* ── Types ── */
interface Lang { code: string; label: string; }
interface Field { key: string; label: string; icon?: string; type?: string; }
interface Specialty { key: string; label: string; fields: Field[]; }
interface SpecialtiesResp { languages: Lang[]; specialties: Specialty[]; current?: string | null; }
interface UploadResp {
  transcription: string;
  language: string | null;
  data: Record<string, string>;
  specialization: string;
  report_id?: string;
  pdf_url?: string | null;
}
interface Consultation {
  id: string;
  patient_name: string;
  raw_text?: string;
  data_json?: Record<string, string> | string;
  created_at: string;
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const itemAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function ScribePage() {
  const queryClient = useQueryClient();

  const [lang, setLang] = useState<"uz" | "ru">("uz");
  const [specialty, setSpecialty] = useState<string>("");
  const [patient, setPatient] = useState("");
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [dictText, setDictText] = useState("");

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<UploadResp | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Specialties + languages ── */
  const { data: spec, isLoading: specLoading } = useQuery({
    queryKey: ["scribe-specialties"],
    queryFn: async () => {
      const res = await api.get<SpecialtiesResp>("/api/scribe/specialties");
      if (res.success) return res;
      throw new Error(res.error);
    },
  });

  useEffect(() => {
    if (spec && !specialty) {
      setSpecialty(spec.current || spec.specialties?.[0]?.key || "");
    }
  }, [spec, specialty]);

  const specialties = spec?.specialties ?? [];
  const languages = spec?.languages ?? [{ code: "uz", label: "🇺🇿 O'zbekcha" }, { code: "ru", label: "🇷🇺 Ruscha" }];
  const currentSpec = specialties.find((s) => s.key === specialty) || null;

  /* ── History ── */
  const { data: histData } = useQuery({
    queryKey: ["scribe-history"],
    queryFn: async () => {
      const res = await api.get<{ consultations: Consultation[] }>("/api/scribe/history?limit=10");
      if (res.success) return res;
      throw new Error(res.error);
    },
  });
  const history = histData?.consultations ?? [];

  /* ── Submit (voice or text) ── */
  const submitMutation = useMutation({
    mutationFn: async (audio: Blob | null) => {
      const fd = new FormData();
      if (audio) fd.append("audio", audio, "dictation.webm");
      if (!audio && dictText.trim()) fd.append("raw_text", dictText.trim());
      fd.append("language", lang);
      fd.append("specialty", specialty);
      if (patient.trim()) fd.append("patient_name", patient.trim());
      const res = await api.upload<UploadResp>("/api/scribe/upload", fd);
      if (!res.success) {
        const e = res as { error?: string; code?: string };
        throw new Error(e.code === "UNSUPPORTED_LANGUAGE" ? e.error! : e.error || "Xatolik");
      }
      return res as unknown as UploadResp;
    },
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ["scribe-history"] });
      toast.success("Tibbiy hisobot tayyor", {
        description: res.pdf_url ? "PDF yaratildi" : "Ma'lumot ajratildi",
      });
    },
    onError: (err: Error) => toast.error("Xatolik", { description: err.message }),
  });

  /* ── Recording ── */
  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
        if (blob.size > 0) submitMutation.mutate(blob);
      };
      mr.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("Mikrofonga ruxsat berilmadi", { description: "Brauzer sozlamalaridan mikrofonni yoqing" });
    }
  }
  function stopRec() {
    if (mediaRef.current && mediaRef.current.state === "recording") mediaRef.current.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const busy = submitMutation.isPending;

  function fieldLabel(key: string): string {
    return currentSpec?.fields.find((f) => f.key === key)?.label || key;
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemAnim}>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Stethoscope className="size-6 text-primary" /> AI Scribe — tibbiy diktant
        </h1>
        <p className="text-sm text-muted-foreground">
          Ovoz yoki matn bilan bemor ko&apos;rigini yozing — AI yo&apos;nalishga mos hisobot va PDF tayyorlaydi
        </p>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left: dictation */}
        <motion.div variants={itemAnim} className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              {/* Til + yo'nalish */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Til</Label>
                  <div className="flex gap-1.5">
                    {languages.map((l) => (
                      <button key={l.code} onClick={() => setLang(l.code as "uz" | "ru")}
                        className={`flex-1 rounded-md px-2 py-2 text-sm font-medium ${lang === l.code ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Yo&apos;nalish</Label>
                  {specLoading ? <Skeleton className="h-9 w-full" /> : (
                    <Select value={specialty} onValueChange={(v) => setSpecialty(v ?? "")}>
                      <SelectTrigger>
                        <span data-slot="select-value" className="line-clamp-1 flex-1 text-left">
                          {currentSpec ? currentSpec.label : <span className="text-muted-foreground">Yo&apos;nalish</span>}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {specialties.map((s) => (
                          <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Bemor ismi (ixtiyoriy)</Label>
                <Input value={patient} onChange={(e) => setPatient(e.target.value)} placeholder="Diktantda aytilsa avtomatik aniqlanadi" />
              </div>

              {/* Rejim */}
              <div className="flex gap-2">
                <Button variant={mode === "voice" ? "default" : "outline"} size="sm" onClick={() => setMode("voice")}>
                  <Mic className="size-4" /> Ovoz
                </Button>
                <Button variant={mode === "text" ? "default" : "outline"} size="sm" onClick={() => setMode("text")}>
                  <Keyboard className="size-4" /> Matn
                </Button>
              </div>

              {mode === "voice" ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-6">
                  <button
                    onClick={recording ? stopRec : startRec}
                    disabled={busy || !specialty}
                    className={`flex size-20 items-center justify-center rounded-full transition ${
                      recording ? "animate-pulse bg-rose-500/20 text-rose-500" : "bg-primary/10 text-primary hover:bg-primary/20"
                    } disabled:opacity-50`}>
                    {busy ? <Loader2 className="size-8 animate-spin" /> : recording ? <Square className="size-8" /> : <Mic className="size-9" />}
                  </button>
                  <p className="text-sm text-muted-foreground">
                    {busy ? "Tahlil qilinmoqda... (bir necha soniya)" : recording ? `Yozilmoqda — ${seconds}s (to'xtatish uchun bosing)` : "Diktant qilish uchun bosing"}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Textarea rows={5} value={dictText} onChange={(e) => setDictText(e.target.value)}
                    placeholder="Bemor ko'rigini yozing (o'zbek yoki rus tilida)..." />
                  <Button className="w-full" disabled={busy || !dictText.trim() || !specialty} onClick={() => submitMutation.mutate(null)}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                    Hisobot yaratish
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Result */}
          {result && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">📋 {currentSpec?.label || result.specialization} hisoboti</CardTitle>
                {result.pdf_url && (
                  <a href={`${API_BASE}${result.pdf_url}`} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline"><Download className="size-4" /> PDF</Button>
                  </a>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {result.transcription && (
                  <div className="rounded-lg bg-muted p-3 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">Diktant matni</span>
                    <p className="mt-1">{result.transcription}</p>
                  </div>
                )}
                <div className="space-y-2">
                  {Object.entries(result.data || {})
                    .filter(([, v]) => v && String(v).trim() && String(v).toLowerCase() !== "null")
                    .map(([k, v]) => (
                      <div key={k} className="flex flex-col border-b py-1.5 last:border-0 sm:flex-row sm:gap-3">
                        <span className="w-40 flex-shrink-0 text-sm font-medium text-muted-foreground">{fieldLabel(k)}</span>
                        <span className="text-sm">{String(v)}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </motion.div>

        {/* Right: history */}
        <motion.div variants={itemAnim}>
          <Card>
            <CardHeader><CardTitle className="text-base">Oxirgi diktantlar</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {history.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Hozircha diktant yo&apos;q</p>
              ) : (
                history.map((c) => (
                  <div key={c.id} className="rounded-lg border p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{c.patient_name || "Noma'lum"}</span>
                      <Badge variant="outline" className="text-xs">
                        {new Date(c.created_at).toLocaleDateString("uz-UZ", { day: "numeric", month: "short" })}
                      </Badge>
                    </div>
                    {c.raw_text && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.raw_text}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
