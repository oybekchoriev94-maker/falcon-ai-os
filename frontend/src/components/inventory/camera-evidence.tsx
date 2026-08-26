"use client";

// ============================================================
// Ombor-kamera korrelyatsiyasi (PR #12) — yagona dashboard
//
// Har bir kirim/chiqimga o'sha payt ombor zonasida kamera
// hodisasi bo'lganmi. Kamera yo'q = SIGNAL, jazo emas.
// ============================================================

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Camera, CameraOff, CalendarDays, Package, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface EvidenceRow {
  tx_id: string | null;
  type: string | null;
  quantity: number | null;
  item_name: string | null;
  performed_by: string | null;
  reason: string | null;
  created_at: string | null;
  camera_evidence: boolean;
  matched_events: number;
  nearest_event_at: string | null;
  nearest_subject_ref: string | null;
  flags: string[];
}

interface EvidenceResp {
  date: string;
  zone: string;
  window_minutes: number;
  summary: { total: number; with_camera: number; without_camera: number; kamomad: number };
  rows: EvidenceRow[];
}

const TX_LABEL: Record<string, string> = {
  IN: "Kirim",
  CONSUMPTION: "Sarflash",
  VOICE_RECEIPT: "Ovozli kirim",
  ADJUST: "Tuzatish",
};

const today = () => new Date().toLocaleDateString("en-CA");

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

export default function CameraEvidenceSection() {
  const [date, setDate] = useState(today());

  const { data, isLoading } = useQuery({
    queryKey: ["camera-evidence", date],
    queryFn: async () => {
      const res = await api.get<EvidenceResp>(`/api/inventory/camera-evidence?date=${date}&zone=ombor&window=5`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  const summary = data?.summary;
  const rows = data?.rows ?? [];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Camera className="size-4 text-primary" /> Kamera nazorati
          </CardTitle>
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-muted-foreground" />
            <Input
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value || today())}
              className="w-40 h-8"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Har bir ombor amaliga ±5 daqiqa oynasida kamera hodisasi bog&apos;lanadi
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : !summary || !summary.total ? (
          <div className="py-8 text-center">
            <Package className="mx-auto size-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">Bu kunda ombor amali yo&apos;q</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Jami amallar", value: summary.total, tone: "" },
                { label: "Kamerali", value: summary.with_camera, tone: "text-emerald-600 dark:text-emerald-400" },
                { label: "Kamerasiz", value: summary.without_camera, tone: summary.without_camera ? "text-amber-600 dark:text-amber-400" : "" },
                { label: "Kamomad", value: summary.kamomad, tone: summary.kamomad ? "text-red-600 dark:text-red-400" : "" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className={cn("mt-0.5 text-xl font-bold", s.tone)}>{s.value}</div>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2.5 text-left font-medium">Vaqt</th>
                    <th className="p-2.5 text-left font-medium">Amal</th>
                    <th className="p-2.5 text-left font-medium">Mahsulot</th>
                    <th className="p-2.5 text-left font-medium">Miqdor</th>
                    <th className="p-2.5 text-left font-medium">Kamera</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={r.tx_id ?? i} className="border-b last:border-0">
                      <td className="p-2.5 tabular-nums">{fmtTime(r.created_at)}</td>
                      <td className="p-2.5">
                        <Badge variant="secondary" className="text-xs">
                          {TX_LABEL[r.type ?? ""] || r.type}
                        </Badge>
                      </td>
                      <td className="p-2.5 max-w-40 truncate">{r.item_name || "—"}</td>
                      <td className="p-2.5 tabular-nums">{r.quantity ?? "—"}</td>
                      <td className="p-2.5">
                        {r.flags.includes("kamomad") ? (
                          <Badge variant="outline" className="gap-1 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
                            <AlertTriangle className="size-3" /> Kamomad
                          </Badge>
                        ) : r.camera_evidence ? (
                          <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <Camera className="size-3" /> {r.matched_events} ta hodisa
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                            <CameraOff className="size-3" /> Kamerasiz
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              Kamerasiz amal — signal, jazo emas. Kamera ishlamagan yoki zona qamrovi
              yetarli emasligi mumkin.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
