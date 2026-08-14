"use client";

// ============================================================
// Kiosk qurilmalari — admin boshqaruvi (Bosqich T)
//
// Har planshet/TV uchun token yaratiladi. Token FAQAT yaratilganda
// bir marta ko'rsatiladi (bazada sha256 hash saqlanadi).
// Yo'qolgan qurilmani bir tugma bilan bloklash mumkin.
// ============================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useState } from "react";
import { toast } from "sonner";
import {
  Monitor, Plus, Copy, Check, Power, Loader2, Tv, ScanLine, AlertTriangle, UserCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Device {
  id: string;
  name: string;
  kind: "entry" | "queue_tv" | "result" | "attendance";
  location: string | null;
  token_prefix: string;
  is_active: boolean;
  last_seen_at: string | null;
  last_seen_ip: string | null;
  created_at: string;
}

const KIND_META = {
  entry:      { label: "Kirish kioski", Icon: Monitor,   hint: "Bemor o'zi qabulga yoziladi" },
  queue_tv:   { label: "Navbat ekrani", Icon: Tv,        hint: "Kutish zali TV" },
  result:     { label: "Natija kioski", Icon: ScanLine,  hint: "Bemor natijasini oladi" },
  // Kiosk emas — klinika kompyuteridagi davomat agenti. Qurilma tokeni
  // tizimi bir xil bo'lgani uchun shu ro'yxatda boshqariladi.
  attendance: { label: "Davomat kamerasi", Icon: UserCheck, hint: "Xodimlar keldi-ketdi" },
} as const;

function fmtSeen(iso: string | null): string {
  if (!iso) return "Hech qachon";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Hozir onlayn";
  if (min < 60) return `${min} daqiqa oldin`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} soat oldin`;
  return new Date(iso).toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function KioskDevicesPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "entry", location: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["kiosk-devices"],
    queryFn: async () => {
      const res = await api.get<{ devices: Device[] }>("/api/kiosk/devices");
      if (!res.success) throw new Error(res.error);
      return res;
    },
    refetchInterval: 60_000,
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ token: string }>("/api/kiosk/devices", {
        name: form.name.trim(),
        kind: form.kind,
        location: form.location.trim() || undefined,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      setNewToken(res.token);
      setAddOpen(false);
      setForm({ name: "", kind: "entry", location: "" });
      qc.invalidateQueries({ queryKey: ["kiosk-devices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<{ is_active: boolean }>(`/api/kiosk/devices/${id}/toggle`, {});
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      toast.success(res.is_active ? "Qurilma yoqildi" : "Qurilma bloklandi");
      qc.invalidateQueries({ queryKey: ["kiosk-devices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const devices = data?.devices ?? [];

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Kiosk qurilmalari</h1>
          <p className="text-sm text-muted-foreground">
            Kirish planshetlari, navbat ekranlari va natija kiosklari
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Yangi qurilma
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : devices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Monitor className="size-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              Hali qurilma qo&apos;shilmagan. Kirish zalidagi planshet uchun token yarating.
            </p>
            <Button className="mt-4" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Birinchi qurilmani qo&apos;shish
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {devices.map((d) => {
            const meta = KIND_META[d.kind] || KIND_META.entry;
            const online = d.last_seen_at
              && Date.now() - new Date(d.last_seen_at).getTime() < 5 * 60_000;
            return (
              <Card key={d.id} className={cn(!d.is_active && "opacity-60")}>
                <CardContent className="p-4 flex items-start gap-4">
                  <div className={cn(
                    "flex size-11 items-center justify-center rounded-xl shrink-0",
                    d.is_active ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-400",
                  )}>
                    <meta.Icon className="size-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">{d.name}</p>
                      <Badge variant="secondary" className="text-[10px]">{meta.label}</Badge>
                      {online && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          onlayn
                        </span>
                      )}
                      {!d.is_active && (
                        <Badge variant="destructive" className="text-[10px]">bloklangan</Badge>
                      )}
                    </div>
                    {d.location && <p className="text-xs text-muted-foreground mt-0.5">{d.location}</p>}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
                      <span className="font-mono">{d.token_prefix}…</span>
                      <span>{fmtSeen(d.last_seen_at)}</span>
                      {d.last_seen_ip && <span className="font-mono">{d.last_seen_ip}</span>}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant={d.is_active ? "outline" : "default"}
                    onClick={() => toggle.mutate(d.id)}
                    disabled={toggle.isPending}
                    className="shrink-0"
                  >
                    <Power className="size-3.5" />
                    {d.is_active ? "Bloklash" : "Yoqish"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Yo'riqnoma */}
      <Card className="border-blue-200 bg-blue-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Planshetni ulash</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-700 space-y-1.5">
          <p>1. Yuqoridan <strong>Yangi qurilma</strong> yarating va tokenni ko&apos;chiring</p>
          <p>2. Planshet brauzerida <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">falconmedai.uz/kiosk</code> oching</p>
          <p>3. Sozlash ekranida tokenni joylang</p>
          <p>4. Brauzerni <strong>kiosk rejimida</strong> ishga tushiring (Chrome: <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">--kiosk</code>)</p>
        </CardContent>
      </Card>

      {/* Yangi qurilma dialogi */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>Yangi kiosk qurilmasi</DialogTitle>
            <DialogDescription>
              Token yaratilgach faqat bir marta ko&apos;rsatiladi — darhol saqlang.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nomi *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Kirish zali planshet"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Turi</Label>
              <Select value={form.kind} onValueChange={(v) => v && setForm((f) => ({ ...f, kind: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>{m.label} — {m.hint}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Joylashuvi</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder="1-qavat, registratura yonida"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Bekor qilish</Button>
            <Button
              onClick={() => create.mutate()}
              disabled={form.name.trim().length < 2 || create.isPending}
            >
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Yaratish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token ko'rsatish (bir martalik) */}
      <Dialog open={!!newToken} onOpenChange={(o) => { if (!o) { setNewToken(null); setCopied(false); } }}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>Qurilma tokeni</DialogTitle>
            <DialogDescription>
              Bu token <strong>qayta ko&apos;rsatilmaydi</strong>. Planshetga hozir kiriting.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900">
                Tokenni faqat klinika qurilmasiga kiriting. U bemor kartalarini
                qidirish huquqini beradi.
              </p>
            </div>
            <code className="block break-all rounded-lg bg-white p-3 font-mono text-sm">
              {newToken}
            </code>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                if (newToken) {
                  navigator.clipboard.writeText(newToken).then(() => {
                    setCopied(true);
                    toast.success("Token nusxalandi");
                  }).catch(() => toast.error("Nusxalab bo'lmadi — qo'lda ko'chiring"));
                }
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Nusxalandi" : "Nusxalash"}
            </Button>
            <Button variant="outline" onClick={() => { setNewToken(null); setCopied(false); }}>
              Saqladim, yopish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
