"use client";

// ============================================================
// Hujjat elektronlashtirish (PR #8) — yagona dashboard sahifasi
//
// Uch xil kiritish: rasm (OCR), ovozli diktant (STT), matn.
// AI matndan tuzilgan maydonlarni ajratadi, lekin kartaga
// avtomatik tushmaydi — shifokor tekshirib tasdiqlaydi.
// Xom matn HECH QACHON yo'qolmaydi.
// ============================================================

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  FileText, Image as ImageIcon, Mic, MicOff, Keyboard, Upload,
  RefreshCw, CheckCircle2, XCircle, Loader2, Trash2, Sparkles,
  Square, User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth-store";

const DOC_TYPES = [
  { value: "tibbiy_karta", label: "Tibbiy karta" },
  { value: "xulosa", label: "Xulosa" },
  { value: "retsept", label: "Retsept" },
  { value: "yonaltirma", label: "Yo'naltirma" },
  { value: "shartnoma", label: "Shartnoma" },
  { value: "akt", label: "Akt" },
  { value: "boshqa", label: "Boshqa hujjat" },
] as const;

const DOC_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DOC_TYPES.map((d) => [d.value, d.label])
);

type DocStatus = "pending" | "processing" | "done" | "failed";

interface OcrDocument {
  id: string;
  doc_type: string;
  source: "upload" | "stt" | "text";
  status: DocStatus;
  original_filename: string | null;
  patient_id: string | null;
  patient_name: string | null;
  raw_text: string | null;
  ai_summary: string | null;
  structured: Record<string, unknown> | null;
  review_note: string | null;
  reviewed_at: string | null;
  error: string | null;
  created_at: string;
}

interface PatientRow { id: string; first_name: string; last_name: string | null }

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

function StatusBadge({ status }: { status: DocStatus }) {
  const cfg: Record<DocStatus, { label: string; cls: string }> = {
    pending: { label: "Kutilmoqda", cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
    processing: { label: "Ishlanmoqda", cls: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400" },
    done: { label: "Tayyor", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    failed: { label: "Xato", cls: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400" },
  };
  const c = cfg[status];
  return <Badge variant="outline" className={cn("text-xs", c.cls)}>{c.label}</Badge>;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("uz-UZ", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function HujjatlarPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState("image");
  const [docType, setDocType] = useState("tibbiy_karta");
  const [patientId, setPatientId] = useState("none");
  const [language, setLanguage] = useState("uz");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<OcrDocument | null>(null);

  // Ovoz yozish
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const { data: statusData } = useQuery({
    queryKey: ["ocr-status"],
    queryFn: async () => {
      const res = await api.get<{ engines: { ocr: boolean; stt: boolean; llm: boolean } }>("/api/v1/ocr/status");
      return res.success ? res : null;
    },
  });

  const { data: patientsData } = useQuery({
    queryKey: ["patients-short"],
    queryFn: async () => {
      const res = await api.get<{ patients: PatientRow[] }>("/api/patients");
      return res.success ? res : null;
    },
  });

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ["ocr-documents", statusFilter],
    queryFn: async () => {
      const qs = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await api.get<{ documents: OcrDocument[] }>(`/api/v1/ocr/documents${qs}`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    refetchInterval: 15_000, // processing holati tez o'zgaradi
  });

  const docs = docsData?.documents ?? [];
  const patients = patientsData?.patients ?? [];
  const engines = statusData?.engines;

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        setAudioBlob(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      mediaRef.current = rec;
      setRecording(true);
      setAudioBlob(null);
    } catch {
      toast.error("Mikrofonga ruxsat berilmadi");
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setRecording(false);
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const pid = patientId !== "none" ? patientId : undefined;
      let res;
      if (mode === "image") {
        if (!imageFile) throw new Error("Rasm faylini tanlang");
        const fd = new FormData();
        fd.append("file", imageFile);
        fd.append("doc_type", docType);
        fd.append("language", language);
        if (pid) fd.append("patient_id", pid);
        res = await api.upload<{ document: OcrDocument }>("/api/v1/ocr/documents", fd);
      } else if (mode === "voice") {
        if (!audioBlob) throw new Error("Avval ovoz yozib oling");
        const fd = new FormData();
        fd.append("audio", audioBlob, "diktant.webm");
        fd.append("doc_type", docType);
        fd.append("language", language);
        if (pid) fd.append("patient_id", pid);
        res = await api.upload<{ document: OcrDocument }>("/api/v1/ocr/voice", fd);
      } else {
        if (rawText.trim().length < 3) throw new Error("Matn juda qisqa");
        res = await api.post<{ document: OcrDocument }>("/api/v1/ocr/text", {
          raw_text: rawText, doc_type: docType, language, patient_id: pid,
        });
      }
      if (!res.success) throw new Error(res.error);
      return res as { document: OcrDocument };
    },
    onSuccess: async (data) => {
      toast.success("Hujjat saqlandi — AI tahlili boshlandi");
      setImageFile(null);
      setAudioBlob(null);
      setRawText("");
      queryClient.invalidateQueries({ queryKey: ["ocr-documents"] });
      // OCR + AI ajratmani darhol yurgizamiz (best-effort)
      const proc = await api.post(`/api/v1/ocr/documents/${data.document.id}/process`);
      if (proc.success) queryClient.invalidateQueries({ queryKey: ["ocr-documents"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const processMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/api/v1/ocr/documents/${id}/process`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocr-documents"] });
      setSelected(null);
      toast.success("Hujjat qayta ishlandi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/api/v1/ocr/documents/${id}`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocr-documents"] });
      setSelected(null);
      toast.success("Hujjat o'chirildi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={itemAnim} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hujjat elektronlashtirish</h1>
          <p className="text-sm text-muted-foreground">
            Qog&apos;oz kartalar va hujjatlarni AI yordamida elektron shaklga o&apos;tkazish
          </p>
        </div>
        {engines && (
          <div className="flex items-center gap-2">
            {([
              ["OCR", engines.ocr], ["STT", engines.stt], ["AI", engines.llm],
            ] as const).map(([name, ok]) => (
              <Badge
                key={name}
                variant="outline"
                className={cn(
                  "gap-1.5 text-xs",
                  ok
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
                )}
              >
                <span className={cn("size-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} />
                {name}
              </Badge>
            ))}
          </div>
        )}
      </motion.div>

      {/* ── Yangi hujjat qo'shish ─────────────────────────────── */}
      <motion.div variants={itemAnim}>
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-primary" /> Yangi hujjat
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Hujjat turi</Label>
                <Select value={docType} onValueChange={(v) => { if (v !== null) setDocType(v); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Bemor (ixtiyoriy)</Label>
                <Select value={patientId} onValueChange={(v) => { if (v !== null) setPatientId(v); }}>
                  <SelectTrigger><SelectValue placeholder="Tanlanmagan" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Bog&apos;lanmagan</SelectItem>
                    {patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {[p.first_name, p.last_name].filter(Boolean).join(" ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Til</Label>
                <Select value={language} onValueChange={(v) => { if (v !== null) setLanguage(v); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="uz">O&apos;zbekcha</SelectItem>
                    <SelectItem value="ru">Русский</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Tabs value={mode} onValueChange={(v) => { if (v !== null) setMode(v); }}>
              <TabsList variant="line">
                <TabsTrigger value="image" className="gap-1.5">
                  <ImageIcon className="size-4" /> Rasm (OCR)
                </TabsTrigger>
                <TabsTrigger value="voice" className="gap-1.5">
                  <Mic className="size-4" /> Ovozli diktant
                </TabsTrigger>
                <TabsTrigger value="text" className="gap-1.5">
                  <Keyboard className="size-4" /> Matn
                </TabsTrigger>
              </TabsList>

              <TabsContent value="image" className="pt-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Label
                    htmlFor="ocr-image"
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    <Upload className="size-4" />
                    {imageFile ? imageFile.name : "Rasm faylini tanlang (JPG/PNG)"}
                  </Label>
                  <Input
                    id="ocr-image"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/bmp"
                    className="hidden"
                    onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                  />
                  {imageFile && (
                    <Button variant="ghost" size="sm" onClick={() => setImageFile(null)}>
                      Bekor qilish
                    </Button>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="voice" className="pt-4">
                <div className="flex flex-wrap items-center gap-3">
                  {recording ? (
                    <Button variant="destructive" onClick={stopRecording}>
                      <Square className="size-4" /> To&apos;xtatish
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={startRecording}>
                      <Mic className="size-4" /> Yozishni boshlash
                    </Button>
                  )}
                  {recording && (
                    <span className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                      <MicOff className="size-4" /> Yozilmoqda...
                    </span>
                  )}
                  {audioBlob && !recording && (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      Diktant tayyor ({Math.round(audioBlob.size / 1024)} KB)
                    </Badge>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="text" className="pt-4">
                <Textarea
                  rows={5}
                  placeholder="Hujjat matnini shu yerga yozing yoki ko'chirib qo'ying..."
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                />
              </TabsContent>
            </Tabs>

            <div className="flex justify-end">
              <Button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending
                  ? <><Loader2 className="size-4 animate-spin" /> Saqlanmoqda...</>
                  : <><FileText className="size-4" /> Hujjatni saqlash</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Hujjatlar ro'yxati ─────────────────────────────────── */}
      <motion.div variants={itemAnim}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <FileText className="size-4 text-primary" /> Hujjatlar ({docs.length})
              </CardTitle>
              <Select value={statusFilter} onValueChange={(v) => { if (v !== null) setStatusFilter(v); }}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hammasi</SelectItem>
                  <SelectItem value="pending">Kutilmoqda</SelectItem>
                  <SelectItem value="processing">Ishlanmoqda</SelectItem>
                  <SelectItem value="done">Tayyor</SelectItem>
                  <SelectItem value="failed">Xato</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {docsLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : !docs.length ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <FileText className="mb-3 size-12 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">Hali hujjat yo&apos;q</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Yuqoridagi shakl orqali birinchi hujjatni qo&apos;shing
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {docs.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelected(d)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="size-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {DOC_TYPE_LABEL[d.doc_type] || d.doc_type}
                        </span>
                        {d.reviewed_at && (
                          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <User className="size-3" />
                        {d.patient_name || "Bog'lanmagan"}
                        <span>·</span>
                        {fmtDate(d.created_at)}
                        {d.original_filename && d.source === "upload" && (
                          <><span>·</span><span className="truncate">{d.original_filename}</span></>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={d.status} />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <DocDetailDialog
        doc={selected}
        canDelete={user?.role === "ceo" || user?.role === "admin"}
        onClose={() => setSelected(null)}
        onProcess={(id) => processMutation.mutate(id)}
        onDelete={(id) => deleteMutation.mutate(id)}
        busy={processMutation.isPending || deleteMutation.isPending}
      />
    </motion.div>
  );
}

// ============================================================
// Hujjat tafsilotlari: matn, AI ajratma, tuzatish va tasdiq
// ============================================================

function DocDetailDialog({
  doc, canDelete, onClose, onProcess, onDelete, busy,
}: {
  doc: OcrDocument | null;
  canDelete: boolean;
  onClose: () => void;
  onProcess: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const queryClient = useQueryClient();
  const [editText, setEditText] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const res = await api.patch(`/api/v1/ocr/documents/${doc!.id}`, {
        ...(editText !== null && editText !== doc!.raw_text ? { raw_text: editText } : {}),
        review_note: reviewNote || null,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocr-documents"] });
      onClose();
      toast.success("Hujjat tasdiqlandi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const structured = doc?.structured && typeof doc.structured === "object"
    ? Object.entries(doc.structured).filter(([k, v]) => k !== "summary" && v != null && v !== "")
    : [];

  return (
    <Dialog
      open={!!doc}
      onOpenChange={(v) => {
        if (!v) { onClose(); setEditText(null); setReviewNote(""); }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {doc && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle>{DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type}</DialogTitle>
                <StatusBadge status={doc.status} />
              </div>
              <DialogDescription>
                {doc.patient_name ? `Bemor: ${doc.patient_name}` : "Bemor bilan bog'lanmagan"}
                {" · "}
                {fmtDate(doc.created_at)}
                {doc.reviewed_at && " · Tekshirib tasdiqlangan"}
              </DialogDescription>
            </DialogHeader>

            {doc.error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                <XCircle className="size-4 shrink-0" /> {doc.error}
              </div>
            )}

            {doc.ai_summary && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Sparkles className="size-3.5" /> AI xulosasi
                </div>
                <p className="text-sm">{doc.ai_summary}</p>
              </div>
            )}

            {structured.length > 0 && (
              <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                {structured.map(([k, v]) => (
                  <div key={k} className="text-sm">
                    <div className="text-xs text-muted-foreground">{k}</div>
                    <div className="font-medium">{String(v)}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-2">
              <Label>Xom matn {doc.source === "upload" && "(OCR)"}</Label>
              <Textarea
                rows={7}
                value={editText ?? doc.raw_text ?? ""}
                onChange={(e) => setEditText(e.target.value)}
                placeholder="Matn hali olinmagan — 'Qayta ishlash' tugmasini bosing"
              />
            </div>

            <div className="grid gap-2">
              <Label>Shifokor izohi (tasdiqlashda)</Label>
              <Input
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Masalan: AI ajratma tekshirildi, FIO tuzatildi"
              />
            </div>

            <DialogFooter className="flex-wrap gap-2">
              {canDelete && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => onDelete(doc.id)}
                  disabled={busy}
                >
                  <Trash2 className="size-4" /> O&apos;chirish
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => onProcess(doc.id)}
                disabled={busy}
              >
                <RefreshCw className={cn("size-4", busy && "animate-spin")} /> Qayta ishlash
              </Button>
              <Button
                onClick={() => reviewMutation.mutate()}
                disabled={reviewMutation.isPending || busy}
              >
                <CheckCircle2 className="size-4" />
                {reviewMutation.isPending ? "Saqlanmoqda..." : "Tasdiqlash"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
