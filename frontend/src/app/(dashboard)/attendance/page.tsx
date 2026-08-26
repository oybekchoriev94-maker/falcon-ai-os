"use client";

// ============================================================
// Davomat va Face ID v2 — xodimlar + bemorlar
//
// Yuz shablonlari klinika kompyuterida qoladi. Bu sahifa faqat
// hodisalarni ko'rsatadi: kim qachon keldi/ketdi, jonlilik
// tekshiruvi natijasi (liveness) va xom hodisalar.
//
// Foto hujum shubhasi — FLAG, o'chirish yo'q (dalil doktrinasi).
// ============================================================

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  Users, UserCheck, Clock, Wifi, WifiOff, CalendarDays, Download,
  HeartPulse, ScanFace, ShieldCheck, ShieldAlert, List,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Person {
  person_name: string;
  first_in: string | null;
  last_out: string | null;
  arrivals: number;
  present: boolean;
}

interface PatientArrival {
  person_name: string;
  first_in: string | null;
  liveness_ok: boolean;
}

interface FaceEvent {
  person_name: string;
  direction: "in" | "out";
  occurred_at: string;
  confidence: number | null;
  source: string | null;
  subject_type: "staff" | "patient";
  frame_count: number | null;
  liveness_score: number | null;
  liveness_ok: boolean | null;
  flag: string | null;
}

interface TodayResp {
  date: string;
  agent: { name: string | null; last_seen_at: string | null; online: boolean };
  present_count: number;
  arrived_count: number;
  people: Person[];
  patient_arrivals: PatientArrival[];
}

interface EventsResp {
  date: string;
  events: FaceEvent[];
}

type EventFilter = "all" | "staff" | "patient";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const today = () => new Date().toLocaleDateString("en-CA");

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

/** Ish davomiyligi: birinchi kirishdan oxirgi chiqishgacha (yoki hozirgacha) */
function duration(p: Person) {
  if (!p.first_in) return "—";
  const start = new Date(p.first_in).getTime();
  const end = p.present ? Date.now() : (p.last_out ? new Date(p.last_out).getTime() : start);
  const min = Math.max(0, Math.round((end - start) / 60000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} soat ${min % 60} daq` : `${min} daq`;
}

/**
 * Jonlilik nishoni: flag server tomonidan qo'yiladi (photo_suspect /
 * low_frames). Eski agentlar metadata yubormaydi — 'legacy'.
 */
function LivenessBadge({ ev }: { ev: FaceEvent }) {
  if (ev.flag === "photo_suspect") {
    return (
      <Badge variant="outline" className="gap-1 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
        <ShieldAlert className="size-3" /> Foto shubhasi
      </Badge>
    );
  }
  if (ev.flag === "low_frames") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <ShieldAlert className="size-3" /> Kam kadr
      </Badge>
    );
  }
  if (ev.frame_count == null) {
    return <Badge variant="secondary" className="text-xs">Eski agent</Badge>;
  }
  if (ev.liveness_ok) {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <ShieldCheck className="size-3" /> Jonli
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
      <ShieldAlert className="size-3" /> Tekshiruvdan o&apos;tmadi
    </Badge>
  );
}

/** Bemorlar kelishi: xom 'patient' hodisalaridan yig'iladi (bugun va o'tgan kunlar) */
interface PatientRow {
  person_name: string;
  first_in: string | null;
  last_out: string | null;
  liveness_ok: boolean;
  suspect: boolean;
}

function aggregatePatients(events: FaceEvent[]): PatientRow[] {
  const map = new Map<string, PatientRow>();
  for (const ev of events) {
    if (ev.subject_type !== "patient") continue;
    const slot = map.get(ev.person_name) ?? {
      person_name: ev.person_name,
      first_in: null,
      last_out: null,
      liveness_ok: false,
      suspect: false,
    };
    if (ev.direction === "in") {
      if (!slot.first_in || ev.occurred_at < slot.first_in) slot.first_in = ev.occurred_at;
      if (ev.liveness_ok) slot.liveness_ok = true;
      if (ev.flag) slot.suspect = true;
    } else if (!slot.last_out || ev.occurred_at > slot.last_out) {
      slot.last_out = ev.occurred_at;
    }
    map.set(ev.person_name, slot);
  }
  return [...map.values()].sort((a, b) =>
    (a.first_in ?? "").localeCompare(b.first_in ?? "")
  );
}

export default function AttendancePage() {
  const [date, setDate] = useState(today());
  const [tab, setTab] = useState("staff");
  const [filter, setFilter] = useState<EventFilter>("all");
  const isToday = date === today();

  // Xodimlar jadvali — bugun jonli, o'tgan kunlar statik
  const { data, isLoading } = useQuery({
    queryKey: ["attendance", date],
    queryFn: async () => {
      const path = isToday ? "/api/attendance/today" : `/api/attendance/report?date=${date}`;
      const res = await api.get<TodayResp>(path);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    refetchInterval: isToday ? 30_000 : false,
  });

  // Xom hodisalar — bemorlar kelishi va filtr uchun (faqat rahbar)
  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ["attendance-events", date, filter],
    queryFn: async () => {
      const res = await api.get<EventsResp>(`/api/attendance/events?date=${date}&type=${filter}`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  const people = data?.people ?? [];
  const present = people.filter((p) => p.present);
  const agent = data?.agent;
  const events = eventsData?.events ?? [];
  const patients = aggregatePatients(eventsData?.events ?? []);
  const suspectCount = events.filter((e) => e.flag).length;

  function exportCsv() {
    const rows = [
      ["Ism", "Birinchi kirish", "Oxirgi chiqish", "Kelishlar", "Davomiylik", "Holat"],
      ...people.map((p) => [
        p.person_name, fmtTime(p.first_in), fmtTime(p.last_out),
        String(p.arrivals), duration(p), p.present ? "Ichkarida" : "Ketgan",
      ]),
    ];
    // BOM — Excel kirillni to'g'ri ochsin
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `davomat-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={itemAnim} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Davomat va Face ID</h1>
          <p className="text-sm text-muted-foreground">
            Xodimlar va bemorlarning yuz tanish orqali kelish-ketishi
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <Input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value || today())}
            className="w-40"
          />
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!people.length}>
            <Download className="size-4" /> Excel
          </Button>
        </div>
      </motion.div>

      {/* Agent holati — faqat bugun uchun ma'noli */}
      {isToday && agent && (
        <motion.div
          variants={itemAnim}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
            agent.online
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400"
          )}
        >
          {agent.online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
          {agent.online ? (
            <span>Kamera ulangan{agent.name ? ` — ${agent.name}` : ""}</span>
          ) : (
            <span>
              Kamera aloqada emas
              {agent.last_seen_at && ` — oxirgi aloqa ${fmtTime(agent.last_seen_at)}`}
              . Klinika kompyuterida agent ishlayotganini tekshiring.
            </span>
          )}
        </motion.div>
      )}

      <motion.div variants={itemAnim}>
        <Tabs value={tab} onValueChange={(v) => { if (v !== null) setTab(v); }}>
          <TabsList variant="line" className="mb-4">
            <TabsTrigger value="staff" className="gap-1.5">
              <Users className="size-4" /> Xodimlar
            </TabsTrigger>
            <TabsTrigger value="patients" className="gap-1.5">
              <HeartPulse className="size-4" /> Bemorlar
            </TabsTrigger>
            <TabsTrigger value="events" className="gap-1.5">
              <List className="size-4" /> Hodisalar
            </TabsTrigger>
          </TabsList>

          {/* ── XODIMLAR ─────────────────────────────────────────── */}
          <TabsContent value="staff" className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Hozir ichkarida", value: present.length, Icon: UserCheck, tone: "text-emerald-600 dark:text-emerald-400" },
                { label: "Bugun kelganlar", value: people.length, Icon: Users, tone: "" },
                { label: "Jami kelishlar", value: people.reduce((s, p) => s + p.arrivals, 0), Icon: Clock, tone: "" },
                { label: "Shubhali hodisalar", value: suspectCount, Icon: ShieldAlert, tone: suspectCount ? "text-red-600 dark:text-red-400" : "" },
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

            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="space-y-2 p-4">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
                  </div>
                ) : !people.length ? (
                  <div className="py-16 text-center">
                    <Users className="mx-auto size-10 text-muted-foreground/40" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      {isToday ? "Bugun hali hech kim qayd etilmadi" : "Bu kunda yozuv yo'q"}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="p-3 text-left font-medium">Ism</th>
                          <th className="p-3 text-left font-medium">Birinchi kirish</th>
                          <th className="p-3 text-left font-medium">Oxirgi chiqish</th>
                          <th className="p-3 text-left font-medium">Kelishlar</th>
                          <th className="p-3 text-left font-medium">Davomiylik</th>
                          <th className="p-3 text-left font-medium">Holat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {people.map((p) => (
                          <tr key={p.person_name} className="border-b last:border-0">
                            <td className="p-3 font-medium">{p.person_name}</td>
                            <td className="p-3 tabular-nums">{fmtTime(p.first_in)}</td>
                            <td className="p-3 tabular-nums text-muted-foreground">
                              {p.present ? "—" : fmtTime(p.last_out)}
                            </td>
                            <td className="p-3 tabular-nums">{p.arrivals}</td>
                            <td className="p-3 text-muted-foreground">{duration(p)}</td>
                            <td className="p-3">
                              {p.present ? (
                                <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400">
                                  <span className="size-1.5 rounded-full bg-emerald-500" />
                                  Ichkarida
                                </Badge>
                              ) : (
                                <Badge variant="secondary">Ketgan</Badge>
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
          </TabsContent>

          {/* ── BEMORLAR ─────────────────────────────────────────── */}
          <TabsContent value="patients" className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "Kelgan bemorlar", value: patients.filter((p) => p.first_in).length, Icon: HeartPulse, tone: "" },
                { label: "Jonlilik o'tgan", value: patients.filter((p) => p.liveness_ok).length, Icon: ShieldCheck, tone: "text-emerald-600 dark:text-emerald-400" },
                { label: "Shubhali", value: patients.filter((p) => p.suspect).length, Icon: ShieldAlert, tone: patients.some((p) => p.suspect) ? "text-red-600 dark:text-red-400" : "" },
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

            <Card>
              <CardContent className="p-0">
                {eventsLoading ? (
                  <div className="space-y-2 p-4">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
                  </div>
                ) : !patients.length ? (
                  <div className="py-16 text-center">
                    <HeartPulse className="mx-auto size-10 text-muted-foreground/40" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      Bu kunda Face ID orqali bemor kelmadi
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      Bemor yuzi <code className="rounded bg-muted px-1">faces/bemor_Ism</code> papkasida ro&apos;yxatdan o&apos;tgan bo&apos;lishi kerak
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="p-3 text-left font-medium">Bemor</th>
                          <th className="p-3 text-left font-medium">Birinchi kirish</th>
                          <th className="p-3 text-left font-medium">Oxirgi chiqish</th>
                          <th className="p-3 text-left font-medium">Jonlilik tekshiruvi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {patients.map((p) => (
                          <tr key={p.person_name} className="border-b last:border-0">
                            <td className="p-3 font-medium">{p.person_name}</td>
                            <td className="p-3 tabular-nums">{fmtTime(p.first_in)}</td>
                            <td className="p-3 tabular-nums text-muted-foreground">{fmtTime(p.last_out)}</td>
                            <td className="p-3">
                              {p.suspect ? (
                                <Badge variant="outline" className="gap-1 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
                                  <ShieldAlert className="size-3" /> Tekshirish kerak
                                </Badge>
                              ) : p.liveness_ok ? (
                                <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                  <ShieldCheck className="size-3" /> Jonli tasdiqlangan
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">Ma&apos;lumot yo&apos;q</Badge>
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
              Bemor Face ID orqali kelganda qabulxona navbatiga avtomatik qo&apos;shiladi.
            </p>
          </TabsContent>

          {/* ── XOM HODISALAR ────────────────────────────────────── */}
          <TabsContent value="events" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ScanFace className="size-4" />
                Xom hodisalar (oxirgi 500 ta)
              </div>
              <Select value={filter} onValueChange={(v) => { if (v !== null) setFilter(v as EventFilter); }}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hammasi</SelectItem>
                  <SelectItem value="staff">Faqat xodimlar</SelectItem>
                  <SelectItem value="patient">Faqat bemorlar</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card>
              <CardContent className="p-0">
                {eventsLoading ? (
                  <div className="space-y-2 p-4">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
                  </div>
                ) : !events.length ? (
                  <div className="py-16 text-center">
                    <List className="mx-auto size-10 text-muted-foreground/40" />
                    <p className="mt-3 text-sm text-muted-foreground">Bu kunda hodisa yo&apos;q</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="p-3 text-left font-medium">Vaqt</th>
                          <th className="p-3 text-left font-medium">Ism</th>
                          <th className="p-3 text-left font-medium">Kim</th>
                          <th className="p-3 text-left font-medium">Yo&apos;nalish</th>
                          <th className="p-3 text-left font-medium">Ishonch</th>
                          <th className="p-3 text-left font-medium">Kadr</th>
                          <th className="p-3 text-left font-medium">Jonlilik</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((ev, i) => (
                          <tr key={`${ev.person_name}-${ev.occurred_at}-${i}`} className="border-b last:border-0">
                            <td className="p-3 tabular-nums">{fmtTime(ev.occurred_at)}</td>
                            <td className="p-3 font-medium">{ev.person_name}</td>
                            <td className="p-3">
                              <Badge variant={ev.subject_type === "patient" ? "secondary" : "outline"} className="text-xs">
                                {ev.subject_type === "patient" ? "Bemor" : "Xodim"}
                              </Badge>
                            </td>
                            <td className="p-3">
                              <span className={cn(
                                "text-xs font-medium",
                                ev.direction === "in"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-muted-foreground"
                              )}>
                                {ev.direction === "in" ? "Kirdi" : "Chiqdi"}
                              </span>
                            </td>
                            <td className="p-3 tabular-nums text-muted-foreground">
                              {ev.confidence != null ? `${Math.round(ev.confidence * 100)}%` : "—"}
                            </td>
                            <td className="p-3 tabular-nums text-muted-foreground">{ev.frame_count ?? "—"}</td>
                            <td className="p-3"><LivenessBadge ev={ev} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>

      <p className="text-xs text-muted-foreground">
        Yuz shablonlari klinika kompyuterida saqlanadi va bu serverga
        yuborilmaydi — bu yerda faqat kelish/ketish vaqtlari va jonlilik
        tekshiruvi natijasi ko&apos;rinadi.
      </p>
    </motion.div>
  );
}
