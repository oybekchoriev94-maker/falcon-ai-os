"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Building2, BedDouble, ArrowLeft, Phone, Mic, Square, Loader2,
  FolderOpen, Stethoscope, Save, ThermometerSun, Activity, HeartPulse,
  Pill, CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Bed {
  id: string;
  ward_id: string;
  bed_number: string;
  bed_type: string;
  status: "free" | "occupied" | "maintenance" | string;
  admission_id: string | null;
  patient_id: string | null;
  patient_name: string | null;
  admission_date: string | null;
  diagnosis_initial: string | null;
  attending_doctor_name: string | null;
  medical_record_number: string | null;
  phone: string | null;
}
interface Ward {
  id: string;
  name: string;
  floor: number | null;
  room_number: string | null;
  department: string | null;
  status: string;
  beds: Bed[];
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function WardsBoardPage() {
  const [openBed, setOpenBed] = useState<Bed | null>(null);
  const [obhodOpen, setObhodOpen] = useState(false);
  const [medsOpen, setMedsOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["wards-board"],
    queryFn: async () => {
      const res = await api.get<{ wards: Ward[] }>("/api/inpatient/wards/board");
      if (!res.success) throw new Error(res.error);
      return res;
    },
    refetchInterval: 30_000,
  });

  const wards = data?.wards ?? [];
  const totalBeds = wards.reduce((s, w) => s + w.beds.length, 0);
  const occupied = wards.reduce((s, w) => s + w.beds.filter((b) => b.status === "occupied").length, 0);
  const free = totalBeds - occupied;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/wards"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Palatalar
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Palata xaritasi</h1>
      </div>

      {/* Statistika */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<BedDouble className="size-4 text-blue-500" />} label="Jami koyka" value={totalBeds} />
        <StatCard icon={<Stethoscope className="size-4 text-emerald-500" />} label="Bo'sh" value={free} tint="emerald" />
        <StatCard icon={<HeartPulse className="size-4 text-rose-500" />} label="Band" value={occupied} tint="rose" />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}
        </div>
      ) : wards.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Hali palata yo&apos;q — /wards da qo&apos;shing
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {wards.map((w) => (
            <Card key={w.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Building2 className="size-4 text-primary" />
                    {w.name}
                    {w.floor != null && <span className="text-xs text-muted-foreground">· {w.floor}-qavat</span>}
                    {w.department && <Badge variant="secondary" className="text-[10px]">{w.department}</Badge>}
                  </CardTitle>
                  <Badge variant="outline" className="text-xs">
                    {w.beds.filter((b) => b.status === "occupied").length}/{w.beds.length} band
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {w.beds.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Bu palatada koyka yo&apos;q</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                    {w.beds.map((b) => (
                      <BedTile key={b.id} bed={b} onClick={() => { setOpenBed(b); setObhodOpen(false); }} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <BedDialog
        bed={openBed}
        onClose={() => { setOpenBed(null); setObhodOpen(false); setMedsOpen(false); }}
        onObhodOpen={() => setObhodOpen(true)}
        onMedsOpen={() => setMedsOpen(true)}
      />
      <ObhodDialog
        bed={obhodOpen ? openBed : null}
        onClose={() => setObhodOpen(false)}
      />
      <MedScheduleDialog
        bed={medsOpen ? openBed : null}
        onClose={() => setMedsOpen(false)}
      />
    </div>
  );
}

function StatCard({ icon, label, value, tint }: {
  icon: React.ReactNode; label: string; value: number; tint?: "emerald" | "rose";
}) {
  return (
    <Card className={cn(
      "border-border/50",
      tint === "emerald" && "border-emerald-500/20 bg-emerald-500/5",
      tint === "rose" && "border-rose-500/20 bg-rose-500/5",
    )}>
      <CardContent className="p-3 flex items-center gap-3">
        {icon}
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function BedTile({ bed, onClick }: { bed: Bed; onClick: () => void }) {
  const occupied = bed.status === "occupied";
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border p-2.5 text-left transition-colors",
        occupied
          ? "border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10"
          : bed.status === "free"
            ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
            : "border-border/40 bg-muted/30",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono font-medium">№{bed.bed_number}</span>
        <BedDouble className={cn("size-3.5", occupied ? "text-rose-500" : "text-emerald-500")} />
      </div>
      {occupied && bed.patient_name ? (
        <div className="mt-1.5">
          <p className="text-xs font-medium truncate">{bed.patient_name}</p>
          {bed.medical_record_number && (
            <p className="text-[10px] text-muted-foreground font-mono">{bed.medical_record_number}</p>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground mt-1">
          {bed.status === "free" ? "bo'sh" : bed.status}
        </p>
      )}
    </button>
  );
}

function BedDialog({ bed, onClose, onObhodOpen, onMedsOpen }: {
  bed: Bed | null;
  onClose: () => void;
  onObhodOpen: () => void;
  onMedsOpen: () => void;
}) {
  const open = !!bed && bed.status === "occupied";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Koyka №{bed?.bed_number}</DialogTitle>
          <DialogDescription>Yotgan bemor haqida qisqacha</DialogDescription>
        </DialogHeader>

        {bed && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border/50 p-3">
              <p className="font-semibold">{bed.patient_name}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                {bed.medical_record_number && <span className="font-mono">{bed.medical_record_number}</span>}
                {bed.phone && <span className="flex items-center gap-1"><Phone className="size-3" />{bed.phone}</span>}
              </div>
              {bed.diagnosis_initial && (
                <p className="text-sm mt-2"><span className="text-muted-foreground text-xs">Tashxis: </span>{bed.diagnosis_initial}</p>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
                <span>Yotqizilgan: {fmtDate(bed.admission_date)}</span>
                {bed.attending_doctor_name && <span>Shifokor: {bed.attending_doctor_name}</span>}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {bed?.patient_id && (
            <Link href={`/patients/${bed.patient_id}`} target="_blank"
              className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
              <FolderOpen className="size-4" /> Karta
            </Link>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Yopish</Button>
            <Button variant="outline" onClick={onMedsOpen}><Pill className="size-4" /> Dorilar</Button>
            <Button onClick={onObhodOpen}><Mic className="size-4" /> Ovozli obhod</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bugungi dorilar jadval + bajarish (hamshira) ──
interface MedRow {
  id: string;
  medicine_name: string;
  dosage: string | null;
  route: string | null;
  frequency: string | null;
  doctor_name: string | null;
  status: string;
  executions: Array<{ id: string; at: string; nurse: string; shift: string | null; notes: string | null }>;
}

function MedScheduleDialog({ bed, onClose }: { bed: Bed | null; onClose: () => void }) {
  const qc = useQueryClient();
  const admissionId = bed?.admission_id || null;
  const open = !!bed;

  const { data, isLoading } = useQuery({
    queryKey: ["med-schedule", admissionId],
    enabled: open && !!admissionId,
    queryFn: async () => {
      const res = await api.get<{ medicines: MedRow[]; diet_number: number | null }>(
        `/api/inpatient/admissions/${admissionId}/med-schedule`
      );
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  const meds = data?.medicines ?? [];

  const execute = useMutation({
    mutationFn: async ({ id, shift }: { id: string; shift?: string }) => {
      const res = await api.post(`/api/inpatient/prescriptions/${id}/execute`, { shift });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Dori berildi");
      qc.invalidateQueries({ queryKey: ["med-schedule", admissionId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const shiftNow = (() => {
    const h = new Date().getHours();
    if (h < 12) return "ertalab";
    if (h < 17) return "kunduz";
    if (h < 22) return "kechqurun";
    return "tun";
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton>
        <DialogHeader>
          <DialogTitle>Bugungi dorilar — {bed?.patient_name}</DialogTitle>
          <DialogDescription>
            Hamshira dorini bergandan keyin tugmani bosadi. Bugungi bajarilishlar
            saqlanadi.
            {data?.diet_number != null && (
              <span className="ml-2">Parhez stoli: <b>№{data.diet_number}</b></span>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : meds.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-6">Faol dori tayinlanmagan</p>
        ) : (
          <div className="space-y-2">
            {meds.map((m) => (
              <div key={m.id} className="rounded-lg border border-border/50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{m.medicine_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[m.dosage, m.route, m.frequency].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70">Tayinladi: {m.doctor_name || "—"}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={m.executions.length > 0 ? "outline" : "default"}
                    onClick={() => execute.mutate({ id: m.id, shift: shiftNow })}
                    disabled={execute.isPending}
                  >
                    <CheckCircle2 className="size-4" /> Berdim ({shiftNow})
                  </Button>
                </div>
                {m.executions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.executions.map((ex) => (
                      <Badge key={ex.id} variant="secondary" className="text-[10px]">
                        {new Date(ex.at).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}
                        {ex.shift && ` · ${ex.shift}`} · {ex.nurse || "—"}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Ovozli obhod dialogi ──
// Yozib → API'ga yuboradi → LLM ajratadi → shifokor tahrirlab saqlaydi.
function ObhodDialog({ bed, onClose }: { bed: Bed | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [temp, setTemp] = useState("");
  const [bp, setBp] = useState("");
  const [pulse, setPulse] = useState("");
  const [complaints, setComplaints] = useState("");
  const [plan, setPlan] = useState("");

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  function reset() {
    setText(""); setAiSummary(""); setTemp(""); setBp(""); setPulse("");
    setComplaints(""); setPlan("");
  }

  const open = !!bed;

  async function toggleMic() {
    if (recording) {
      mediaRef.current?.stop();
      return;
    }
    if (!bed?.admission_id) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setBusy(true);
        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const fd = new FormData();
          fd.append("audio", blob, "obhod.webm");
          fd.append("admission_id", bed.admission_id!);
          const res = await api.upload<{
            data: {
              transcription: string;
              extracted: {
                temperature?: number | null; blood_pressure?: string | null;
                pulse?: number | null; complaints?: string | null;
                treatment_plan?: string | null; ai_summary?: string | null;
              };
            };
          }>("/api/inpatient/daily-notes/voice", fd);
          if (!res.success) throw new Error(res.error);
          const ex = res.data.extracted;
          setText(res.data.transcription || "");
          setAiSummary(ex.ai_summary || "");
          setTemp(ex.temperature != null ? String(ex.temperature) : "");
          setBp(ex.blood_pressure || "");
          setPulse(ex.pulse != null ? String(ex.pulse) : "");
          setComplaints(ex.complaints || "");
          setPlan(ex.treatment_plan || "");
          toast.success("Obhod yozib olindi va yozildi", {
            description: "Kerakli maydonlarni tuzatib qayta saqlashingiz mumkin",
          });
          queryClient.invalidateQueries({ queryKey: ["wards-board"] });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Xatolik");
        } finally {
          setBusy(false);
        }
      };
      rec.start();
      mediaRef.current = rec;
      setRecording(true);
    } catch {
      toast.error("Mikrofonga ruxsat berilmadi");
    }
  }

  const saveEdits = useMutation({
    mutationFn: async () => {
      if (!bed?.admission_id) throw new Error("Yotqizish topilmadi");
      const res = await api.post("/api/inpatient/daily-notes", {
        admission_id: bed.admission_id,
        temperature: temp ? parseFloat(temp) : null,
        blood_pressure: bp || null,
        pulse: pulse ? parseInt(pulse, 10) : null,
        complaints: complaints || null,
        treatment_plan: plan || null,
        ai_summary: aiSummary || null,
        raw_text: text || null,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Obhod saqlandi");
      queryClient.invalidateQueries({ queryKey: ["wards-board"] });
      reset();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" showCloseButton>
        <DialogHeader>
          <DialogTitle>Ovozli obhod — {bed?.patient_name}</DialogTitle>
          <DialogDescription>
            Mikrofonda gapiring; AI temperatura, bosim, shikoyat va rejani ajratadi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-center py-4">
            <Button
              size="lg"
              variant={recording ? "destructive" : "default"}
              onClick={toggleMic}
              disabled={busy}
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> :
               recording ? <Square className="size-5" /> :
               <Mic className="size-5" />}
              {busy ? "Tahlil qilinmoqda..." : recording ? "To'xtatish" : "Yozishni boshlash"}
            </Button>
          </div>

          {(text || aiSummary) && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              {aiSummary && <p className="text-sm font-medium">{aiSummary}</p>}
              {text && (
                <details className="mt-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Transkript</summary>
                  <p className="mt-1 whitespace-pre-wrap">{text}</p>
                </details>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                <ThermometerSun className="size-3" /> t°
              </Label>
              <Input value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="37.2" inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bosim</Label>
              <Input value={bp} onChange={(e) => setBp(e.target.value)} placeholder="120/80" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                <Activity className="size-3" /> Puls
              </Label>
              <Input value={pulse} onChange={(e) => setPulse(e.target.value)} placeholder="76" inputMode="numeric" />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Shikoyat</Label>
            <Textarea value={complaints} onChange={(e) => setComplaints(e.target.value)} rows={2} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Davolash rejasi</Label>
            <Textarea value={plan} onChange={(e) => setPlan(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Bekor qilish</Button>
          <Button onClick={() => saveEdits.mutate()} disabled={saveEdits.isPending || !bed?.admission_id}>
            {saveEdits.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
