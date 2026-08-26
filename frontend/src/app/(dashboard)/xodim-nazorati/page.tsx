"use client";

// ============================================================
// Xodim nazorati — kamera + Face ID + smena (direktor paneli)
//
// DOKTRINA: kamera = DALIL, jazo emas. Barcha hisobotlar
// rahbarga ko'rsatiladi, qaror odamda qoladi.
// ============================================================

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  UserCheck, UserX, Clock, Camera, Plus, Trash2, AlertTriangle,
  CalendarDays, MapPin, ShieldAlert, CircleCheck, CircleX,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type ShiftStatus = "present" | "late" | "early_leave" | "absent";

interface AttendanceRow {
  staff_name: string;
  status: ShiftStatus;
  shift: { date: string; start: string; end: string };
  first_in: string | null;
  last_out: string | null;
  late_minutes: number;
  early_leave_minutes: number;
  camera_confirmed: boolean;
}

interface AttendanceSummary { total: number; present: number; late: number; early_leave: number; absent: number }

interface WorkerAlert {
  zone_id: string;
  rule_type: "after_hours" | "restricted" | "presence_required";
  severity: "info" | "warning" | "critical";
  occurred_at: string;
  subject_ref: string | null;
  staff_name?: string | null;
  camera_id: string | null;
}

interface Shift {
  id: string;
  staff_name: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
}

interface ZoneRule {
  id: string;
  zone_id: string;
  rule_type: "after_hours" | "restricted" | "presence_required";
  allowed_start: string | null;
  allowed_end: string | null;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const today = () => new Date().toLocaleDateString("en-CA");

// Smena oynasi: render vaqtida emas, modul yuklanganda bir marta hisoblanadi
// (react-hooks/purity — Date.now() render ichida chaqirilmasligi kerak).
const SHIFT_FROM = new Date(Date.now() - 3 * 86400_000).toLocaleDateString("en-CA");
const SHIFT_TO = new Date(Date.now() + 7 * 86400_000).toLocaleDateString("en-CA");

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_CFG: Record<ShiftStatus, { label: string; cls: string }> = {
  present: { label: "Vaqtida", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  late: { label: "Kechikdi", cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  early_leave: { label: "Erta ketdi", cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  absent: { label: "Kelmadi", cls: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400" },
};

const RULE_LABEL: Record<ZoneRule["rule_type"], string> = {
  after_hours: "Ish vaqtidan tashqari",
  restricted: "Cheklangan zona",
  presence_required: "Majburiy ishtirok",
};

const SEVERITY_CFG = {
  info: { label: "Ma'lumot", cls: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  warning: { label: "Ogohlantirish", cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  critical: { label: "Jiddiy", cls: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400" },
} as const;

export default function XodimNazoratiPage() {
  const [tab, setTab] = useState("attendance");

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={itemAnim}>
        <h1 className="text-2xl font-bold tracking-tight">Xodim nazorati</h1>
        <p className="text-sm text-muted-foreground">
          Kamera va Face ID dalillari asosida — qaror rahbarda
        </p>
      </motion.div>

      <motion.div variants={itemAnim}>
        <Tabs value={tab} onValueChange={(v) => { if (v !== null) setTab(v); }}>
          <TabsList variant="line" className="mb-4">
            <TabsTrigger value="attendance" className="gap-1.5">
              <UserCheck className="size-4" /> Davomat
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-1.5">
              <ShieldAlert className="size-4" /> Signallar
            </TabsTrigger>
            <TabsTrigger value="shifts" className="gap-1.5">
              <CalendarDays className="size-4" /> Smenalar
            </TabsTrigger>
            <TabsTrigger value="zones" className="gap-1.5">
              <MapPin className="size-4" /> Zona qoidalari
            </TabsTrigger>
          </TabsList>

          <TabsContent value="attendance"><AttendanceTab /></TabsContent>
          <TabsContent value="alerts"><AlertsTab /></TabsContent>
          <TabsContent value="shifts"><ShiftsTab /></TabsContent>
          <TabsContent value="zones"><ZonesTab /></TabsContent>
        </Tabs>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Davomat — smena jadvali Face ID hodisalari bilan solishtiriladi
// ============================================================

function AttendanceTab() {
  const [date, setDate] = useState(today());

  const { data, isLoading } = useQuery({
    queryKey: ["workers-attendance", date],
    queryFn: async () => {
      const res = await api.get<{ summary: AttendanceSummary; rows: AttendanceRow[] }>(
        `/api/v1/workers/attendance?date=${date}`
      );
      if (!res.success) throw new Error(res.error);
      return res;
    },
    refetchInterval: date === today() ? 60_000 : false,
  });

  const summary = data?.summary;
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarDays className="size-4 text-muted-foreground" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value || today())} className="w-40" />
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Jami smena", value: summary.total, Icon: Clock, tone: "" },
            { label: "Vaqtida", value: summary.present, Icon: UserCheck, tone: "text-emerald-600 dark:text-emerald-400" },
            { label: "Kechikkan", value: summary.late, Icon: Clock, tone: summary.late ? "text-amber-600 dark:text-amber-400" : "" },
            { label: "Erta ketgan", value: summary.early_leave, Icon: Clock, tone: summary.early_leave ? "text-amber-600 dark:text-amber-400" : "" },
            { label: "Kelmagan", value: summary.absent, Icon: UserX, tone: summary.absent ? "text-red-600 dark:text-red-400" : "" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <s.Icon className="size-3.5" /> {s.label}
                </div>
                <div className={cn("mt-1 text-2xl font-bold", s.tone)}>{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !rows.length ? (
            <div className="py-16 text-center">
              <CalendarDays className="mx-auto size-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Bu kunga smena belgilanmagan</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Smenalar bo&apos;limidan jadval qo&apos;shing
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left font-medium">Xodim</th>
                    <th className="p-3 text-left font-medium">Smena</th>
                    <th className="p-3 text-left font-medium">Keldi</th>
                    <th className="p-3 text-left font-medium">Ketdi</th>
                    <th className="p-3 text-left font-medium">Kechikish</th>
                    <th className="p-3 text-left font-medium">Holat</th>
                    <th className="p-3 text-left font-medium">Kamera</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.staff_name}-${i}`} className="border-b last:border-0">
                      <td className="p-3 font-medium">{r.staff_name}</td>
                      <td className="p-3 tabular-nums text-muted-foreground">
                        {r.shift.start}–{r.shift.end}
                      </td>
                      <td className="p-3 tabular-nums">{fmtTime(r.first_in)}</td>
                      <td className="p-3 tabular-nums text-muted-foreground">{fmtTime(r.last_out)}</td>
                      <td className="p-3 tabular-nums text-muted-foreground">
                        {r.late_minutes > 0 ? `${r.late_minutes} daq` : "—"}
                        {r.early_leave_minutes > 0 && ` (+${r.early_leave_minutes} erta)`}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={cn("text-xs", STATUS_CFG[r.status].cls)}>
                          {STATUS_CFG[r.status].label}
                        </Badge>
                      </td>
                      <td className="p-3">
                        {r.camera_confirmed ? (
                          <Badge variant="outline" className="gap-1 border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                            <Camera className="size-3" /> Tasdiqlangan
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Hisobot dalil sifatida ko&apos;rsatiladi — yakuniy qaror rahbarda.
      </p>
    </div>
  );
}

// ============================================================
// Signallar — zona qoidalari buzilishlari
// ============================================================

function AlertsTab() {
  const [date, setDate] = useState(today());

  const { data, isLoading } = useQuery({
    queryKey: ["workers-alerts", date],
    queryFn: async () => {
      const res = await api.get<{ alerts: WorkerAlert[] }>(`/api/v1/workers/alerts?date=${date}`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    refetchInterval: date === today() ? 60_000 : false,
  });

  const alerts = data?.alerts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarDays className="size-4 text-muted-foreground" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value || today())} className="w-40" />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !alerts.length ? (
            <div className="py-16 text-center">
              <CircleCheck className="mx-auto size-10 text-emerald-500/60" />
              <p className="mt-3 text-sm text-muted-foreground">Bu kunda signal yo&apos;q</p>
            </div>
          ) : (
            <div className="divide-y">
              {alerts.map((a, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <AlertTriangle className={cn(
                    "size-4 shrink-0",
                    a.severity === "critical" ? "text-red-500"
                      : a.severity === "warning" ? "text-amber-500" : "text-blue-500"
                  )} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {a.staff_name || a.subject_ref?.replace("staff:", "") || "Noma'lum shaxs"}
                      {" — "}
                      {RULE_LABEL[a.rule_type]}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Zona: {a.zone_id} · {fmtTime(a.occurred_at)}
                      {a.camera_id && ` · Kamera: ${a.camera_id}`}
                    </div>
                  </div>
                  <Badge variant="outline" className={cn("text-xs", SEVERITY_CFG[a.severity].cls)}>
                    {SEVERITY_CFG[a.severity].label}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Signal — bu dalil, avtomatik jazo emas. Har bir holatni rahbar ko&apos;rib chiqadi.
      </p>
    </div>
  );
}

// ============================================================
// Smenalar — jadval qo'shish/o'chirish
// ============================================================

const emptyShift = { staff_name: "", shift_date: today(), start_time: "09:00", end_time: "18:00", grace_minutes: 15 };

function ShiftsTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyShift);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["workers-shifts"],
    queryFn: async () => {
      const res = await api.get<{ shifts: Shift[] }>(`/api/v1/workers/shifts?from=${SHIFT_FROM}&to=${SHIFT_TO}`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (form.staff_name.trim().length < 2) throw new Error("Xodim ismini kiriting");
      const res = await api.post("/api/v1/workers/shifts", { ...form, staff_name: form.staff_name.trim() });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workers-shifts"] });
      setOpen(false);
      setForm(emptyShift);
      toast.success("Smena qo'shildi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/api/v1/workers/shifts/${id}`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workers-shifts"] });
      toast.success("Smena o'chirildi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const shifts = data?.shifts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {SHIFT_FROM} — {SHIFT_TO} oralig&apos;i ({shifts.length} ta smena)
        </p>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(emptyShift); }}>
          <DialogTrigger render={<Button><Plus className="size-4" /> Smena qo&apos;shish</Button>} />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Yangi smena</DialogTitle>
              <DialogDescription>Xodim uchun ish jadvalini belgilang</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Xodim ismi</Label>
                <Input
                  value={form.staff_name}
                  onChange={(e) => setForm({ ...form, staff_name: e.target.value })}
                  placeholder="Masalan: Aziz Karimov"
                />
                <p className="text-xs text-muted-foreground">
                  Ism Face ID ro&apos;yxatidagi ism bilan bir xil bo&apos;lishi kerak
                </p>
              </div>
              <div className="grid gap-2">
                <Label>Sana</Label>
                <Input type="date" value={form.shift_date}
                  onChange={(e) => setForm({ ...form, shift_date: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Boshlanish</Label>
                  <Input type="time" value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Tugash</Label>
                  <Input type="time" value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Kechikish bag&apos;ishlovi (daqiqa)</Label>
                <Input type="number" min={0} max={120} value={form.grace_minutes}
                  onChange={(e) => setForm({ ...form, grace_minutes: Number(e.target.value) })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Bekor qilish</Button>
              <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                {addMutation.isPending ? "Saqlanmoqda..." : "Saqlash"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !shifts.length ? (
            <div className="py-16 text-center">
              <CalendarDays className="mx-auto size-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Bu davrda smena yo&apos;q</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left font-medium">Xodim</th>
                    <th className="p-3 text-left font-medium">Sana</th>
                    <th className="p-3 text-left font-medium">Vaqt</th>
                    <th className="p-3 text-left font-medium">Bag&apos;ishlov</th>
                    <th className="p-3 text-right font-medium">Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="p-3 font-medium">{s.staff_name}</td>
                      <td className="p-3 tabular-nums">{s.shift_date}</td>
                      <td className="p-3 tabular-nums text-muted-foreground">{s.start_time}–{s.end_time}</td>
                      <td className="p-3 tabular-nums text-muted-foreground">{s.grace_minutes} daq</td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost" size="icon-sm"
                          className="text-destructive"
                          onClick={() => deleteMutation.mutate(s.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Zona qoidalari — qo'shish va yoqish/o'chirish
// ============================================================

const emptyRule = { zone_id: "", rule_type: "after_hours" as ZoneRule["rule_type"], allowed_start: "22:00", allowed_end: "06:00", severity: "warning" as ZoneRule["severity"] };

function ZonesTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyRule);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["workers-zone-rules"],
    queryFn: async () => {
      const res = await api.get<{ rules: ZoneRule[] }>("/api/v1/workers/zone-rules");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (form.zone_id.trim().length < 3) throw new Error("Zona nomini kiriting");
      const res = await api.post("/api/v1/workers/zone-rules", { ...form, zone_id: form.zone_id.trim() });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workers-zone-rules"] });
      setOpen(false);
      setForm(emptyRule);
      toast.success("Zona qoidasi saqlandi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await api.put(`/api/v1/workers/zone-rules/${id}`, { enabled });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workers-zone-rules"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const rules = data?.rules ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Kamera zonalariga qoidalar — buzilish signal beradi
        </p>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(emptyRule); }}>
          <DialogTrigger render={<Button><Plus className="size-4" /> Qoida qo&apos;shish</Button>} />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Yangi zona qoidasi</DialogTitle>
              <DialogDescription>Zona va qoida turini tanlang</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Zona</Label>
                <Input
                  value={form.zone_id}
                  onChange={(e) => setForm({ ...form, zone_id: e.target.value })}
                  placeholder="Masalan: ombor, procedur-xona"
                />
              </div>
              <div className="grid gap-2">
                <Label>Qoida turi</Label>
                <Select value={form.rule_type} onValueChange={(v) => { if (v !== null) setForm({ ...form, rule_type: v as ZoneRule["rule_type"] }); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="after_hours">Ish vaqtidan tashqari</SelectItem>
                    <SelectItem value="restricted">Cheklangan zona</SelectItem>
                    <SelectItem value="presence_required">Majburiy ishtirok</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.rule_type === "after_hours" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Mumkin emas (dan)</Label>
                    <Input type="time" value={form.allowed_start}
                      onChange={(e) => setForm({ ...form, allowed_start: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Mumkin emas (gacha)</Label>
                    <Input type="time" value={form.allowed_end}
                      onChange={(e) => setForm({ ...form, allowed_end: e.target.value })} />
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                <Label>Muhimlik darajasi</Label>
                <Select value={form.severity} onValueChange={(v) => { if (v !== null) setForm({ ...form, severity: v as ZoneRule["severity"] }); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Ma&apos;lumot</SelectItem>
                    <SelectItem value="warning">Ogohlantirish</SelectItem>
                    <SelectItem value="critical">Jiddiy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Bekor qilish</Button>
              <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                {addMutation.isPending ? "Saqlanmoqda..." : "Saqlash"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !rules.length ? (
            <div className="py-16 text-center">
              <MapPin className="mx-auto size-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Hali zona qoidasi yo&apos;q</p>
            </div>
          ) : (
            <div className="divide-y">
              {rules.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <MapPin className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{r.zone_id}</div>
                    <div className="text-xs text-muted-foreground">
                      {RULE_LABEL[r.rule_type]}
                      {r.rule_type === "after_hours" && r.allowed_start && r.allowed_end && (
                        <> · Mumkin emas: {r.allowed_start}–{r.allowed_end}</>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className={cn("text-xs", SEVERITY_CFG[r.severity].cls)}>
                    {SEVERITY_CFG[r.severity].label}
                  </Badge>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{r.enabled ? "Yoqilgan" : "O'chirilgan"}</span>
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(v) => toggleMutation.mutate({ id: r.id, enabled: v })}
                      disabled={toggleMutation.isPending}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleX className="size-3" />
        Qoidalar signal beradi, avtomatik jazo qo&apos;llamaydi.
      </p>
    </div>
  );
}
