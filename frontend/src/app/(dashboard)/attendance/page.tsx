"use client";

// ============================================================
// Xodimlar davomati — yuz tanish orqali keldi/ketdi
//
// Yuz shablonlari klinika kompyuterida qoladi. Bu sahifa faqat
// hodisalarni ko'rsatadi: kim qachon keldi/ketdi.
// ============================================================

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import {
  Users, UserCheck, Clock, Wifi, WifiOff, CalendarDays, Download,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Person {
  person_name: string;
  first_in: string | null;
  last_out: string | null;
  arrivals: number;
  present: boolean;
}

interface TodayResp {
  success: true;
  date: string;
  agent: { name: string | null; last_seen_at: string | null; online: boolean };
  present_count: number;
  arrived_count: number;
  people: Person[];
}

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

export default function AttendancePage() {
  const [date, setDate] = useState(today());
  const isToday = date === today();

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", date],
    queryFn: async () => {
      const path = isToday ? "/api/attendance/today" : `/api/attendance/report?date=${date}`;
      const res = await api.get<TodayResp>(path);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    // Bugungi kun jonli yangilanadi, o'tgan kunlar o'zgarmaydi
    refetchInterval: isToday ? 30_000 : false,
  });

  const people = data?.people ?? [];
  const present = people.filter((p) => p.present);
  const agent = data?.agent;

  function exportCsv() {
    const rows = [
      ["Ism", "Birinchi kirish", "Oxirgi chiqish", "Kelishlar", "Davomiylik", "Holat"],
      ...people.map((p) => [
        p.person_name, fmtTime(p.first_in), fmtTime(p.last_out),
        String(p.arrivals), duration(p), p.present ? "Ichkarida" : "Ketgan",
      ]),
    ];
    // BOM — Excel kirillni to'g'ri ochsin
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `davomat-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Xodimlar davomati</h1>
          <p className="text-sm text-muted-foreground">
            Yuz tanish orqali kelish va ketish vaqtlari
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
      </div>

      {/* Agent holati — faqat bugun uchun ma'noli */}
      {isToday && agent && (
        <div
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
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "Hozir ichkarida", value: present.length, Icon: UserCheck, tone: "text-emerald-600 dark:text-emerald-400" },
          { label: "Bugun kelganlar", value: people.length, Icon: Users, tone: "" },
          { label: "Jami kelishlar", value: people.reduce((s, p) => s + p.arrivals, 0), Icon: Clock, tone: "" },
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
                {isToday
                  ? "Bugun hali hech kim qayd etilmadi"
                  : "Bu kunda yozuv yo'q"}
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

      <p className="text-xs text-muted-foreground">
        Yuz shablonlari klinika kompyuterida saqlanadi va bu serverga
        yuborilmaydi — bu yerda faqat kelish/ketish vaqtlari ko&apos;rinadi.
      </p>
    </div>
  );
}
