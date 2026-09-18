"use client";

// ============================================================
// Ombor — haqiqiy backend bilan ishlaydi (partiya/FEFO/jurnal).
//
// MUHIM TARIX: bu sahifa ilgari mavjud bo'lmagan /api/inventory/products
// endpointini chaqirardi (404) — ya'ni umuman ishlamasdi, holbuki
// backend'da to'liq ombor tizimi bor edi. Endi u haqiqiy oqimga
// ulangan:
//   - Ro'yxat:  GET  /inventory/status   (partiya soni, eng yaqin muddat)
//   - Kirim:    POST /inventory/add      (partiya + jurnal yozuvi bilan)
//   - Chiqim:   POST /inventory/consume  (FEFO — muddati yaqinidan yechadi)
//
// Tovar "tahrirlash/o'chirish" YO'Q — bu jurnalga asoslangan tizim:
// qoldiq faqat kirim/chiqim orqali o'zgaradi, shunda ombor-kamera
// dalili va chiqindi hisoboti ma'noga ega bo'ladi.
// ============================================================

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Package, PackageOpen, AlertTriangle, Tags, Search, Plus, Minus,
  ScanLine, Barcode, Pill, Syringe, Box, FlaskConical, Droplets,
  Weight, Eye, Wallet, Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import CameraEvidenceSection from "@/components/inventory/camera-evidence";
import { ScanButton } from "@/components/inventory/barcode-scanner";

interface Item {
  id: number;
  name: string;
  sku: string;
  category: string | null;
  current_stock: number;
  unit: string;
  cost_price: number | null;
  min_stock: number | null;
  barcode: string | null;
  batch_count: number;
  nearest_batch: {
    id: number; batch_number: string; expiration_date: string | null; quantity: number;
  } | null;
}

const CATEGORIES = [
  "Dori-darmon", "Tibbiy asbob", "Sarflash materiali", "Vitaminlar",
  "Antiseptik", "Bint va paxta", "Laboratoriya", "Boshqa",
] as const;

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "Dori-darmon": Pill,
  "Tibbiy asbob": Syringe,
  "Sarflash materiali": Box,
  "Vitaminlar": FlaskConical,
  "Antiseptik": Droplets,
  "Bint va paxta": Weight,
  "Laboratoriya": Eye,
  "Boshqa": Package,
};

const UNITS = ["dona", "kg", "gramm", "litr", "ml", "paket", "shisha", "ampula", "quti", "metr"] as const;

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const itemAnim = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("uz-UZ", { day: "numeric", month: "short", year: "numeric" });
}

/** Holat: muddati o'tgan > kam qolgan > normal */
function getStatus(item: Item): "normal" | "low" | "expired" {
  const exp = item.nearest_batch?.expiration_date;
  if (exp && new Date(exp) <= new Date()) return "expired";
  if (item.min_stock != null && item.current_stock <= item.min_stock) return "low";
  return "normal";
}

const emptyReceive = {
  name: "", sku: "", category: "", quantity: "", unit: "dona",
  cost_price: "", min_stock: "", batch_number: "", expiration_date: "", barcode: "",
};

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Backend roli cheklovlari (inventory.js): kirim — faqat admin,
  // chiqim — admin/doctor, kod biriktirish — admin/ceo.
  // Bajarib bo'lmaydigan tugmani ko'rsatib, keyin 403 berish o'rniga
  // uni umuman ko'rsatmaymiz.
  const canReceive = user?.role === "admin";
  const canConsume = user?.role === "admin" || user?.role === "doctor";
  const canBind = user?.role === "admin" || user?.role === "ceo";

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [scanInput, setScanInput] = useState("");

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveForm, setReceiveForm] = useState(emptyReceive);

  const [consumeFor, setConsumeFor] = useState<Item | null>(null);
  const [consumeQty, setConsumeQty] = useState("");
  const [consumeReason, setConsumeReason] = useState("");

  const [bindFor, setBindFor] = useState<Item | null>(null);
  const [bindCode, setBindCode] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["inventory-status"],
    queryFn: async () => {
      const res = await api.get<{
        items: Item[]; low_stock: Item[]; total_value: number; low_count: number;
      }>("/api/inventory/status");
      if (!res.success) throw new Error(res.error);
      return res;
    },
  });

  const items = data?.items ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["inventory-status"] });

  const filtered = items.filter((i) => {
    const s = search.toLowerCase();
    const matchSearch = !s
      || i.name.toLowerCase().includes(s)
      || (i.sku || "").toLowerCase().includes(s)
      || (i.barcode || "").includes(s);
    const matchCat = categoryFilter === "all" || i.category === categoryFilter;
    return matchSearch && matchCat;
  });

  // ── Shtrix-kod oqimi ──────────────────────────────────────
  // USB skaner ham, kamera ham shu yerga keladi. Topilsa — chiqim
  // oynasi ochiladi (eng ko'p ishlatiladigan amal); topilmasa —
  // yangi tovar kirimi, kod oldindan to'ldirilgan holda.
  const handleScan = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (code.length < 4) return;
    setScanInput("");

    const res = await api.get<{ item: Item; code?: string }>(
      `/api/inventory/by-barcode/${encodeURIComponent(code)}`
    );

    if (res.success && res.item) {
      if (canConsume) {
        setConsumeFor(res.item);
        setConsumeQty("1");
        setConsumeReason("");
      }
      toast.success(
        `Topildi: ${res.item.name} — qoldiq ${res.item.current_stock} ${res.item.unit}`
      );
    } else if (canReceive) {
      setReceiveForm({ ...emptyReceive, barcode: code, sku: code });
      setReceiveOpen(true);
      toast.info("Bu kod bazada yo'q — yangi tovar sifatida qo'shing");
    } else {
      toast.error("Bu kod bazada topilmadi");
    }
  }, [canConsume, canReceive]);

  const receiveMutation = useMutation({
    mutationFn: async () => {
      const qty = Number(receiveForm.quantity);
      if (!receiveForm.name.trim()) throw new Error("Nomini kiriting");
      if (!receiveForm.sku.trim()) throw new Error("SKU (kod) kiriting");
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Miqdor 0 dan katta bo'lishi kerak");
      const res = await api.post("/api/inventory/add", {
        name: receiveForm.name.trim(),
        sku: receiveForm.sku.trim(),
        category: receiveForm.category || undefined,
        quantity: qty,
        unit: receiveForm.unit || undefined,
        cost_price: receiveForm.cost_price ? Number(receiveForm.cost_price) : undefined,
        min_stock: receiveForm.min_stock ? Number(receiveForm.min_stock) : undefined,
        batch_number: receiveForm.batch_number || undefined,
        expiration_date: receiveForm.expiration_date || undefined,
        barcode: receiveForm.barcode || undefined,
      });
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: () => {
      refresh(); setReceiveOpen(false); setReceiveForm(emptyReceive);
      toast.success("Kirim qilindi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const consumeMutation = useMutation({
    mutationFn: async () => {
      const qty = Number(consumeQty);
      if (!consumeFor) throw new Error("Tovar tanlanmagan");
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Miqdor 0 dan katta bo'lishi kerak");
      const res = await api.post("/api/inventory/consume", {
        item_id: consumeFor.id,
        requested_quantity: qty,
        procedure_name: consumeReason.trim() || undefined,
      });
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: () => {
      refresh(); setConsumeFor(null); setConsumeQty(""); setConsumeReason("");
      toast.success("Chiqim qayd etildi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bindMutation = useMutation({
    mutationFn: async () => {
      if (!bindFor) throw new Error("Tovar tanlanmagan");
      const code = bindCode.trim();
      if (code.length < 4) throw new Error("Kod kamida 4 belgi bo'lishi kerak");
      const res = await api.put(`/api/inventory/items/${bindFor.id}/barcode`, { barcode: code });
      if (!res.success) throw new Error(res.error as string);
      return res;
    },
    onSuccess: () => {
      refresh(); setBindFor(null); setBindCode("");
      toast.success("Shtrix-kod biriktirildi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = [
    { label: "Tovar turlari", value: items.length, icon: Package, color: "from-blue-500/20 to-blue-500/5" },
    { label: "Kam qolgan", value: data?.low_count ?? 0, icon: AlertTriangle, color: "from-red-500/20 to-red-500/5" },
    { label: "Kategoriyalar", value: new Set(items.map((i) => i.category).filter(Boolean)).size, icon: Tags, color: "from-emerald-500/20 to-emerald-500/5" },
    {
      label: "Umumiy qiymat",
      value: (data?.total_value ?? 0).toLocaleString("uz-UZ"),
      icon: Wallet, color: "from-amber-500/20 to-amber-500/5",
    },
  ];

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ombor</h1>
          <p className="text-sm text-muted-foreground">Partiya, yaroqlilik muddati va harakatlar jurnali bilan</p>
        </div>
        {canReceive && (
          <Button onClick={() => { setReceiveForm(emptyReceive); setReceiveOpen(true); }}>
            <Plus className="size-4" /> Kirim qilish
          </Button>
        )}
      </div>

      {!canReceive && !canConsume && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Sizning rolingizda ombor faqat ko&apos;rish uchun ochiq — kirim va chiqim
          amallarini admin bajaradi.
        </p>
      )}

      {/* ── Shtrix-kod paneli ── */}
      <motion.div variants={itemAnim}>
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <ScanLine className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-primary" />
              <Input
                className="pl-8"
                placeholder="Shtrix-kodni skanerlang yoki kiriting, so'ng Enter..."
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleScan(scanInput); }}
              />
            </div>
            <ScanButton onDetected={handleScan} label="Kamera bilan" />
          </CardContent>
        </Card>
        <p className="mt-1.5 px-1 text-xs text-muted-foreground">
          USB skaner to&apos;g&apos;ridan-to&apos;g&apos;ri shu maydonga yozadi. Kamera esa Android Chrome&apos;da ishlaydi.
        </p>
      </motion.div>

      <motion.div variants={itemAnim} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="relative overflow-hidden border-border/50">
            <div className={cn("absolute inset-0 bg-gradient-to-br", s.color)} />
            <CardContent className="relative p-4 md:p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.label}</span>
                <s.icon className="size-4 text-muted-foreground/60" />
              </div>
              {isLoading ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-2xl font-bold tracking-tight">{s.value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <motion.div variants={itemAnim} className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Nom, SKU yoki shtrix-kod bo'yicha qidirish..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={(v) => { if (v !== null) setCategoryFilter(v); }}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Kategoriya" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Barcha kategoriyalar</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </motion.div>

      <motion.div variants={itemAnim}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Tovarlar ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <PackageOpen className="mb-3 size-12 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">
                  {search || categoryFilter !== "all" ? "Hech narsa topilmadi" : "Hali tovar yo'q"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  {search || categoryFilter !== "all"
                    ? "Qidiruvni o'zgartirib ko'ring"
                    : "\"Kirim qilish\" tugmasi orqali birinchi tovarni qo'shing"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nomi</TableHead>
                      <TableHead>Kategoriya</TableHead>
                      <TableHead className="text-right">Qoldiq</TableHead>
                      <TableHead>Shtrix-kod</TableHead>
                      <TableHead>Eng yaqin muddat</TableHead>
                      <TableHead>Holati</TableHead>
                      <TableHead className="text-right">Amallar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((item) => {
                      const status = getStatus(item);
                      const Icon = CATEGORY_ICONS[item.category || ""] || Package;
                      return (
                        <TableRow key={item.id} className={cn(
                          status === "low" && "bg-red-500/5",
                          status === "expired" && "bg-destructive/10",
                        )}>
                          <TableCell>
                            <div className="font-medium">{item.name}</div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="font-mono">{item.sku}</span>
                              {item.batch_count > 0 && (
                                <span className="flex items-center gap-0.5">
                                  <Layers className="size-3" />{item.batch_count}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Icon className="size-3.5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">{item.category || "—"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={cn(
                              "font-semibold tabular-nums",
                              status === "low" && "text-red-500",
                              status === "expired" && "text-destructive",
                            )}>{item.current_stock}</span>
                            <span className="ml-1 text-xs text-muted-foreground">{item.unit}</span>
                          </TableCell>
                          <TableCell>
                            {item.barcode ? (
                              <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                                <Barcode className="size-3.5" />{item.barcode}
                              </span>
                            ) : canBind ? (
                              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                                onClick={() => { setBindFor(item); setBindCode(""); }}>
                                <Barcode className="size-3.5" /> Biriktirish
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(item.nearest_batch?.expiration_date ?? null)}
                          </TableCell>
                          <TableCell><StatusBadge status={status} /></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              {canReceive && (
                                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                                  onClick={() => {
                                    setReceiveForm({
                                      ...emptyReceive,
                                      name: item.name, sku: item.sku,
                                      category: item.category || "", unit: item.unit,
                                      barcode: item.barcode || "",
                                    });
                                    setReceiveOpen(true);
                                  }}>
                                  <Plus className="size-3.5" /> Kirim
                                </Button>
                              )}
                              {canConsume && (
                                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                                  onClick={() => { setConsumeFor(item); setConsumeQty("1"); setConsumeReason(""); }}>
                                  <Minus className="size-3.5" /> Chiqim
                                </Button>
                              )}
                              {!canReceive && !canConsume && (
                                <span className="text-xs text-muted-foreground/50">—</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Ombor-kamera korrelyatsiyasi — kamera yo'q = signal, jazo emas */}
      <motion.div variants={itemAnim}>
        <CameraEvidenceSection />
      </motion.div>

      {/* ── Kirim ── */}
      <Dialog open={receiveOpen} onOpenChange={(v) => { setReceiveOpen(v); if (!v) setReceiveForm(emptyReceive); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kirim qilish</DialogTitle>
            <DialogDescription>
              Mavjud SKU kiritilsa qoldiqqa qo&apos;shiladi, yangi bo&apos;lsa yangi tovar yaratiladi
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
            <div className="grid gap-2">
              <Label>Nomi</Label>
              <Input value={receiveForm.name} onChange={(e) => setReceiveForm({ ...receiveForm, name: e.target.value })}
                placeholder="Masalan: Paratsetamol 500mg" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>SKU (ichki kod)</Label>
                <Input value={receiveForm.sku} onChange={(e) => setReceiveForm({ ...receiveForm, sku: e.target.value })}
                  placeholder="PARA-500" />
              </div>
              <div className="grid gap-2">
                <Label>Shtrix-kod</Label>
                <div className="flex gap-1.5">
                  <Input value={receiveForm.barcode}
                    onChange={(e) => setReceiveForm({ ...receiveForm, barcode: e.target.value })}
                    placeholder="skanerlang" />
                  <ScanButton label="" onDetected={(c) => setReceiveForm((f) => ({ ...f, barcode: c, sku: f.sku || c }))} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Miqdor</Label>
                <Input type="number" min={0} value={receiveForm.quantity}
                  onChange={(e) => setReceiveForm({ ...receiveForm, quantity: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Birlik</Label>
                <Select value={receiveForm.unit} onValueChange={(v) => { if (v !== null) setReceiveForm({ ...receiveForm, unit: v }); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Kategoriya</Label>
              <Select value={receiveForm.category} onValueChange={(v) => { if (v !== null) setReceiveForm({ ...receiveForm, category: v }); }}>
                <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Narxi (dona)</Label>
                <Input type="number" min={0} value={receiveForm.cost_price}
                  onChange={(e) => setReceiveForm({ ...receiveForm, cost_price: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Eng kam qoldiq</Label>
                <Input type="number" min={0} value={receiveForm.min_stock}
                  onChange={(e) => setReceiveForm({ ...receiveForm, min_stock: e.target.value })}
                  placeholder="ogohlantirish uchun" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Partiya raqami</Label>
                <Input value={receiveForm.batch_number}
                  onChange={(e) => setReceiveForm({ ...receiveForm, batch_number: e.target.value })}
                  placeholder="bo'sh = avtomatik" />
              </div>
              <div className="grid gap-2">
                <Label>Yaroqlilik muddati</Label>
                <Input type="date" value={receiveForm.expiration_date}
                  onChange={(e) => setReceiveForm({ ...receiveForm, expiration_date: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveOpen(false)}>Bekor qilish</Button>
            <Button onClick={() => receiveMutation.mutate()} disabled={receiveMutation.isPending}>
              {receiveMutation.isPending ? "Saqlanmoqda..." : "Kirim qilish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Chiqim ── */}
      <Dialog open={!!consumeFor} onOpenChange={(v) => { if (!v) setConsumeFor(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Chiqim</DialogTitle>
            <DialogDescription>
              {consumeFor?.name} — qoldiq: {consumeFor?.current_stock} {consumeFor?.unit}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Miqdor</Label>
              <Input type="number" min={1} value={consumeQty} onChange={(e) => setConsumeQty(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Sabab / muolaja (ixtiyoriy)</Label>
              <Input value={consumeReason} onChange={(e) => setConsumeReason(e.target.value)}
                placeholder="Masalan: Ukol qilish" />
            </div>
            <p className="text-xs text-muted-foreground">
              Muddati eng yaqin partiyadan yechiladi (FEFO)
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsumeFor(null)}>Bekor qilish</Button>
            <Button onClick={() => consumeMutation.mutate()} disabled={consumeMutation.isPending}>
              {consumeMutation.isPending ? "Saqlanmoqda..." : "Chiqim qilish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Shtrix-kod biriktirish ── */}
      <Dialog open={!!bindFor} onOpenChange={(v) => { if (!v) setBindFor(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Shtrix-kod biriktirish</DialogTitle>
            <DialogDescription>{bindFor?.name}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-1.5">
            <Input value={bindCode} onChange={(e) => setBindCode(e.target.value)}
              placeholder="Skanerlang yoki kiriting" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && bindCode.trim().length >= 4) bindMutation.mutate(); }} />
            <ScanButton label="" onDetected={(c) => setBindCode(c)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindFor(null)}>Bekor qilish</Button>
            <Button onClick={() => bindMutation.mutate()} disabled={bindMutation.isPending}>
              {bindMutation.isPending ? "Saqlanmoqda..." : "Biriktirish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: "normal" | "low" | "expired" }) {
  if (status === "expired") return <Badge variant="destructive">Muddati o&apos;tgan</Badge>;
  if (status === "low") return <Badge variant="destructive">Kam</Badge>;
  return <Badge variant="secondary">Normal</Badge>;
}
