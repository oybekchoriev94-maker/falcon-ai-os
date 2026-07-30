"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useState } from "react";
import {
  Building2,
  BedDouble,
  DoorOpen,
  User,
  UserPlus,
  LogOut,
  Search,
  Loader2,
  Hospital,
  Layers,
  Plus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type BedStatus = "free" | "occupied" | "cleaning";

interface Bed {
  id: number;
  bed_number: string;
  status: BedStatus;
  patient_name?: string;
  admission_id?: string;
}

interface Ward {
  id: string;
  name: string;
  floor: number;
  room_number?: string;
  department?: string;
  total_beds: number;
  free_beds: number;
  occupied_beds: number;
  beds?: Bed[];
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

const bedColors: Record<BedStatus, string> = {
  free: "bg-emerald-500/15 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/25",
  occupied:
    "bg-destructive/15 border-destructive/30 text-destructive hover:bg-destructive/25",
  cleaning:
    "bg-amber-500/15 border-amber-500/30 text-amber-500 hover:bg-amber-500/25",
};

const bedLabels: Record<BedStatus, string> = {
  free: "Bo'sh",
  occupied: "Band",
  cleaning: "Tozalash",
};

export default function WardsPage() {
  const queryClient = useQueryClient();
  const [selectedBed, setSelectedBed] = useState<{
    wardId: string;
    bed: Bed;
  } | null>(null);
  const [admitOpen, setAdmitOpen] = useState(false);
  // 003-forma to'liq muqova maydonlari (yotqizishda birdaniga to'ldiriladi)
  const [admitForm, setAdmitForm] = useState({
    patient_phone: '',
    diagnosis_initial: '',
    admission_type: 'rejali',
    height_cm: '', weight_kg: '', temperature_on_admission: '',
    transport_type: 'own',
    referring_clinic: '',
    urgent_admission: false,
    time_since_onset: '',
    referral_diagnosis: '',
    diet_number: '',
    treatment_plan: '',
  });
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [addWardOpen, setAddWardOpen] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [newWard, setNewWard] = useState({ name: "", floor: "", bed_count: "5" });

  const { data, isLoading } = useQuery({
    queryKey: ["wards"],
    queryFn: async () => {
      const res = await api.get<{ data: Ward[] }>("/api/inpatient/wards");
      if (!res.success) throw new Error(res.error || "Xatolik yuz berdi");
      const wards: Ward[] = res.data;
      const bedsPromises = wards.map(async (w) => {
        const bedsRes = await api.get<{ data: Bed[] }>(`/api/inpatient/wards/${w.id}/beds`);
        return { ...w, beds: bedsRes.success ? bedsRes.data : [] };
      });
      return Promise.all(bedsPromises);
    },
  });

  const createWardMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post("/api/inpatient/wards", {
        name: newWard.name,
        floor: newWard.floor ? parseInt(newWard.floor) : null,
        bed_count: parseInt(newWard.bed_count) || 5,
      });
      if (!res.success) throw new Error(res.error || "Xatolik yuz berdi");
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wards"] });
      toast.success("Palata qo'shildi");
      setAddWardOpen(false);
      setNewWard({ name: "", floor: "", bed_count: "5" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const admitMutation = useMutation({
    mutationFn: async ({
      wardId, bedId, name,
    }: { wardId: string; bedId: number; name: string }) => {
      const payload: Record<string, unknown> = {
        patient_name: name,
        ward_id: wardId,
        bed_id: bedId,
        patient_phone: admitForm.patient_phone || null,
        diagnosis_initial: admitForm.diagnosis_initial || null,
        admission_type: admitForm.admission_type,
        transport_type: admitForm.transport_type,
        urgent_admission: admitForm.urgent_admission,
        referring_clinic: admitForm.referring_clinic || null,
        time_since_onset: admitForm.time_since_onset || null,
        referral_diagnosis: admitForm.referral_diagnosis || null,
        diet_number: admitForm.diet_number || null,
        treatment_plan: admitForm.treatment_plan || null,
      };
      // Sonli maydonlar — bo'sh bo'lsa uzatmaymiz
      if (admitForm.height_cm) payload.height_cm = parseFloat(admitForm.height_cm);
      if (admitForm.weight_kg) payload.weight_kg = parseFloat(admitForm.weight_kg);
      if (admitForm.temperature_on_admission) payload.temperature_on_admission = parseFloat(admitForm.temperature_on_admission);

      const res = await api.post("/api/inpatient/admissions", payload);
      if (!res.success) throw new Error(res.error || "Xatolik yuz berdi");
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wards"] });
      toast.success("Bemor qabul qilindi");
      setAdmitOpen(false);
      setPatientName("");
      setAdmitForm({
        patient_phone: '', diagnosis_initial: '', admission_type: 'rejali',
        height_cm: '', weight_kg: '', temperature_on_admission: '',
        transport_type: 'own', referring_clinic: '', urgent_admission: false,
        time_since_onset: '', referral_diagnosis: '', diet_number: '', treatment_plan: '',
      });
      setSelectedBed(null);
    },
    onError: (err: Error) => {
      // Backend GUARD: rozilik + shartnoma yo'q bo'lsa maxsus xato keladi.
      // Foydalanuvchini bemor kartasiga yo'naltirib qo'yamiz.
      const msg = err.message || "Xatolik";
      if (msg.toLowerCase().includes("rozilik") || msg.toLowerCase().includes("shartnoma")) {
        toast.error("Rozilik yoki shartnoma imzolanmagan", {
          description: "Bemor kartasida imzolashdan so'ng qayta urinib ko'ring.",
          duration: 8000,
        });
      } else {
        toast.error(msg);
      }
    },
  });

  const dischargeMutation = useMutation({
    mutationFn: async ({ admission_id }: { admission_id: string }) => {
      const res = await api.post("/api/inpatient/discharge", { admission_id });
      if (!res.success) throw new Error(res.error || "Xatolik yuz berdi");
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wards"] });
      toast.success("Bemor chiqarildi");
      setDischargeOpen(false);
      setSelectedBed(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const wards: Ward[] = data ?? [];
  const totalBeds = wards.reduce((s, w) => s + w.total_beds, 0);
  const occupiedBeds = wards.reduce((s, w) => s + w.occupied_beds, 0);
  const freeBeds = wards.reduce((s, w) => s + w.free_beds, 0);

  const handleBedClick = (wardId: string, bed: Bed) => {
    setSelectedBed({ wardId, bed });
    if (bed.status === "occupied") setDischargeOpen(true);
    else if (bed.status === "free") setAdmitOpen(true);
  };

  const handleAdmit = () => {
    if (!selectedBed || !patientName.trim()) return;
    admitMutation.mutate({
      wardId: selectedBed.wardId,
      bedId: selectedBed.bed.id,
      name: patientName.trim(),
    });
  };

  const handleDischarge = () => {
    if (!selectedBed || !selectedBed.bed.admission_id) return;
    dischargeMutation.mutate({
      admission_id: selectedBed.bed.admission_id,
    });
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Palatalar</h1>
          <p className="text-sm text-muted-foreground">Klinika o'rinlari va palatalar holati</p>
        </div>
        <div className="flex gap-2">
          <a href="/wards/board"
             className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-accent">
            <BedDouble className="size-4" /> Palata xaritasi
          </a>
          <Button onClick={() => setAddWardOpen(true)}>
            <Plus className="size-4 mr-1.5" />
            Yangi palata
          </Button>
        </div>
      </div>

      <motion.div variants={item} className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Hospital} label="Jami palatalar" value={wards.length} color="from-blue-500/20 to-blue-500/5" isLoading={isLoading} />
        <StatCard icon={BedDouble} label="Jami o'rinlar" value={totalBeds} color="from-purple-500/20 to-purple-500/5" isLoading={isLoading} />
        <StatCard icon={User} label="Band o'rinlar" value={occupiedBeds} color="from-red-500/20 to-red-500/5" isLoading={isLoading} />
        <StatCard icon={DoorOpen} label="Bo'sh o'rinlar" value={freeBeds} color="from-emerald-500/20 to-emerald-500/5" isLoading={isLoading} />
      </motion.div>

      {isLoading && <WardsSkeleton />}

      {!isLoading && wards.length === 0 && (
        <motion.div variants={item} className="flex flex-col items-center justify-center py-16 text-center">
          <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Hospital className="size-8 text-muted-foreground/60" />
          </div>
          <h3 className="text-lg font-medium mb-1">Palatalar mavjud emas</h3>
          <p className="text-sm text-muted-foreground max-w-xs mb-4">
            Hozircha hech qanday palata qo'shilmagan.
          </p>
          <Button onClick={() => setAddWardOpen(true)}>
            <Plus className="size-4 mr-1.5" />
            Birinchi palatani qo'shish
          </Button>
        </motion.div>
      )}

      {!isLoading && wards.length > 0 && (
        <motion.div variants={item} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {wards.map((ward) => (
            <motion.div key={ward.id} variants={item}>
              <Card className="border-border/50 overflow-hidden h-full">
                <CardHeader className="pb-3 border-b border-border/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="size-4 text-primary shrink-0" />
                      <CardTitle className="text-base">{ward.name}</CardTitle>
                    </div>
                    <Badge variant="secondary" className="gap-1 shrink-0 text-xs">
                      <Layers className="size-3" />
                      {ward.floor || "?"}-qavat
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-3">
                  <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2 rounded-full bg-emerald-500" />
                      {ward.free_beds} bo'sh
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2 rounded-full bg-destructive" />
                      {ward.occupied_beds} band
                    </span>
                  </div>
                  {ward.beds && ward.beds.length > 0 ? (
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                      {ward.beds.map((bed) => (
                        <button
                          key={bed.id}
                          onClick={() => handleBedClick(ward.id, bed)}
                          className={cn(
                            "relative flex flex-col items-center justify-center gap-0.5 rounded-lg border p-2 text-xs font-medium transition-all duration-200 cursor-pointer",
                            bedColors[bed.status],
                            "hover:scale-105 active:scale-95"
                          )}
                        >
                          <span className="text-[10px] opacity-70 leading-none">
                            {bedLabels[bed.status]}
                          </span>
                          <span className="text-sm font-bold leading-none">
                            {bed.bed_number}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      O'rinlar mavjud emas
                    </p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      <Dialog open={addWardOpen} onOpenChange={(open) => {
        if (!open) { setAddWardOpen(false); setNewWard({ name: "", floor: "", bed_count: "5" }); }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="size-4" />
              Yangi palata qo'shish
            </DialogTitle>
            <DialogDescription>
              Palata ma'lumotlarini kiriting
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Palata nomi</Label>
              <Input
                placeholder="Masalan: Terapiya 1"
                value={newWard.name}
                onChange={(e) => setNewWard({ ...newWard, name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <Label>Qavat</Label>
              <Input
                placeholder="1"
                value={newWard.floor}
                onChange={(e) => setNewWard({ ...newWard, floor: e.target.value })}
              />
            </div>
            <div>
              <Label>O'rinlar soni</Label>
              <Input
                type="number"
                min="1"
                max="50"
                value={newWard.bed_count}
                onChange={(e) => setNewWard({ ...newWard, bed_count: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddWardOpen(false); setNewWard({ name: "", floor: "", bed_count: "5" }); }}>
              Bekor qilish
            </Button>
            <Button onClick={() => createWardMutation.mutate()} disabled={!newWard.name.trim() || createWardMutation.isPending}>
              {createWardMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={admitOpen} onOpenChange={(open) => {
        if (!open) { setAdmitOpen(false); setSelectedBed(null); setPatientName(""); }
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4" />
              Bemorni yotqizish — 003-forma muqovasi
            </DialogTitle>
            <DialogDescription>
              {selectedBed && (
                <>Palata: <strong>{wards.find((w) => w.id === selectedBed.wardId)?.name}</strong>, O&apos;rin: <strong>{selectedBed.bed.bed_number}</strong></>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Bemor ismi *</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <Input placeholder="Familiya Ism Otasining ismi" className="pl-8"
                    value={patientName} onChange={(e) => setPatientName(e.target.value)} autoFocus />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Telefon (karta bilan bog'lash)</Label>
                <Input placeholder="+998901234567" value={admitForm.patient_phone}
                  onChange={(e) => setAdmitForm(f => ({ ...f, patient_phone: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 bg-muted/20">
              <div className="col-span-3 text-xs text-muted-foreground font-medium">Antropometriya (kirish paytida)</div>
              <div className="space-y-1">
                <Label className="text-xs">Bo&apos;yi (sm)</Label>
                <Input inputMode="decimal" placeholder="170" value={admitForm.height_cm}
                  onChange={(e) => setAdmitForm(f => ({ ...f, height_cm: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vazni (kg)</Label>
                <Input inputMode="decimal" placeholder="65" value={admitForm.weight_kg}
                  onChange={(e) => setAdmitForm(f => ({ ...f, weight_kg: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Kirishdagi t°</Label>
                <Input inputMode="decimal" placeholder="36.6" value={admitForm.temperature_on_admission}
                  onChange={(e) => setAdmitForm(f => ({ ...f, temperature_on_admission: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Yotqizish turi</Label>
                <select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={admitForm.admission_type}
                  onChange={(e) => setAdmitForm(f => ({ ...f, admission_type: e.target.value }))}>
                  <option value="rejali">Rejali</option>
                  <option value="shoshilinch">Shoshilinch</option>
                  <option value="tez_yordam">Tez yordam</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Olib yurish turi</Label>
                <select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={admitForm.transport_type}
                  onChange={(e) => setAdmitForm(f => ({ ...f, transport_type: e.target.value }))}>
                  <option value="own">O&apos;zi yura oladi</option>
                  <option value="wheelchair">Aravachada</option>
                  <option value="stretcher">Zambilda</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="urgent" checked={admitForm.urgent_admission}
                onChange={(e) => setAdmitForm(f => ({ ...f, urgent_admission: e.target.checked }))} />
              <Label htmlFor="urgent" className="text-xs cursor-pointer">Shoshilinch keltirilgan</Label>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Bemor qayerdan yuborilgan (klinika)</Label>
              <Input placeholder="Termiz shahar poliklinikasi..." value={admitForm.referring_clinic}
                onChange={(e) => setAdmitForm(f => ({ ...f, referring_clinic: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Yo&apos;llanmadagi tashxis</Label>
                <Input placeholder="Migren" value={admitForm.referral_diagnosis}
                  onChange={(e) => setAdmitForm(f => ({ ...f, referral_diagnosis: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Kasallikdan o&apos;tgan vaqt</Label>
                <Input placeholder="3 kun" value={admitForm.time_since_onset}
                  onChange={(e) => setAdmitForm(f => ({ ...f, time_since_onset: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Boshlang&apos;ich tashxis (klinika)</Label>
              <Input placeholder="Migren" value={admitForm.diagnosis_initial}
                onChange={(e) => setAdmitForm(f => ({ ...f, diagnosis_initial: e.target.value }))} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Parhez stoli (Pevzner №)</Label>
                <select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={admitForm.diet_number}
                  onChange={(e) => setAdmitForm(f => ({ ...f, diet_number: e.target.value }))}>
                  <option value="">—</option>
                  {['1','1a','2','3','4','5','5a','6','7','8','9','10','11','12','13','14','15','0'].map(n =>
                    <option key={n} value={n}>№ {n}</option>)}
                </select>
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Davolash rejasi (bo&apos;lim mudiri tasdiqlaydi)</Label>
                <Textarea rows={2} placeholder="Antibiotik, infuzion, kuzatuv..."
                  value={admitForm.treatment_plan}
                  onChange={(e) => setAdmitForm(f => ({ ...f, treatment_plan: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAdmitOpen(false); setSelectedBed(null); setPatientName(""); }}>
              Bekor qilish
            </Button>
            <Button onClick={handleAdmit} disabled={!patientName.trim() || admitMutation.isPending}>
              {admitMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Yotqizish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dischargeOpen} onOpenChange={(open) => {
        if (!open) { setDischargeOpen(false); setSelectedBed(null); }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="size-4" />
              Bemorni chiqarish
            </DialogTitle>
            <DialogDescription>
              Quyidagi bemorni chiqarishni tasdiqlaysizmi?
            </DialogDescription>
          </DialogHeader>
          {selectedBed && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <User className="size-4 text-muted-foreground shrink-0" />
                <span className="font-medium">{selectedBed.bed.patient_name}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Building2 className="size-4 shrink-0" />
                <span>{wards.find((w) => w.id === selectedBed.wardId)?.name} — {selectedBed.bed.bed_number}-o'rin</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDischargeOpen(false); setSelectedBed(null); }}>
              Bekor qilish
            </Button>
            <Button variant="destructive" onClick={handleDischarge} disabled={dischargeMutation.isPending}>
              {dischargeMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Chiqarish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function StatCard({ icon: Icon, label, value, color, isLoading }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number; color: string; isLoading: boolean;
}) {
  return (
    <Card className="relative overflow-hidden border-border/50">
      <div className={`absolute inset-0 bg-gradient-to-br ${color}`} />
      <CardContent className="relative p-4 md:p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
          <Icon className="size-4 text-muted-foreground/60" />
        </div>
        {isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold tracking-tight">{value}</div>}
      </CardContent>
    </Card>
  );
}

function WardsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="border-border/50">
          <CardHeader className="pb-3 border-b border-border/30">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </CardHeader>
          <CardContent className="pt-3 space-y-3">
            <Skeleton className="h-3 w-48" />
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
              {Array.from({ length: 8 }).map((_, j) => (
                <Skeleton key={j} className="aspect-square rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
