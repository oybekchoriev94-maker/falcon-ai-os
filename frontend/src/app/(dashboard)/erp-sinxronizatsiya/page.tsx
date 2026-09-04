"use client";

// ============================================================
// ERPNext sinxronizatsiya — ombor tovarlari va tranzaksiyalarni
// tashqi ERPNext'ga jo'natish. ERPNEXT_URL sozlanmasa — o'chiq,
// sahifa buni ochiq aytadi (soxta muvaffaqiyat yo'q).
// ============================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { RefreshCw, Link2, CircleCheck, CircleAlert, Boxes } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ErpStatus {
  enabled: boolean;
  warehouse: string | null;
  items: number;
  synced: number;
}

interface MappingRow {
  id: number; name: string; sku: string | null; category: string | null;
  current_stock: number; erpnext_item_code: string;
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemAnim = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

export default function ErpSyncPage() {
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["erpnext-status"],
    queryFn: async () => {
      const res = await api.get<ErpStatus>("/api/v1/erpnext/status");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  const { data: mappingsData, isLoading: mappingsLoading } = useQuery({
    queryKey: ["erpnext-mappings"],
    enabled: !!status?.enabled,
    queryFn: async () => {
      const res = await api.get<{ mappings: MappingRow[] }>("/api/v1/erpnext/mappings");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });
  const mappings = mappingsData?.mappings ?? [];

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ created: number; updated: number; failed: number }>("/api/v1/erpnext/sync/items");
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["erpnext-status"] });
      queryClient.invalidateQueries({ queryKey: ["erpnext-mappings"] });
      toast.success(`Yaratildi: ${res.created}, yangilandi: ${res.updated}, xato: ${res.failed}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={itemAnim} className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ERPNext sinxronizatsiya</h1>
          <p className="text-sm text-muted-foreground">Ombor tovarlari — tashqi ERPNext bilan bog&apos;lash</p>
        </div>
        {status && (
          status.enabled ? (
            <Badge variant="outline" className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CircleCheck className="size-3.5" /> Ulangan · {status.warehouse || "ombor belgilanmagan"}
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
              <Boxes className="mx-auto size-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">
                ERPNext integratsiyasi o&apos;chirilgan — ombor lokal ishlayveradi.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ulash uchun serverda <code className="rounded bg-muted px-1">ERPNEXT_URL</code> va{" "}
                <code className="rounded bg-muted px-1">ERPNEXT_WAREHOUSE</code> sozlanishi kerak.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {status?.enabled && (
        <>
          <motion.div variants={itemAnim} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Jami tovar</div>
              <div className="mt-1 text-2xl font-bold">{status.items}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Sinxron</div>
              <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{status.synced}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Qolgan</div>
              <div className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
                {Math.max(0, status.items - status.synced)}
              </div>
            </CardContent></Card>
          </motion.div>

          <motion.div variants={itemAnim} className="flex justify-end">
            <Button onClick={() => syncAllMutation.mutate()} disabled={syncAllMutation.isPending}>
              <RefreshCw className={cn("size-4", syncAllMutation.isPending && "animate-spin")} />
              {syncAllMutation.isPending ? "Sinxronlanmoqda..." : "Barcha tovarlarni sinxronlash"}
            </Button>
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
                    <p className="mt-3 text-sm text-muted-foreground">Hali sinxronlangan tovar yo&apos;q</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="p-3 text-left font-medium">Tovar</th>
                          <th className="p-3 text-left font-medium">SKU</th>
                          <th className="p-3 text-right font-medium">Ombordagi soni</th>
                          <th className="p-3 text-left font-medium">ERPNext kodi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mappings.map((m) => (
                          <tr key={m.id} className="border-b last:border-0">
                            <td className="p-3 font-medium">{m.name}</td>
                            <td className="p-3 text-xs text-muted-foreground">{m.sku || "—"}</td>
                            <td className="p-3 text-right tabular-nums">{m.current_stock}</td>
                            <td className="p-3">
                              <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 font-mono text-xs text-emerald-600 dark:text-emerald-400">
                                <Link2 className="size-3" /> {m.erpnext_item_code}
                              </Badge>
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
