"use client";

// ============================================================
// Medplum (FHIR) sinhronizatsiya — bemor va qabullarni tashqi
// Medplum serveriga jo'natish. MEDPLUM_BASE_URL sozlanmasa —
// o'chiq, sahifa buni ochiq aytadi.
//
// Bemor/qabul ID'si mos sahifadagi URL'dan olinadi (masalan
// /patients/<id>) — hozircha bu yerda alohida qidiruv yo'q.
// ============================================================

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { RefreshCw, Link2, CircleCheck, CircleAlert, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface MedplumStatus { enabled: boolean; mapped: number }
interface MappingRow {
  entity: "patient" | "appointment"; local_id: string; external_id: string;
  external_version: string | null; synced_at: string;
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function MedplumPage() {
  const queryClient = useQueryClient();
  const [entity, setEntity] = useState<"patient" | "appointment">("patient");
  const [id, setId] = useState("");

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["medplum-status"],
    queryFn: async () => {
      const res = await api.get<MedplumStatus>("/api/v1/medplum/status");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  const { data: mappingsData, isLoading: mappingsLoading } = useQuery({
    queryKey: ["medplum-mappings"],
    enabled: !!status?.enabled,
    queryFn: async () => {
      const res = await api.get<{ mappings: MappingRow[] }>("/api/v1/medplum/mappings");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });
  const mappings = mappingsData?.mappings ?? [];

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!UUID_RE.test(id.trim())) throw new Error("ID UUID formatda bo'lishi shart");
      const path = entity === "patient"
        ? `/api/v1/medplum/sync/patient/${id.trim()}`
        : `/api/v1/medplum/sync/encounter/${id.trim()}`;
      const res = await api.post<{ external_id: string }>(path);
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["medplum-status"] });
      queryClient.invalidateQueries({ queryKey: ["medplum-mappings"] });
      setId("");
      toast.success(`Yuborildi: ${res.external_id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={itemAnim} className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Medplum sinhronizatsiya</h1>
          <p className="text-sm text-muted-foreground">Bemor kartalari va qabullar — FHIR orqali tashqi tizimga</p>
        </div>
        {status && (
          status.enabled ? (
            <Badge variant="outline" className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CircleCheck className="size-3.5" /> Ulangan · {status.mapped} yozuv
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 border-muted-foreground/30 text-muted-foreground">
              <CircleAlert className="size-3.5" /> Ulanmagan
            </Badge>
          )
        )}
      </motion.div>

      {!statusLoading && !status?.enabled && (
        <motion.div variants={itemAnim}>
          <Card>
            <CardContent className="py-10 text-center">
              <Activity className="mx-auto size-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">
                Medplum integratsiyasi o&apos;chirilgan — bemor kartalari lokal ishlayveradi.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ulash uchun serverda <code className="rounded bg-muted px-1">MEDPLUM_BASE_URL</code> sozlanishi kerak.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {status?.enabled && (
        <>
          <motion.div variants={itemAnim}>
            <Card>
              <CardContent className="flex flex-wrap items-end gap-3 p-4">
                <div className="grid gap-2">
                  <Label>Turi</Label>
                  <Select value={entity} onValueChange={(v) => setEntity((v as "patient" | "appointment") ?? "patient")}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="patient">Bemor</SelectItem>
                      <SelectItem value="appointment">Qabul</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid min-w-64 flex-1 gap-2">
                  <Label>{entity === "patient" ? "Bemor ID" : "Qabul ID"} (UUID)</Label>
                  <Input value={id} onChange={(e) => setId(e.target.value)}
                    placeholder="masalan: 3fa2b1c4-....-....-....-............" />
                </div>
                <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || !id.trim()}>
                  <RefreshCw className={syncMutation.isPending ? "size-4 animate-spin" : "size-4"} />
                  {syncMutation.isPending ? "Yuborilmoqda..." : "Yuborish"}
                </Button>
              </CardContent>
            </Card>
            <p className="mt-2 text-xs text-muted-foreground">
              ID ni bemor yoki qabul sahifasining manzil satridan (URL) nusxalab oling.
            </p>
          </motion.div>

          <motion.div variants={itemAnim}>
            <Card>
              <CardContent className="p-0">
                {mappingsLoading ? (
                  <div className="space-y-2 p-4">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
                  </div>
                ) : !mappings.length ? (
                  <div className="py-16 text-center">
                    <Link2 className="mx-auto size-10 text-muted-foreground/40" />
                    <p className="mt-3 text-sm text-muted-foreground">Hali sinxronlangan yozuv yo&apos;q</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="p-3 text-left font-medium">Turi</th>
                          <th className="p-3 text-left font-medium">Lokal ID</th>
                          <th className="p-3 text-left font-medium">FHIR ID</th>
                          <th className="p-3 text-left font-medium">Sinxron vaqti</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mappings.map((m) => (
                          <tr key={`${m.entity}-${m.local_id}`} className="border-b last:border-0">
                            <td className="p-3">
                              <Badge variant="outline" className="text-xs capitalize">
                                {m.entity === "patient" ? "Bemor" : "Qabul"}
                              </Badge>
                            </td>
                            <td className="p-3 font-mono text-xs text-muted-foreground">{m.local_id}</td>
                            <td className="p-3">
                              <span className="flex items-center gap-1 font-mono text-xs text-emerald-600 dark:text-emerald-400">
                                <Link2 className="size-3" /> {m.external_id}
                              </span>
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {new Date(m.synced_at).toLocaleString("uz-UZ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
