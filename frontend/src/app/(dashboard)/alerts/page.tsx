"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { AlertTriangle, Bell, CheckCircle2, Loader2, User, FolderOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Alert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  details: string | null;
  agent_name: string;
  source_kind: string;
  patient_id: string | null;
  admission_id: string | null;
  patient_name: string | null;
  medical_record_number: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface AlertsResponse {
  alerts: Alert[];
  counts: { critical: number; warning: number; info: number; total: number };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("uz-UZ", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

const SEV = {
  critical: { color: "text-rose-600", bg: "bg-rose-500/10", border: "border-rose-500/30", label: "Kritik" },
  warning:  { color: "text-amber-600", bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Ogohlantirish" },
  info:     { color: "text-blue-600",  bg: "bg-blue-500/10",  border: "border-blue-500/30",  label: "Ma'lumot" },
};

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"unresolved" | "resolved">("unresolved");

  const { data, isLoading } = useQuery({
    queryKey: ["alerts", tab],
    queryFn: async () => {
      const res = await api.get<AlertsResponse>(`/api/alerts?status=${tab}&limit=200`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    refetchInterval: 15_000,
  });

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/api/alerts/${id}/resolve`, {});
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Alert yechildi");
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts = data?.counts || { critical: 0, warning: 0, info: 0, total: 0 };
  const alerts = data?.alerts ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center">
          <Bell className="size-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI Xavfsizlik ogohlantirishlari</h1>
          <p className="text-xs text-muted-foreground">
            Obhod, laborator natijalari va retsept buyurilganda avtomatik tekshiriladi
          </p>
        </div>
      </div>

      {/* Statistika */}
      <div className="grid grid-cols-3 gap-3">
        <CountCard label="Kritik" value={counts.critical} sev="critical" />
        <CountCard label="Ogohlantirish" value={counts.warning} sev="warning" />
        <CountCard label="Ma'lumot" value={counts.info} sev="info" />
      </div>

      {/* Tab */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab("unresolved")}
          className={cn(
            "rounded-lg border px-4 py-2 text-sm font-medium",
            tab === "unresolved" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
          )}>
          Yechilmagan
        </button>
        <button
          onClick={() => setTab("resolved")}
          className={cn(
            "rounded-lg border px-4 py-2 text-sm font-medium",
            tab === "resolved" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
          )}>
          Yechilgan
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {tab === "unresolved" ? "Yechilmagan ogohlantirish yo'q ✓" : "Yechilgan alertlar bo'sh"}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <AlertRow key={a.id} alert={a}
              onResolve={() => resolve.mutate(a.id)}
              busy={resolve.isPending && resolve.variables === a.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function CountCard({ label, value, sev }: { label: string; value: number; sev: keyof typeof SEV }) {
  const s = SEV[sev];
  return (
    <Card className={cn("border", s.border, s.bg)}>
      <CardContent className="p-4">
        <p className={cn("text-xs font-medium uppercase tracking-wider", s.color)}>{label}</p>
        <p className={cn("text-2xl font-bold mt-1", s.color)}>{value}</p>
      </CardContent>
    </Card>
  );
}

function AlertRow({ alert, onResolve, busy }: { alert: Alert; onResolve: () => void; busy: boolean }) {
  const s = SEV[alert.severity];
  const resolved = !!alert.resolved_at;
  return (
    <Card className={cn("border", s.border, resolved ? "opacity-60" : s.bg)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <AlertTriangle className={cn("size-5 shrink-0 mt-0.5", s.color)} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{alert.title}</span>
                <Badge variant="outline" className="text-[10px]">{s.label}</Badge>
                <Badge variant="secondary" className="text-[10px]">{alert.agent_name}</Badge>
              </div>
              {alert.details && <p className="text-sm text-muted-foreground mt-1">{alert.details}</p>}
              <div className="flex items-center gap-3 text-xs text-muted-foreground/80 mt-2">
                {alert.patient_name && (
                  <span className="flex items-center gap-1"><User className="size-3" />{alert.patient_name}</span>
                )}
                {alert.medical_record_number && (
                  <span className="font-mono">{alert.medical_record_number}</span>
                )}
                <span>{fmtDate(alert.created_at)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {alert.patient_id && (
              <Link href={`/patients/${alert.patient_id}`} target="_blank"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <FolderOpen className="size-3" /> Karta
              </Link>
            )}
            {!resolved && (
              <Button size="sm" variant="outline" onClick={onResolve} disabled={busy}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                Yechildi
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
