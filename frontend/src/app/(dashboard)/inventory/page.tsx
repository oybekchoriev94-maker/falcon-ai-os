"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { toast } from "sonner";
import CameraEvidenceSection from "@/components/inventory/camera-evidence";
import {
  Package,
  AlertTriangle,
  Tags,
  Plus,
  Search,
  Edit3,
  Trash2,
  PackageOpen,
  FlaskConical,
  Pill,
  Syringe,
  Eye,
  Weight,
  Droplets,
  Box,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface Product {
  id: number;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  expiry_date: string | null;
  cost_price: number | null;
  created_at: string;
}

interface ProductFormData {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  expiry_date: string;
  cost_price: string;
}

const CATEGORIES = [
  "Dori-darmon",
  "Tibbiy asbob",
  "Sarflash materiali",
  "Vitaminlar",
  "Antiseptik",
  "Bint va paxta",
  "Laboratoriya",
  "Boshqa",
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

const UNITS = [
  "dona",
  "kg",
  "gramm",
  "litr",
  "ml",
  "paket",
  "shisha",
  "ampula",
  "quti",
  "metr",
] as const;

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemAnim = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

function getStatus(quantity: number, expiryDate: string | null) {
  if (expiryDate && new Date(expiryDate) <= new Date()) return "expired";
  if (quantity < 5) return "low";
  return "normal";
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("uz-UZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const emptyForm: ProductFormData = {
  name: "",
  category: "",
  quantity: 0,
  unit: "dona",
  expiry_date: "",
  cost_price: "",
};

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormData>(emptyForm);

  const { data, isLoading } = useQuery({
    queryKey: ["inventory-products"],
    queryFn: async () => {
      const res = await api.get<{ products: Product[] }>("/api/inventory/products");
      if (!res.success) throw new Error(res.error);
      return res as unknown as { products: Product[] };
    },
  });

  const products = data?.products ?? [];
  const totalItems = products.reduce((s, p) => s + p.quantity, 0);
  const lowStockCount = products.filter((p) => getStatus(p.quantity, p.expiry_date) === "low" || getStatus(p.quantity, p.expiry_date) === "expired").length;
  const categoryCount = new Set(products.map((p) => p.category)).size;

  const filtered = products.filter((p) => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === "all" || p.category === categoryFilter;
    return matchSearch && matchCat;
  });

  function resetForm() {
    setForm(emptyForm);
  }

  function openEdit(product: Product) {
    setSelected(product);
    setForm({
      name: product.name,
      category: product.category,
      quantity: product.quantity,
      unit: product.unit,
      expiry_date: product.expiry_date ?? "",
      cost_price: product.cost_price?.toString() ?? "",
    });
    setEditOpen(true);
  }

  function openDelete(product: Product) {
    setSelected(product);
    setDeleteOpen(true);
  }

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post("/api/inventory/products", {
        ...form,
        cost_price: form.cost_price ? Number(form.cost_price) : null,
        expiry_date: form.expiry_date || null,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-products"] });
      setAddOpen(false);
      resetForm();
      toast.success("Mahsulot qo'shildi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      const res = await api.put(`/api/inventory/products/${selected!.id}`, {
        ...form,
        cost_price: form.cost_price ? Number(form.cost_price) : null,
        expiry_date: form.expiry_date || null,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-products"] });
      setEditOpen(false);
      setSelected(null);
      resetForm();
      toast.success("Mahsulot yangilandi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await api.delete(`/api/inventory/products/${selected!.id}`);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-products"] });
      setDeleteOpen(false);
      setSelected(null);
      toast.success("Mahsulot o'chirildi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = [
    {
      label: "Jami mahsulotlar",
      value: totalItems,
      icon: Package,
      color: "from-blue-500/20 to-blue-500/5",
    },
    {
      label: "Kam zaxira ogohlantirishlari",
      value: lowStockCount,
      icon: AlertTriangle,
      color: "from-red-500/20 to-red-500/5",
    },
    {
      label: "Kategoriyalar",
      value: categoryCount,
      icon: Tags,
      color: "from-emerald-500/20 to-emerald-500/5",
    },
  ];

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ombor</h1>
          <p className="text-sm text-muted-foreground">AI Omborchi — Smart Inventory</p>
        </div>
        <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger render={<Button><Plus className="size-4" />Mahsulot Kirim</Button>} />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Yangi mahsulot qo'shish</DialogTitle>
              <DialogDescription>Ombor uchun yangi mahsulot ma'lumotlarini kiriting</DialogDescription>
            </DialogHeader>
            <ProductForm form={form} onChange={setForm} />
            <DialogFooter>
              <Button variant="outline" onClick={() => { setAddOpen(false); resetForm(); }}>Bekor qilish</Button>
              <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                {addMutation.isPending ? "Saqlanmoqda..." : "Saqlash"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <motion.div variants={itemAnim} className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="relative overflow-hidden border-border/50">
            <div className={cn("absolute inset-0 bg-gradient-to-br", s.color)} />
            <CardContent className="relative p-4 md:p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.label}</span>
                <s.icon className="size-4 text-muted-foreground/60" />
              </div>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
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
            placeholder="Mahsulot nomi bo'yicha qidirish..."
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
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </motion.div>

      <motion.div variants={itemAnim}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Mahsulotlar ({filtered.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <PackageOpen className="size-12 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">
                  {search || categoryFilter !== "all" ? "Hech narsa topilmadi" : "Hali mahsulot yo'q"}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {search || categoryFilter !== "all"
                    ? "Qidiruv so'rovini o'zgartirib ko'ring"
                    : "\"Mahsulot Kirim\" tugmasini bosing va birinchi mahsulotni qo'shing"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nomi</TableHead>
                      <TableHead>Kategoriya</TableHead>
                      <TableHead>Miqdor</TableHead>
                      <TableHead>Birlik</TableHead>
                      <TableHead>Yaroqlilik muddati</TableHead>
                      <TableHead>Holati</TableHead>
                      <TableHead className="text-right">Amallar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((product) => {
                      const status = getStatus(product.quantity, product.expiry_date);
                      return (
                        <TableRow
                          key={product.id}
                          className={cn(
                            status === "low" && "bg-red-500/5",
                            status === "expired" && "bg-destructive/10"
                          )}
                        >
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {(() => {
                                const Icon = CATEGORY_ICONS[product.category] || Package;
                                return <Icon className="size-3.5 text-muted-foreground" />;
                              })()}
                              <span className="text-muted-foreground text-xs">{product.category}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "font-semibold tabular-nums",
                                status === "low" && "text-red-500",
                                status === "expired" && "text-destructive"
                              )}
                            >
                              {product.quantity}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">{product.unit}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(product.expiry_date)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={status} />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon-sm" onClick={() => openEdit(product)}>
                                <Edit3 className="size-3.5" />
                              </Button>
                              <AlertDialog
                                open={deleteOpen && selected?.id === product.id}
                                onOpenChange={(v) => { if (!v) setDeleteOpen(false); }}
                              >
                                <AlertDialogTrigger render={
                                  <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => openDelete(product)}>
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                } />
                                <AlertDialogContent size="sm">
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Mahsulotni o'chirish</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      <strong>{selected?.name}</strong> ombordan butunlay o'chiriladi. Bu amalni qaytarib bo'lmaydi.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
                                    <AlertDialogAction
                                      variant="destructive"
                                      disabled={deleteMutation.isPending}
                                      onClick={() => deleteMutation.mutate()}
                                    >
                                      {deleteMutation.isPending ? "O'chirilmoqda..." : "O'chirish"}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
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

      {/* Ombor-kamera korrelyatsiyasi (PR #12) — kamera yo'q = signal */}
      <motion.div variants={itemAnim}>
        <CameraEvidenceSection />
      </motion.div>

      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) { setSelected(null); resetForm(); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mahsulotni tahrirlash</DialogTitle>
            <DialogDescription>Mahsulot ma'lumotlarini yangilang</DialogDescription>
          </DialogHeader>
          <ProductForm form={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); setSelected(null); resetForm(); }}>Bekor qilish</Button>
            <Button onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
              {editMutation.isPending ? "Saqlanmoqda..." : "Yangilash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: "normal" | "low" | "expired" }) {
  const config = {
    normal: { label: "Normal", variant: "default" as const },
    low: { label: "Kam", variant: "destructive" as const },
    expired: { label: "Muddati o'tgan", variant: "destructive" as const },
  };
  const c = config[status];
  return (
    <Badge
      variant={c.variant}
      className={cn(
        status === "expired" && "bg-destructive/20 text-destructive dark:bg-destructive/30",
        status === "low" && "bg-red-500/15 text-red-600 dark:text-red-400"
      )}
    >
      {status === "expired" && <AlertTriangle className="size-3 mr-0.5" />}
      {c.label}
    </Badge>
  );
}

function ProductForm({
  form,
  onChange,
}: {
  form: ProductFormData;
  onChange: (f: ProductFormData) => void;
}) {
  const set = <K extends keyof ProductFormData>(key: K, val: ProductFormData[K]) =>
    onChange({ ...form, [key]: val });

  return (
    <div className="grid gap-4 py-2">
      <div className="grid gap-2">
        <Label htmlFor="name">Mahsulot nomi</Label>
        <Input
          id="name"
          placeholder="Mahsulot nomini kiriting"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="category">Kategoriya</Label>
        <Select value={form.category} onValueChange={(v) => { if (v !== null) set("category", v); }}>
          <SelectTrigger id="category" className="w-full">
            <SelectValue placeholder="Kategoriyani tanlang" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = CATEGORY_ICONS[cat] || Package;
                    return <Icon className="size-3.5" />;
                  })()}
                  {cat}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="quantity">Miqdor</Label>
          <Input
            id="quantity"
            type="number"
            min={0}
            value={form.quantity}
            onChange={(e) => set("quantity", Number(e.target.value))}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="unit">Birlik</Label>
          <Select value={form.unit} onValueChange={(v) => { if (v !== null) set("unit", v); }}>
            <SelectTrigger id="unit" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="expiry_date">Yaroqlilik muddati</Label>
        <Input
          id="expiry_date"
          type="date"
          value={form.expiry_date}
          onChange={(e) => set("expiry_date", e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="cost_price">Kirim narxi (so'm)</Label>
        <Input
          id="cost_price"
          type="number"
          min={0}
          placeholder="0"
          value={form.cost_price}
          onChange={(e) => set("cost_price", e.target.value)}
        />
      </div>
    </div>
  );
}
