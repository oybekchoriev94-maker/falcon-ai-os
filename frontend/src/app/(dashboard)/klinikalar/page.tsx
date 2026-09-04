"use client";

// ============================================================
// Klinikalar va filiallar — tenant -> clinics -> branches
// Hozircha Oqtosh Klinikasi bitta joyda ishlaydi, lekin tuzilma
// ko'p filialli o'sishga tayyor turishi kerak.
// ============================================================

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Building2, Plus, Pencil, MapPin, Phone, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface Branch {
  id: string; clinic_id: string; name: string; code: string;
  phone: string | null; address: string | null; status: "active" | "inactive";
}
interface Clinic {
  id: string; name: string; code: string; phone: string | null;
  address: string | null; region: string | null; city: string | null;
  status: "active" | "inactive"; branches: Branch[];
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const emptyClinic = { name: "", code: "", phone: "", address: "", region: "", city: "" };
const emptyBranch = { name: "", code: "", phone: "", address: "" };

export default function KlinikalarPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyClinic);
  const [editing, setEditing] = useState<Clinic | null>(null);
  const [branchDialogFor, setBranchDialogFor] = useState<string | null>(null);
  const [branchForm, setBranchForm] = useState(emptyBranch);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["clinics"],
    queryFn: async () => {
      const res = await api.get<{ clinics: Clinic[] }>("/api/v1/clinics");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });
  const clinics = data?.clinics ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["clinics"] });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (form.name.trim().length < 2) throw new Error("Nomini kiriting");
      if (!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(form.code)) {
        throw new Error("Kod: kichik harf/raqam, 2-50 belgi ('-', '_' mumkin)");
      }
      const res = await api.post("/api/v1/clinics", {
        name: form.name.trim(), code: form.code.trim(),
        phone: form.phone.trim() || undefined, address: form.address.trim() || undefined,
        region: form.region.trim() || undefined, city: form.city.trim() || undefined,
      });
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: () => { refresh(); setOpen(false); setForm(emptyClinic); toast.success("Klinika qo'shildi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("Klinika tanlanmagan");
      const res = await api.put(`/api/v1/clinics/${editing.id}`, {
        name: form.name.trim(), phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined, region: form.region.trim() || undefined,
        city: form.city.trim() || undefined,
      });
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: () => { refresh(); setEditing(null); toast.success("Yangilandi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "inactive" }) => {
      const res = await api.put(`/api/v1/clinics/${id}`, { status });
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const addBranchMutation = useMutation({
    mutationFn: async () => {
      if (!branchDialogFor) throw new Error("Klinika tanlanmagan");
      if (branchForm.name.trim().length < 2) throw new Error("Nomini kiriting");
      if (!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(branchForm.code)) {
        throw new Error("Kod: kichik harf/raqam, 2-50 belgi");
      }
      const res = await api.post(`/api/v1/clinics/${branchDialogFor}/branches`, {
        name: branchForm.name.trim(), code: branchForm.code.trim(),
        phone: branchForm.phone.trim() || undefined, address: branchForm.address.trim() || undefined,
      });
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: () => { refresh(); setBranchDialogFor(null); setBranchForm(emptyBranch); toast.success("Filial qo'shildi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleBranchStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "inactive" }) => {
      const res = await api.put(`/api/v1/clinics/branches/${id}`, { status });
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  function startEdit(c: Clinic) {
    setEditing(c);
    setForm({ name: c.name, code: c.code, phone: c.phone || "", address: c.address || "", region: c.region || "", city: c.city || "" });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={itemAnim} className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Klinikalar va filiallar</h1>
          <p className="text-sm text-muted-foreground">Tenant tuzilmasi — bitta yoki bir nechta joy</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(emptyClinic); }}>
          <DialogTrigger render={<Button><Plus className="size-4" /> Klinika qo&apos;shish</Button>} />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Yangi klinika</DialogTitle>
              <DialogDescription>Tenant ichida yangi klinika yozuvi</DialogDescription>
            </DialogHeader>
            <ClinicForm form={form} setForm={setForm} showCode />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Bekor qilish</Button>
              <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                {addMutation.isPending ? "Saqlanmoqda..." : "Saqlash"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </motion.div>

      <motion.div variants={itemAnim} className="space-y-3">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : !clinics.length ? (
          <Card><CardContent className="py-16 text-center">
            <Building2 className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">Hali klinika qo&apos;shilmagan</p>
          </CardContent></Card>
        ) : (
          clinics.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => toggleExpand(c.id)}>
                    <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", expanded.has(c.id) && "rotate-180")} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{c.name}</span>
                        <Badge variant="outline" className="text-xs font-mono">{c.code}</Badge>
                        <Badge variant="outline" className={cn("text-xs",
                          c.status === "active"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-muted-foreground/30 text-muted-foreground")}>
                          {c.status === "active" ? "Faol" : "Nofaol"}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {c.address && <span className="flex items-center gap-1"><MapPin className="size-3" />{c.address}{c.city ? `, ${c.city}` : ""}</span>}
                        {c.phone && <span className="flex items-center gap-1"><Phone className="size-3" />{c.phone}</span>}
                        <span>{c.branches.length} ta filial</span>
                      </div>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setBranchDialogFor(c.id)}>
                      <Plus className="size-3" /> Filial
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => startEdit(c)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => toggleStatusMutation.mutate({ id: c.id, status: c.status === "active" ? "inactive" : "active" })}
                      disabled={toggleStatusMutation.isPending}>
                      {c.status === "active" ? "Faolsizlantirish" : "Faollashtirish"}
                    </Button>
                  </div>
                </div>

                {expanded.has(c.id) && (
                  <div className="mt-3 border-t pt-3">
                    {!c.branches.length ? (
                      <p className="text-xs text-muted-foreground">Filial yo&apos;q — hozircha bosh filial sifatida ishlaydi</p>
                    ) : (
                      <div className="space-y-2">
                        {c.branches.map((b) => (
                          <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                {b.name} <Badge variant="outline" className="text-xs font-mono">{b.code}</Badge>
                              </div>
                              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                {b.address && <span>{b.address}</span>}
                                {b.phone && <span>{b.phone}</span>}
                              </div>
                            </div>
                            <Button size="sm" variant="ghost" className="h-7 text-xs"
                              onClick={() => toggleBranchStatusMutation.mutate({ id: b.id, status: b.status === "active" ? "inactive" : "active" })}
                              disabled={toggleBranchStatusMutation.isPending}>
                              {b.status === "active" ? "Faol" : "Nofaol"}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </motion.div>

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Klinikani tahrirlash</DialogTitle>
            <DialogDescription>{editing?.name}</DialogDescription>
          </DialogHeader>
          <ClinicForm form={form} setForm={setForm} showCode={false} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Bekor qilish</Button>
            <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saqlanmoqda..." : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!branchDialogFor} onOpenChange={(v) => { if (!v) { setBranchDialogFor(null); setBranchForm(emptyBranch); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Yangi filial</DialogTitle>
            <DialogDescription>Tanlangan klinikaga filial qo&apos;shish</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Nomi</Label>
              <Input value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} placeholder="Masalan: 2-filial" />
            </div>
            <div className="grid gap-2">
              <Label>Kod</Label>
              <Input value={branchForm.code} onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })} placeholder="masalan: filial-2" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Telefon</Label>
                <Input value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} placeholder="+998901234567" />
              </div>
              <div className="grid gap-2">
                <Label>Manzil</Label>
                <Input value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchDialogFor(null)}>Bekor qilish</Button>
            <Button onClick={() => addBranchMutation.mutate()} disabled={addBranchMutation.isPending}>
              {addBranchMutation.isPending ? "Saqlanmoqda..." : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function ClinicForm({ form, setForm, showCode }: {
  form: typeof emptyClinic; setForm: (f: typeof emptyClinic) => void; showCode: boolean;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Nomi</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Masalan: Oqtosh Klinikasi" />
      </div>
      {showCode && (
        <div className="grid gap-2">
          <Label>Kod</Label>
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="masalan: oqtosh" />
          <p className="text-xs text-muted-foreground">Faqat kichik harf, raqam, &apos;-&apos;, &apos;_&apos; — keyin o&apos;zgartirib bo&apos;lmaydi</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Viloyat</Label>
          <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="Surxondaryo" />
        </div>
        <div className="grid gap-2">
          <Label>Shahar</Label>
          <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Termiz" />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Manzil</Label>
        <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
      <div className="grid gap-2">
        <Label>Telefon</Label>
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+998901234567" />
      </div>
    </div>
  );
}
