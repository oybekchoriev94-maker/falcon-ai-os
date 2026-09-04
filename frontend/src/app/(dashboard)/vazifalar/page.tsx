"use client";

// ============================================================
// Xodim vazifalari — rahbar belgilaydi, xodim bajarib belgilaydi.
// DOKTRINA: kechikish DALIL, avtomatik jazo yo'q.
// ============================================================

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ListChecks, Plus, Trash2, CheckCircle2, Clock, AlertTriangle,
  CircleDashed, PlayCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type TaskStatus = "pending" | "in_progress" | "done";

interface StaffOption { id: number; full_name: string; is_active: boolean }

interface TaskRow {
  id: string;
  staff_member_id: number;
  staff_name: string;
  title: string;
  description: string | null;
  due_at: string | null;
  status: TaskStatus;
  done_at: string | null;
  result_note: string | null;
  duty_template_id: string | null;
  created_at: string;
  overdue: boolean;
}

interface TaskSummary {
  total: number; pending: number; in_progress: number; done: number; overdue: number;
  by_staff: { staff_name: string; total: number; done: number; overdue: number }[];
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const STATUS_CFG: Record<TaskStatus, { label: string; cls: string; Icon: typeof CircleDashed }> = {
  pending: { label: "Boshlanmagan", cls: "border-muted-foreground/30 text-muted-foreground", Icon: CircleDashed },
  in_progress: { label: "Jarayonda", cls: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400", Icon: PlayCircle },
  done: { label: "Bajarildi", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 },
};

function fmtDue(iso: string | null) {
  if (!iso) return "Muddatsiz";
  return new Date(iso).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const emptyForm = { staff_member_id: "", title: "", description: "", due_at: "" };

export default function VazifalarPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const { data: staffData } = useQuery({
    queryKey: ["hrms-staff-active"],
    queryFn: async () => {
      const res = await api.get<{ staff: StaffOption[] }>("/api/v1/hrms/staff?active=true");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });
  const staffOptions = staffData?.staff ?? [];

  const { data: summaryData } = useQuery({
    queryKey: ["tasks-summary"],
    queryFn: async () => {
      const res = await api.get<TaskSummary>("/api/v1/tasks/summary");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", statusFilter],
    queryFn: async () => {
      const qs = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await api.get<{ tasks: TaskRow[] }>(`/api/v1/tasks${qs}`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    refetchInterval: 60_000,
  });
  const tasks = data?.tasks ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["tasks-summary"] });
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!form.staff_member_id) throw new Error("Xodimni tanlang");
      if (form.title.trim().length < 3) throw new Error("Sarlavha kamida 3 belgi");
      const res = await api.post("/api/v1/tasks", {
        staff_member_id: Number(form.staff_member_id),
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : undefined,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => { refresh(); setOpen(false); setForm(emptyForm); toast.success("Vazifa belgilandi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "in_progress" | "done" }) => {
      const res = await api.patch(`/api/v1/tasks/${id}/status`, { status });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/api/v1/tasks/${id}`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => { refresh(); toast.success("Vazifa o'chirildi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const summary = summaryData;

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={itemAnim} className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Xodim vazifalari</h1>
          <p className="text-sm text-muted-foreground">
            Kechikish — hisobotdagi dalil, avtomatik jazo yo&apos;q
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(emptyForm); }}>
          <DialogTrigger render={<Button><Plus className="size-4" /> Vazifa belgilash</Button>} />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Yangi vazifa</DialogTitle>
              <DialogDescription>Xodimga vazifa belgilang</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Xodim</Label>
                <Select value={form.staff_member_id} onValueChange={(v) => setForm({ ...form, staff_member_id: v ?? "" })}>
                  <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent>
                    {staffOptions.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!staffOptions.length && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Avval &quot;Xodim reestri&quot;ga xodim qo&apos;shing
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label>Sarlavha</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Masalan: Ombor inventarizatsiyasi" />
              </div>
              <div className="grid gap-2">
                <Label>Tavsif (ixtiyoriy)</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2} placeholder="Batafsil ko'rsatma" />
              </div>
              <div className="grid gap-2">
                <Label>Muddat (ixtiyoriy)</Label>
                <Input type="datetime-local" value={form.due_at}
                  onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Bekor qilish</Button>
              <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                {addMutation.isPending ? "Saqlanmoqda..." : "Belgilash"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </motion.div>

      {summary && (
        <motion.div variants={itemAnim} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Jami", value: summary.total, tone: "" },
            { label: "Boshlanmagan", value: summary.pending, tone: "" },
            { label: "Jarayonda", value: summary.in_progress, tone: "text-blue-600 dark:text-blue-400" },
            { label: "Bajarilgan", value: summary.done, tone: "text-emerald-600 dark:text-emerald-400" },
            { label: "Kechikkan", value: summary.overdue, tone: summary.overdue ? "text-red-600 dark:text-red-400" : "" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className={cn("mt-1 text-2xl font-bold", s.tone)}>{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </motion.div>
      )}

      <motion.div variants={itemAnim} className="flex flex-wrap gap-1.5">
        {[
          { v: "all", l: "Barchasi" }, { v: "pending", l: "Boshlanmagan" },
          { v: "in_progress", l: "Jarayonda" }, { v: "done", l: "Bajarilgan" },
        ].map((f) => (
          <button key={f.v} type="button" onClick={() => setStatusFilter(f.v)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              statusFilter === f.v ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary"
            )}>
            {f.l}
          </button>
        ))}
      </motion.div>

      <motion.div variants={itemAnim}>
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : !tasks.length ? (
              <div className="py-16 text-center">
                <ListChecks className="mx-auto size-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">Vazifa topilmadi</p>
              </div>
            ) : (
              <div className="divide-y">
                {tasks.map((t) => {
                  const cfg = STATUS_CFG[t.status];
                  return (
                    <div key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <cfg.Icon className={cn("mt-0.5 size-4 shrink-0", t.status === "done" ? "text-emerald-500" : "text-muted-foreground")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{t.title}</span>
                          <Badge variant="outline" className={cn("text-xs", cfg.cls)}>{cfg.label}</Badge>
                          {t.duty_template_id && (
                            <Badge variant="outline" className="text-xs border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400">
                              Kunlik
                            </Badge>
                          )}
                          {t.overdue && (
                            <Badge variant="outline" className="gap-1 border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400">
                              <AlertTriangle className="size-3" /> Kechikkan
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {t.staff_name} · <Clock className="inline size-3" /> {fmtDue(t.due_at)}
                        </div>
                        {t.description && (
                          <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {t.status === "pending" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => statusMutation.mutate({ id: t.id, status: "in_progress" })}
                            disabled={statusMutation.isPending}>
                            Boshlash
                          </Button>
                        )}
                        {t.status !== "done" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => statusMutation.mutate({ id: t.id, status: "done" })}
                            disabled={statusMutation.isPending}>
                            Bajarildi
                          </Button>
                        )}
                        <Button variant="ghost" size="icon-sm" className="text-destructive"
                          onClick={() => deleteMutation.mutate(t.id)} disabled={deleteMutation.isPending}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
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
