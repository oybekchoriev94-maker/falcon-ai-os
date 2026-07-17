"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Plus,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  ClipboardList,
  HeartPulse,
  CalendarDays,
  RefreshCw,
  Loader2,
  UserPlus,
  FileText,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

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

type StatusType = QueueItem["status"];

const FILTER_OPTIONS: { value: StatusType | "all"; label: string }[] = [
  { value: "all", label: "Barchasi" },
  { value: "waiting", label: "Kutilmoqda" },
  { value: "in_progress", label: "Qabulda" },
  { value: "completed", label: "Yakunlangan" },
  { value: "cancelled", label: "Bekor qilingan" },
];

const STATUS_CONFIG: Record<StatusType, { label: string; icon: React.ElementType; color: string }> = {
  waiting: {
    label: "Kutilmoqda",
    icon: Clock,
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  in_progress: {
    label: "Qabulda",
    icon: Play,
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  },
  completed: {
    label: "Yakunlangan",
    icon: CheckCircle2,
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  cancelled: {
    label: "Bekor qilingan",
    icon: XCircle,
    color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  },
};

const STATS_CARDS = [
  { key: "waiting" as const, label: "Kutilayotgan", icon: Clock, color: "from-amber-500/20 to-amber-500/5" },
  { key: "in_progress" as const, label: "Qabulda", icon: Play, color: "from-blue-500/20 to-blue-500/5" },
  { key: "completed" as const, label: "Yakunlangan", icon: CheckCircle2, color: "from-emerald-500/20 to-emerald-500/5" },
  { key: "total" as const, label: "Bugungi jami", icon: Users, color: "from-purple-500/20 to-purple-500/5" },
];

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

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemAnim = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("uz-UZ", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

export default function ReceptionPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<StatusType | "all">("all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const [formPatient, setFormPatient] = useState("");
  const [formDoctor, setFormDoctor] = useState("");
  const [formDept, setFormDept] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["queues"],
    queryFn: async () => {
      const res = await api.get<QueuesResponse>("/api/voice/queues");
      if (res.success) return res;
      throw new Error(res.error);
    },
    refetchInterval: 30_000,
  });

  const queues = data?.queues ?? [];

  const addMutation = useMutation({
    mutationFn: async (body: {
      patient_name: string;
      doctor_name: string;
      department: string;
      appointment_time: string;
      notes?: string;
    }) => {
      const res = await api.post("/api/reception/confirm", body);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Navbatga qo'shildi");
      queryClient.invalidateQueries({ queryKey: ["queues"] });
      setAddOpen(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Xatolik yuz berdi");
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.post("/api/appointments/complete-status", { id });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Qabul yakunlandi");
      queryClient.invalidateQueries({ queryKey: ["queues"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Xatolik yuz berdi");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.post("/api/appointments/cancel", { id });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Bekor qilindi");
      queryClient.invalidateQueries({ queryKey: ["queues"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Xatolik yuz berdi");
    },
  });

  const startMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.post("/api/reception/confirm", { id, status: "in_progress" });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Qabul boshlandi");
      queryClient.invalidateQueries({ queryKey: ["queues"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Xatolik yuz berdi");
    },
  });

  const filteredQueues = useMemo(() => {
    let items = queues;
    if (statusFilter !== "all") {
      items = items.filter((q) => q.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (r) =>
          r.patient_name.toLowerCase().includes(q) ||
          r.doctor_name.toLowerCase().includes(q) ||
          r.department.toLowerCase().includes(q)
      );
    }
    return items;
  }, [queues, statusFilter, search]);

  const stats = useMemo(() => {
    const waiting = queues.filter((q) => q.status === "waiting").length;
    const inProgress = queues.filter((q) => q.status === "in_progress").length;
    const completed = queues.filter((q) => q.status === "completed").length;
    const cancelled = queues.filter((q) => q.status === "cancelled").length;
    return { waiting, in_progress: inProgress, completed, cancelled, total: queues.length };
  }, [queues]);

  function resetForm() {
    setFormPatient("");
    setFormDoctor("");
    setFormDept("");
    setFormTime("");
    setFormNotes("");
  }

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formPatient.trim() || !formDoctor.trim() || !formDept || !formTime.trim()) {
      toast.error("Iltimos, barcha majburiy maydonlarni to'ldiring");
      return;
    }
    addMutation.mutate({
      patient_name: formPatient.trim(),
      doctor_name: formDoctor.trim(),
      department: formDept,
      appointment_time: formTime,
      notes: formNotes.trim() || undefined,
    });
  }

  function handleAction(item: QueueItem, action: "start" | "complete" | "cancel") {
    if (action === "complete") completeMutation.mutate(item.id);
    else if (action === "cancel") cancelMutation.mutate(item.id);
    else startMutation.mutate(item.id);
  }

  function isPendingOn(id: number) {
    return (
      (completeMutation.isPending && completeMutation.variables === id) ||
      (cancelMutation.isPending && cancelMutation.variables === id) ||
      (startMutation.isPending && startMutation.variables === id)
    );
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemAnim} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Navbat boshqaruvi</h1>
          <p className="text-sm text-muted-foreground">
            Bemorlarni qabulga navbatga qo&apos;yish va kuzatish
            {user?.full_name && <> &mdash; {user.full_name}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            Jonli
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Yangilash
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger
              render={
                <Button>
                  <UserPlus className="size-4" />
                  Navbatga qo&apos;shish
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Navbatga qo&apos;shish</DialogTitle>
                <DialogDescription>
                  Bemor ma&apos;lumotlarini to&apos;ldiring va navbatga qo&apos;shing
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="patient">Bemor ismi *</Label>
                  <Input
                    id="patient"
                    placeholder="Bemor ismini kiriting"
                    value={formPatient}
                    onChange={(e) => setFormPatient(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="doctor">Shifokor *</Label>
                  <Input
                    id="doctor"
                    placeholder="Shifokor ismini kiriting"
                    value={formDoctor}
                    onChange={(e) => setFormDoctor(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Bo&apos;lim *</Label>
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
                <div className="space-y-2">
                  <Label htmlFor="time">Vaqt *</Label>
                  <Input
                    id="time"
                    type="datetime-local"
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Izoh</Label>
                  <Textarea
                    id="notes"
                    placeholder="Qo'shimcha ma'lumot"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    rows={3}
                  />
                </div>
                <DialogFooter>
                  <DialogClose render={<Button type="button" variant="outline">Bekor qilish</Button>} />
                  <Button type="submit" disabled={addMutation.isPending}>
                    {addMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                    Saqlash
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemAnim} className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {STATS_CARDS.map((s) => (
          <Card key={s.key} className="relative overflow-hidden border-border/50">
            <div className={`absolute inset-0 bg-gradient-to-br ${s.color}`} />
            <CardContent className="relative p-3 md:p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {s.label}
                </span>
                <s.icon className="size-3.5 text-muted-foreground/60" />
              </div>
              {isLoading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <div className="text-xl font-bold tracking-tight">
                  {stats[s.key]}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </motion.div>

      {/* Filter + Search */}
      <motion.div variants={itemAnim} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTER_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={statusFilter === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(opt.value)}
            >
              {opt.label}
              {opt.value !== "all" && (
                <span className="ml-1 text-xs opacity-70">{stats[opt.value]}</span>
              )}
            </Button>
          ))}
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Qidirish..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </motion.div>

      {/* Queue List */}
      {isLoading ? (
        <motion.div variants={itemAnim} className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </motion.div>
      ) : isError ? (
        <motion.div variants={itemAnim}>
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <XCircle className="size-10 text-destructive mb-3" />
              <p className="font-medium">Ma&apos;lumotlarni yuklashda xatolik</p>
              <p className="text-sm text-muted-foreground mt-1">Qayta urinib ko&apos;ring</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
                <RefreshCw className="size-3.5" />
                Qayta yuklash
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : filteredQueues.length === 0 ? (
        <motion.div variants={itemAnim}>
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardList className="size-12 text-muted-foreground/40 mb-4" />
              <p className="text-base font-medium">Navbat bo&apos;sh</p>
              <p className="text-sm text-muted-foreground mt-1">
                {search || statusFilter !== "all"
                  ? "Ushbu filtr bo'yicha hech qanday yozuv topilmadi"
                  : "Hozircha navbatda bemorlar yo'q"}
              </p>
              {(search || statusFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                  }}
                >
                  Filtrlarni tozalash
                </Button>
              )}
              {!search && statusFilter === "all" && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddOpen(true)}>
                  <UserPlus className="size-3.5" />
                  Birinchi bemorni qo&apos;shish
                </Button>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <motion.div variants={itemAnim} className="space-y-3">
          {filteredQueues.map((item, index) => {
            const StatusIcon = STATUS_CONFIG[item.status].icon;
            const pending = isPendingOn(item.id);
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <Card className="border-border/50 transition-colors hover:border-border/80">
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium truncate">{item.patient_name}</span>
                          <Badge variant="outline" className={`shrink-0 ${STATUS_CONFIG[item.status].color}`}>
                            <StatusIcon className="size-3 mr-1" />
                            {STATUS_CONFIG[item.status].label}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
                          <span className="text-muted-foreground/60">{formatDate(item.created_at)}</span>
                        </div>
                        {item.notes && (
                          <p className="text-xs text-muted-foreground/70 mt-1.5 line-clamp-1">{item.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.status === "waiting" && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => handleAction(item, "start")}
                            disabled={pending}
                          >
                            {pending ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Play className="size-3.5" />
                            )}
                            <span className="hidden sm:inline">Boshlash</span>
                          </Button>
                        )}
                        {item.status === "in_progress" && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => handleAction(item, "complete")}
                            disabled={pending}
                          >
                            {pending ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="size-3.5" />
                            )}
                            <span className="hidden sm:inline">Yakunlash</span>
                          </Button>
                        )}
                        {(item.status === "waiting" || item.status === "in_progress") && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleAction(item, "cancel")}
                            disabled={pending}
                          >
                            <XCircle className="size-3.5" />
                            <span className="hidden sm:inline">Bekor qilish</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </motion.div>
  );
}
