"use client";

// ============================================================
// Xodim reestri — HRMS (staff_members CRUD + Frappe sinxronizatsiya)
//
// `xodim-nazorati` bilan ADASHTIRMANG: u smena/kamera nazorati,
// bu esa xodimning O'ZI (F.I.O, lavozim, telefon) va tashqi
// Frappe HRMS bilan bog'lanishi. Ikkalasi bir xil `staff_members`
// jadvaliga tayanadi, lekin boshqa-boshqa vazifa.
// ============================================================

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Users, Plus, Pencil, RefreshCw, Link2, CircleCheck, CircleAlert,
  Phone, Briefcase, CalendarRange, ClipboardList, Trash2,
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
import { Textarea } from "@/components/ui/textarea";

interface StaffRow {
  id: number;
  full_name: string;
  role: string;
  position: string | null;
  phone: string | null;
  doctor_id: string | null;
  is_active: boolean;
  frappe_employee_name: string | null;
  has_telegram: boolean;
}

interface HrmsStatus { enabled: boolean; staff: number; synced: number }

interface SummaryRow {
  staff_name: string; shifts: number; present: number;
  late: number; early_leave: number; absent: number;
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const today = () => new Date().toLocaleDateString("en-CA");
const monthAgo = () => new Date(Date.now() - 29 * 86400_000).toLocaleDateString("en-CA");

export default function XodimReestriPage() {
  const [tab, setTab] = useState("staff");

  const { data: status } = useQuery({
    queryKey: ["hrms-status"],
    queryFn: async () => {
      const res = await api.get<HrmsStatus>("/api/v1/hrms/status");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={itemAnim} className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Xodim reestri</h1>
          <p className="text-sm text-muted-foreground">
            F.I.O, lavozim, aloqa — va xohlasangiz Frappe HRMS bilan sinxronizatsiya
          </p>
        </div>
        {status && (
          status.enabled ? (
            <Badge variant="outline" className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CircleCheck className="size-3.5" /> Frappe ulangan · {status.synced}/{status.staff} sinxron
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 border-muted-foreground/30 text-muted-foreground">
              <CircleAlert className="size-3.5" /> Frappe ulanmagan — faqat lokal reestr
            </Badge>
          )
        )}
      </motion.div>

      <motion.div variants={itemAnim}>
        <Tabs value={tab} onValueChange={(v) => { if (v !== null) setTab(v); }}>
          <TabsList variant="line" className="mb-4">
            <TabsTrigger value="staff" className="gap-1.5">
              <Users className="size-4" /> Xodimlar
            </TabsTrigger>
            <TabsTrigger value="summary" className="gap-1.5">
              <CalendarRange className="size-4" /> Oylik hisobot
            </TabsTrigger>
            <TabsTrigger value="duties" className="gap-1.5">
              <ClipboardList className="size-4" /> Vazifa shablonlari
            </TabsTrigger>
          </TabsList>
          <TabsContent value="staff"><StaffTab frappeEnabled={!!status?.enabled} /></TabsContent>
          <TabsContent value="summary"><SummaryTab /></TabsContent>
          <TabsContent value="duties"><DutyTemplatesTab /></TabsContent>
        </Tabs>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Xodimlar — ro'yxat, qo'shish, tahrirlash, Frappe'ga yuborish
// ============================================================

const emptyStaff = { full_name: "", role: "staff", position: "", phone: "" };

function StaffTab({ frappeEnabled }: { frappeEnabled: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [form, setForm] = useState(emptyStaff);

  const { data, isLoading } = useQuery({
    queryKey: ["hrms-staff"],
    queryFn: async () => {
      const res = await api.get<{ staff: StaffRow[] }>("/api/v1/hrms/staff");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });
  const staff = data?.staff ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["hrms-staff"] });
    queryClient.invalidateQueries({ queryKey: ["hrms-status"] });
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      if (form.full_name.trim().length < 2) throw new Error("Ism-familiyani kiriting");
      const res = await api.post("/api/v1/hrms/staff", {
        full_name: form.full_name.trim(),
        role: form.role.trim() || "staff",
        position: form.position.trim() || undefined,
        phone: form.phone.trim() || undefined,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => { refresh(); setOpen(false); setForm(emptyStaff); toast.success("Xodim qo'shildi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("Xodim tanlanmagan");
      const res = await api.put(`/api/v1/hrms/staff/${editing.id}`, {
        full_name: form.full_name.trim(),
        role: form.role.trim() || "staff",
        position: form.position.trim() || undefined,
        phone: form.phone.trim() || undefined,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => { refresh(); setEditing(null); toast.success("Ma'lumot yangilandi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const res = await api.put(`/api/v1/hrms/staff/${id}`, { is_active });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.post<{ frappe_employee_name: string }>(`/api/v1/hrms/sync/employee/${id}`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => { refresh(); toast.success("Frappe'ga yuborildi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  function startEdit(s: StaffRow) {
    setEditing(s);
    setForm({ full_name: s.full_name, role: s.role, position: s.position || "", phone: s.phone || "" });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{staff.length} ta xodim</p>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(emptyStaff); }}>
          <DialogTrigger render={<Button><Plus className="size-4" /> Xodim qo&apos;shish</Button>} />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Yangi xodim</DialogTitle>
              <DialogDescription>Reestrga qo&apos;shiladi — Frappe&apos;ga alohida yuborasiz</DialogDescription>
            </DialogHeader>
            <StaffForm form={form} setForm={setForm} />
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
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !staff.length ? (
            <div className="py-16 text-center">
              <Users className="mx-auto size-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Hali xodim qo&apos;shilmagan</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left font-medium">Xodim</th>
                    <th className="p-3 text-left font-medium">Lavozim</th>
                    <th className="p-3 text-left font-medium">Telefon</th>
                    <th className="p-3 text-left font-medium">Frappe</th>
                    <th className="p-3 text-left font-medium">Faol</th>
                    <th className="p-3 text-right font-medium">Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="p-3">
                        <div className="font-medium">{s.full_name}</div>
                        <div className="text-xs text-muted-foreground">{s.role}</div>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {s.position ? (
                          <span className="flex items-center gap-1.5"><Briefcase className="size-3.5" />{s.position}</span>
                        ) : "—"}
                      </td>
                      <td className="p-3 tabular-nums text-muted-foreground">
                        {s.phone ? (
                          <span className="flex items-center gap-1.5"><Phone className="size-3.5" />{s.phone}</span>
                        ) : "—"}
                      </td>
                      <td className="p-3">
                        {s.frappe_employee_name ? (
                          <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <Link2 className="size-3" /> {s.frappe_employee_name}
                          </Badge>
                        ) : frappeEnabled ? (
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                            onClick={() => syncMutation.mutate(s.id)} disabled={syncMutation.isPending}>
                            <RefreshCw className="size-3" /> Yuborish
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <Switch
                          checked={s.is_active}
                          onCheckedChange={(v) => toggleActiveMutation.mutate({ id: s.id, is_active: v })}
                          disabled={toggleActiveMutation.isPending}
                        />
                      </td>
                      <td className="p-3 text-right">
                        <Button variant="ghost" size="icon-sm" onClick={() => startEdit(s)}>
                          <Pencil className="size-3.5" />
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

      {!frappeEnabled && (
        <p className="text-xs text-muted-foreground">
          Frappe HRMS ulanmagan — reestr lokal ishlaydi, sinxronizatsiya tugmalari ko&apos;rinmaydi.
          Ulash uchun serverda <code className="rounded bg-muted px-1">FRAPPE_URL</code> sozlanishi kerak.
        </p>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xodimni tahrirlash</DialogTitle>
            <DialogDescription>{editing?.full_name}</DialogDescription>
          </DialogHeader>
          <StaffForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Bekor qilish</Button>
            <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saqlanmoqda..." : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StaffForm({ form, setForm }: {
  form: typeof emptyStaff; setForm: (f: typeof emptyStaff) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Ism familiya</Label>
        <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          placeholder="Masalan: Aziz Karimov" />
        <p className="text-xs text-muted-foreground">
          Smena va davomat bilan bog&apos;lash uchun Face ID ro&apos;yxatidagi ism bilan bir xil yozing
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Rol</Label>
          <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            placeholder="staff" />
        </div>
        <div className="grid gap-2">
          <Label>Telefon</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+998901234567" />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Lavozim</Label>
        <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}
          placeholder="Masalan: Katta hamshira" />
      </div>
    </div>
  );
}

// ============================================================
// Oylik hisobot — smena/davomat agregati (Frappe'siz ham ishlaydi)
// ============================================================

function SummaryTab() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["hrms-summary", from, to],
    queryFn: async () => {
      const res = await api.get<{ summary: SummaryRow[]; days: number }>(
        `/api/v1/hrms/summary?from=${from}&to=${to}`
      );
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  const summary = data?.summary ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <span className="text-sm text-muted-foreground">—</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} /> Yangilash
        </Button>
        {data && <span className="text-xs text-muted-foreground">{data.days} kunlik oraliq</span>}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !summary.length ? (
            <div className="py-16 text-center">
              <CalendarRange className="mx-auto size-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Bu oraliqda smena topilmadi</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left font-medium">Xodim</th>
                    <th className="p-3 text-right font-medium">Smenalar</th>
                    <th className="p-3 text-right font-medium">Vaqtida</th>
                    <th className="p-3 text-right font-medium">Kechikkan</th>
                    <th className="p-3 text-right font-medium">Erta ketgan</th>
                    <th className="p-3 text-right font-medium">Kelmagan</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((r) => (
                    <tr key={r.staff_name} className="border-b last:border-0">
                      <td className="p-3 font-medium">{r.staff_name}</td>
                      <td className="p-3 text-right tabular-nums">{r.shifts}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{r.present}</td>
                      <td className="p-3 text-right tabular-nums text-amber-600 dark:text-amber-400">{r.late || "—"}</td>
                      <td className="p-3 text-right tabular-nums text-amber-600 dark:text-amber-400">{r.early_leave || "—"}</td>
                      <td className="p-3 text-right tabular-nums text-red-600 dark:text-red-400">{r.absent || "—"}</td>
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
// Vazifa shablonlari — lavozimga biriktirilgan doimiy vazifalar.
// Har kuni backend/cron/duty-tasks.js shu shablonlar asosida
// FAOL xodimlarga staff_tasks avtomatik yaratadi (idempotent).
// ============================================================

interface DutyTemplate {
  id: string; position: string; title: string; description: string | null;
  sort_order: number; is_active: boolean;
}

const emptyDuty = { position: "", title: "", description: "", sort_order: "0" };

function DutyTemplatesTab() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DutyTemplate | null>(null);
  const [form, setForm] = useState(emptyDuty);

  const { data: positionsData } = useQuery({
    queryKey: ["duty-positions"],
    queryFn: async () => {
      const res = await api.get<{ positions: string[] }>("/api/v1/duty-templates/positions");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });
  const positions = positionsData?.positions ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ["duty-templates"],
    queryFn: async () => {
      const res = await api.get<{ templates: DutyTemplate[] }>("/api/v1/duty-templates");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });
  const templates = data?.templates ?? [];

  const grouped = templates.reduce<Record<string, DutyTemplate[]>>((acc, t) => {
    (acc[t.position] ??= []).push(t);
    return acc;
  }, {});

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["duty-templates"] });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!form.position.trim()) throw new Error("Lavozimni tanlang yoki kiriting");
      if (form.title.trim().length < 3) throw new Error("Sarlavha kamida 3 belgi");
      const res = await api.post("/api/v1/duty-templates", {
        position: form.position.trim(), title: form.title.trim(),
        description: form.description.trim() || undefined,
        sort_order: Number(form.sort_order) || 0,
      });
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: () => { refresh(); setOpen(false); setForm(emptyDuty); toast.success("Vazifa shabloni qo'shildi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("Shablon tanlanmagan");
      const res = await api.put(`/api/v1/duty-templates/${editing.id}`, {
        title: form.title.trim(), description: form.description.trim() || undefined,
        sort_order: Number(form.sort_order) || 0,
      });
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: () => { refresh(); setEditing(null); toast.success("Yangilandi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const res = await api.put(`/api/v1/duty-templates/${id}`, { is_active });
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/api/v1/duty-templates/${id}`);
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: () => { refresh(); toast.success("O'chirildi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  function startEdit(t: DutyTemplate) {
    setEditing(t);
    setForm({ position: t.position, title: t.title, description: t.description || "", sort_order: String(t.sort_order) });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Lavozimga biriktirilgan doimiy vazifalar — har kuni soat 20:00 muddat bilan avtomatik yaratiladi
        </p>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(emptyDuty); }}>
          <DialogTrigger render={<Button><Plus className="size-4" /> Shablon qo&apos;shish</Button>} />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Yangi doimiy vazifa</DialogTitle>
              <DialogDescription>Bir lavozimdagi barcha faol xodimlarga har kuni beriladi</DialogDescription>
            </DialogHeader>
            <DutyForm form={form} setForm={setForm} positions={positions} lockPosition={false} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Bekor qilish</Button>
              <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                {addMutation.isPending ? "Saqlanmoqda..." : "Saqlash"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!positions.length && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Hali hech bir xodimga lavozim belgilanmagan — avval &quot;Xodimlar&quot; tabida lavozim kiriting,
          keyin shu yerda o&apos;sha lavozim nomini tanlang (harfma-harf bir xil bo&apos;lishi shart).
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !templates.length ? (
            <div className="py-16 text-center">
              <ClipboardList className="mx-auto size-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Hali vazifa shabloni qo&apos;shilmagan</p>
            </div>
          ) : (
            <div className="divide-y">
              {Object.entries(grouped).map(([position, items]) => (
                <div key={position} className="p-4">
                  <p className="mb-2 text-sm font-semibold">{position}</p>
                  <div className="space-y-1.5">
                    {items.map((t) => (
                      <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
                        <div className="min-w-0">
                          <p className={cn("text-sm font-medium", !t.is_active && "text-muted-foreground line-through")}>{t.title}</p>
                          {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Switch
                            checked={t.is_active}
                            onCheckedChange={(v) => toggleActiveMutation.mutate({ id: t.id, is_active: v })}
                            disabled={toggleActiveMutation.isPending}
                          />
                          <Button variant="ghost" size="icon-sm" onClick={() => startEdit(t)}>
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" className="text-destructive"
                            onClick={() => deleteMutation.mutate(t.id)} disabled={deleteMutation.isPending}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Shablonni tahrirlash</DialogTitle>
            <DialogDescription>{editing?.position}</DialogDescription>
          </DialogHeader>
          <DutyForm form={form} setForm={setForm} positions={positions} lockPosition />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Bekor qilish</Button>
            <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saqlanmoqda..." : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DutyForm({ form, setForm, positions, lockPosition }: {
  form: typeof emptyDuty; setForm: (f: typeof emptyDuty) => void;
  positions: string[]; lockPosition: boolean;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Lavozim</Label>
        {lockPosition ? (
          <Input value={form.position} disabled />
        ) : positions.length ? (
          <Select value={form.position} onValueChange={(v) => { if (v !== null) setForm({ ...form, position: v }); }}>
            <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
            <SelectContent>
              {positions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}
            placeholder="Masalan: hamshira" />
        )}
      </div>
      <div className="grid gap-2">
        <Label>Vazifa sarlavhasi</Label>
        <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Masalan: Dorixona haroratini tekshirish" />
      </div>
      <div className="grid gap-2">
        <Label>Tavsif (ixtiyoriy)</Label>
        <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2} placeholder="Batafsil ko'rsatma" />
      </div>
      <div className="grid gap-2">
        <Label>Tartib raqami</Label>
        <Input type="number" min={0} value={form.sort_order}
          onChange={(e) => setForm({ ...form, sort_order: e.target.value })} className="w-24" />
      </div>
    </div>
  );
}
