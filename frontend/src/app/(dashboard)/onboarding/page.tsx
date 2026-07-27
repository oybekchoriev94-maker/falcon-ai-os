"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  Stethoscope,
  CalendarDays,
  Wallet,
  Send,
  Copy,
  ArrowRight,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

/* ── Types ── */
interface Step { key: string; label: string; done: boolean; count: number }
interface MeResponse {
  tenant: { id: string; code: string; name: string };
  subscription: { plan_name: string; status: string; trial_days_left: number | null };
  onboarding: { ready: boolean; steps: Step[]; appointments: number };
}
interface Doctor { id: string; first_name: string; last_name?: string; specialty?: string }

const SPECIALIZATIONS = [
  { key: "terapevt", label: "Terapevt" }, { key: "pediatr", label: "Pediatr" },
  { key: "ginekolog", label: "Ginekolog" }, { key: "kardiolog", label: "Kardiolog" },
  { key: "nevrolog", label: "Nevrolog" }, { key: "stomatolog", label: "Stomatolog" },
  { key: "oftalmolog", label: "Oftalmolog" }, { key: "endokrinolog", label: "Endokrinolog" },
  { key: "urolog", label: "Urolog" }, { key: "xirurg", label: "Xirurg" },
  { key: "uzi", label: "UZI" }, { key: "laborant", label: "Laborant" },
];

// 0 = Yakshanba (backend/booking bilan bir xil)
const WEEKDAYS = [
  { d: 1, s: "Du" }, { d: 2, s: "Se" }, { d: 3, s: "Ch" }, { d: 4, s: "Pa" },
  { d: 5, s: "Ju" }, { d: 6, s: "Sh" }, { d: 0, s: "Ya" },
];

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const itemAnim = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } };

export default function OnboardingPage() {
  const qc = useQueryClient();
  const router = useRouter();

  /* Bosqich 1 — shifokor */
  const [dName, setDName] = useState("");
  const [dSpec, setDSpec] = useState("terapevt");
  const [dUser, setDUser] = useState("");
  const [dPass, setDPass] = useState("");

  /* Bosqich 2 — jadval */
  const [schedDoctor, setSchedDoctor] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("18:00");
  const [slot, setSlot] = useState("30");

  /* Bosqich 3 — xizmat */
  const [sName, setSName] = useState("");
  const [sPrice, setSPrice] = useState("");
  const [sSpec, setSSpec] = useState("");
  const [sDur, setSDur] = useState("30");

  /* Bosqich 4 — xodim */
  const [uName, setUName] = useState("");
  const [uEmail, setUEmail] = useState("");
  const [uRole, setURole] = useState("receptionist");

  const { data: me, isLoading } = useQuery({
    queryKey: ["tenant-me"],
    queryFn: async () => {
      const res = await api.get<MeResponse>("/api/v1/tenants/me");
      if (res.success) return res;
      throw new Error(res.error);
    },
  });

  const { data: docData } = useQuery({
    queryKey: ["doctors"],
    queryFn: async () => {
      const res = await api.get<{ doctors: Doctor[] }>("/api/doctors?limit=100");
      if (res.success) return res;
      throw new Error(res.error);
    },
  });
  const doctors = docData?.doctors ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tenant-me"] });
    qc.invalidateQueries({ queryKey: ["doctors"] });
    qc.invalidateQueries({ queryKey: ["services-active"] });
  };

  /* ── Mutations ── */
  const addDoctor = useMutation({
    mutationFn: async () => {
      const res = await api.post("/api/auth/register-doctor", {
        name: dName.trim(), username: dUser.trim(), password: dPass, specialization: dSpec,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Shifokor qo'shildi");
      setDName(""); setDUser(""); setDPass("");
      refresh();
    },
    onError: (e: Error) => toast.error("Qo'shib bo'lmadi", { description: e.message }),
  });

  const setSchedule = useMutation({
    mutationFn: async () => {
      const res = await api.put(`/api/doctors/${schedDoctor}/schedule`, {
        days, start_time: from, end_time: to, slot_duration: Number(slot),
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => { toast.success("Ish jadvali saqlandi"); refresh(); },
    onError: (e: Error) => toast.error("Saqlab bo'lmadi", { description: e.message }),
  });

  const addService = useMutation({
    mutationFn: async () => {
      const res = await api.post("/api/services", {
        name: sName.trim(), price: Number(sPrice),
        specialty: sSpec || null, duration_min: Number(sDur) || 30,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Xizmat qo'shildi");
      setSName(""); setSPrice(""); setSSpec("");
      refresh();
    },
    onError: (e: Error) => toast.error("Qo'shib bo'lmadi", { description: e.message }),
  });

  const inviteUser = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ message: string }>("/api/v1/tenants/users/invite", {
        name: uName.trim(), email: uEmail.trim().toLowerCase(), role: uRole,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      toast.success("Xodim qo'shildi", { description: res.message });
      setUName(""); setUEmail("");
      refresh();
    },
    onError: (e: Error) => toast.error("Qo'shib bo'lmadi", { description: e.message }),
  });

  const steps = me?.onboarding.steps ?? [];
  const doneCount = steps.filter((s) => s.done).length;
  const ready = me?.onboarding.ready ?? false;
  const clinicCode = me?.tenant.code ?? "";
  const bookingLink = clinicCode
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/mini-app.html?clinic=${clinicCode}`
    : "";

  function copyLink() {
    navigator.clipboard?.writeText(bookingLink)
      .then(() => toast.success("Havola nusxalandi"))
      .catch(() => toast.error("Nusxalab bo'lmadi"));
  }

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  const ICONS: Record<string, React.ElementType> = {
    doctor: Stethoscope, schedule: CalendarDays, service: Wallet, staff: UserPlus,
  };

  if (isLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <motion.div variants={itemAnim}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Klinikangizni sozlash</h1>
          {me?.subscription.trial_days_left != null && (
            <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
              <Sparkles className="size-3" /> Sinov: {me.subscription.trial_days_left} kun qoldi
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {me?.tenant.name} · {doneCount}/4 bosqich bajarildi
          {ready && " · bron qabul qilishga tayyor"}
        </p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(doneCount / 4) * 100}%` }} />
        </div>
      </motion.div>

      {/* Checklist */}
      <motion.div variants={itemAnim} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {steps.map((s) => {
          const Icon = ICONS[s.key] || Check;
          return (
            <Card key={s.key} className={s.done ? "border-emerald-500/30 bg-emerald-500/5" : ""}>
              <CardContent className="flex items-center gap-2.5 p-3">
                <div className={`flex size-8 flex-none items-center justify-center rounded-lg ${s.done ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                  {s.done ? <Check className="size-4" /> : <Icon className="size-4" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.count} ta</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </motion.div>

      {/* 1 — Doctor */}
      <motion.div variants={itemAnim}>
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
              <h2 className="font-semibold">Shifokor qo&apos;shish</h2>
            </div>
            <p className="text-sm text-muted-foreground">Shifokor o&apos;z logini bilan tizimga kirib, AI Scribe&apos;dan foydalanadi.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Ism familiya *</Label>
                <Input value={dName} onChange={(e) => setDName(e.target.value)} placeholder="Akram Akramov" /></div>
              <div className="space-y-1.5"><Label>Yo&apos;nalish *</Label>
                <Select value={dSpec} onValueChange={(v) => setDSpec(v ?? "terapevt")}>
                  <SelectTrigger>
                    <span data-slot="select-value" className="line-clamp-1 flex-1 text-left">
                      {SPECIALIZATIONS.find((x) => x.key === dSpec)?.label || dSpec}
                    </span>
                  </SelectTrigger>
                  <SelectContent>{SPECIALIZATIONS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="space-y-1.5"><Label>Login *</Label>
                <Input value={dUser} onChange={(e) => setDUser(e.target.value)} placeholder="akramov" /></div>
              <div className="space-y-1.5"><Label>Parol *</Label>
                <Input type="text" value={dPass} onChange={(e) => setDPass(e.target.value)} placeholder="kamida 6 belgi" /></div>
            </div>
            <Button onClick={() => addDoctor.mutate()}
              disabled={addDoctor.isPending || !dName.trim() || !dUser.trim() || dPass.length < 6}>
              {addDoctor.isPending ? <Loader2 className="size-4 animate-spin" /> : <Stethoscope className="size-4" />}
              Shifokorni qo&apos;shish
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* 2 — Schedule */}
      <motion.div variants={itemAnim}>
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
              <h2 className="font-semibold">Ish jadvalini belgilash</h2>
            </div>
            <p className="text-sm text-muted-foreground">Jadvalsiz bo&apos;sh vaqt ko&apos;rinmaydi — bemor bron qila olmaydi.</p>
            <div className="space-y-1.5">
              <Label>Shifokor *</Label>
              <Select value={schedDoctor} onValueChange={(v) => setSchedDoctor(v ?? "")}>
                <SelectTrigger>
                  <span data-slot="select-value" className="line-clamp-1 flex-1 text-left">
                    {(() => {
                      const d = doctors.find((x) => x.id === schedDoctor);
                      return d
                        ? `${d.first_name} ${d.last_name || ""}`.trim()
                        : <span className="text-muted-foreground">{doctors.length ? "Shifokorni tanlang" : "Avval shifokor qo'shing"}</span>;
                    })()}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.first_name} {d.last_name || ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Ish kunlari</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w) => (
                  <button key={w.d} type="button" onClick={() => toggleDay(w.d)}
                    className={`size-10 rounded-lg border text-sm font-medium ${days.includes(w.d) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary"}`}>
                    {w.s}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Boshlanish</Label><Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Tugash</Label><Input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Qabul (daq)</Label><Input type="number" min={5} max={240} value={slot} onChange={(e) => setSlot(e.target.value)} /></div>
            </div>
            <Button onClick={() => setSchedule.mutate()} disabled={setSchedule.isPending || !schedDoctor || days.length === 0}>
              {setSchedule.isPending ? <Loader2 className="size-4 animate-spin" /> : <CalendarDays className="size-4" />}
              Jadvalni saqlash
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* 3 — Service */}
      <motion.div variants={itemAnim}>
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
              <h2 className="font-semibold">Xizmat va narx qo&apos;shish</h2>
            </div>
            <p className="text-sm text-muted-foreground">Kassa va chek aynan shu narxlardan foydalanadi.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Xizmat nomi *</Label>
                <Input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Terapevt qabuli" /></div>
              <div className="space-y-1.5"><Label>Narx (so&apos;m) *</Label>
                <Input type="number" min={0} step={1000} value={sPrice} onChange={(e) => setSPrice(e.target.value)} placeholder="80000" /></div>
              <div className="space-y-1.5"><Label>Yo&apos;nalish</Label>
                <Select value={sSpec} onValueChange={(v) => setSSpec(v ?? "")}>
                  <SelectTrigger>
                    <span data-slot="select-value" className="line-clamp-1 flex-1 text-left">
                      {SPECIALIZATIONS.find((x) => x.key === sSpec)?.label
                        || <span className="text-muted-foreground">Ixtiyoriy</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent>{SPECIALIZATIONS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="space-y-1.5"><Label>Davomiyligi (daq)</Label>
                <Input type="number" min={5} max={480} value={sDur} onChange={(e) => setSDur(e.target.value)} /></div>
            </div>
            <Button onClick={() => addService.mutate()} disabled={addService.isPending || !sName.trim() || !sPrice}>
              {addService.isPending ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
              Xizmatni qo&apos;shish
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* 4 — Staff + Telegram */}
      <motion.div variants={itemAnim}>
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
              <h2 className="font-semibold">Xodim va bemor havolasi</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Ism *</Label>
                <Input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Nodira Yusupova" /></div>
              <div className="space-y-1.5"><Label>Email *</Label>
                <Input type="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} placeholder="nodira@klinika.uz" /></div>
              <div className="space-y-1.5"><Label>Roli</Label>
                <Select value={uRole} onValueChange={(v) => setURole(v ?? "receptionist")}>
                  <SelectTrigger>
                    <span data-slot="select-value" className="line-clamp-1 flex-1 text-left">
                      {{ receptionist: "Qabulxona", admin: "Administrator", doctor: "Shifokor" }[uRole] || uRole}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="receptionist">Qabulxona</SelectItem>
                    <SelectItem value="admin">Administrator</SelectItem>
                    <SelectItem value="doctor">Shifokor</SelectItem>
                  </SelectContent>
                </Select></div>
            </div>
            <p className="text-xs text-muted-foreground">Vaqtinchalik parol yaratiladi va xodimga yuboriladi.</p>
            <Button variant="outline" onClick={() => inviteUser.mutate()}
              disabled={inviteUser.isPending || !uName.trim() || !uEmail.trim()}>
              {inviteUser.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Xodimni qo&apos;shish
            </Button>

            <div className="mt-4 rounded-lg border bg-muted/40 p-4">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                <Send className="size-4 text-primary" /> Bemorlar uchun bron havolasi
              </div>
              <p className="mb-2.5 text-xs text-muted-foreground">
                Telegram kanalingizga yoki saytingizga joylashtiring — bemor o&apos;zi bron qiladi.
              </p>
              <div className="flex gap-2">
                <Input readOnly value={bookingLink} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copyLink} title="Nusxalash">
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Finish */}
      <motion.div variants={itemAnim}>
        <Card className={ready ? "border-emerald-500/40 bg-emerald-500/5" : ""}>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            {ready ? (
              <>
                <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Check className="size-6" />
                </div>
                <div>
                  <h3 className="font-semibold">Tayyor — bron qabul qilishingiz mumkin</h3>
                  <p className="text-sm text-muted-foreground">Qabulxonaga o&apos;tib birinchi bemorni yozing</p>
                </div>
                <Button onClick={() => router.push("/reception")}>
                  Qabulxonaga o&apos;tish <ArrowRight className="size-4" />
                </Button>
              </>
            ) : (
              <>
                <h3 className="font-semibold">Yana biroz qoldi</h3>
                <p className="text-sm text-muted-foreground">
                  Bron qabul qilish uchun shifokor, ish jadvali va xizmat narxi kerak.
                </p>
                <Button variant="outline" onClick={() => router.push("/dashboard")}>
                  Keyinroq sozlayman
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
