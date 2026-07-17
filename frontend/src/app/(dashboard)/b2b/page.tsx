"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Share2,
  Users,
  Building2,
  DollarSign,
  TrendingUp,
  Plus,
  Download,
  RefreshCw,
  Copy,
  Link2,
  CalendarDays,
  FileText,
  UserPlus,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface B2BPartner {
  id: number;
  company_name: string;
  contact: string;
  referral_count: number;
  commission: number;
  status: "active" | "inactive";
}

interface B2BReferral {
  id: number;
  patient_name: string;
  referred_by: string;
  status: "pending" | "converted" | "lost";
  date: string;
  commission_earned: number;
}

interface B2BStats {
  totalReferrals: number;
  activePartners: number;
  monthlyRevenue: number;
  conversionRate: number;
}

const partnerSchema = z.object({
  company_name: z.string().min(1, "Kompaniya nomi majburiy"),
  contact: z.string().min(1, "Kontakt ma'lumoti majburiy"),
  commission: z.coerce
    .number()
    .min(0, "0 dan kam bo'lmasligi kerak")
    .max(100, "100 dan oshmasligi kerak"),
  status: z.enum(["active", "inactive"]),
});

type PartnerFormData = z.infer<typeof partnerSchema>;

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

const referralStatusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Kutilmoqda", variant: "outline" },
  converted: { label: "Konvertatsiya", variant: "default" },
  lost: { label: "Yo'qotilgan", variant: "destructive" },
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("uz-UZ", {
    style: "currency",
    currency: "UZS",
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("uz-UZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function B2BPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("partners");
  const [dialogOpen, setDialogOpen] = useState(false);

  const statsQuery = useQuery({
    queryKey: ["b2b-stats"],
    queryFn: async () => {
      const res = await api.get<any>("/api/b2b/stats");
      if (!res.success) throw new Error(res.error);
      return res as B2BStats;
    },
    refetchInterval: 30_000,
  });

  const partnersQuery = useQuery({
    queryKey: ["b2b-partners"],
    queryFn: async () => {
      const res = await api.get<any>("/api/b2b/partners");
      if (!res.success) throw new Error(res.error);
      return (res as any).partners as B2BPartner[];
    },
  });

  const referralsQuery = useQuery({
    queryKey: ["b2b-referrals"],
    queryFn: async () => {
      const res = await api.get<any>("/api/b2b/referrals");
      if (!res.success) throw new Error(res.error);
      return (res as any).referrals as B2BReferral[];
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PartnerFormData>({
    resolver: zodResolver(partnerSchema) as any,
    defaultValues: {
      company_name: "",
      contact: "",
      commission: 0,
      status: "active",
    },
  });

  const addPartnerMutation = useMutation({
    mutationFn: async (data: PartnerFormData) => {
      const res = await api.post("/api/b2b/partners", data);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["b2b-partners"] });
      queryClient.invalidateQueries({ queryKey: ["b2b-stats"] });
      toast.success("Hamkor muvaffaqiyatli qo'shildi");
      setDialogOpen(false);
      reset();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Hamkor qo'shishda xatolik yuz berdi");
    },
  });

  const onSubmit = (data: PartnerFormData) => {
    addPartnerMutation.mutate(data);
  };

  const referralBaseUrl =
    process.env.NEXT_PUBLIC_REFERRAL_URL || "https://klinika.uz/referral";
  const qrValue = `${referralBaseUrl}/${user?.id || "partner"}`;

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(qrValue);
    toast.success("Havola nusxalandi");
  }, [qrValue]);

  const statsConfig = [
    {
      label: "Jami referallar",
      key: "totalReferrals" as const,
      icon: Share2,
      color: "from-blue-500/20 to-blue-500/5",
    },
    {
      label: "Faol hamkorlar",
      key: "activePartners" as const,
      icon: Users,
      color: "from-emerald-500/20 to-emerald-500/5",
    },
    {
      label: "Oylik tushum",
      key: "monthlyRevenue" as const,
      icon: DollarSign,
      color: "from-violet-500/20 to-violet-500/5",
      format: (v: number) => formatCurrency(v),
    },
    {
      label: "Konversiya",
      key: "conversionRate" as const,
      icon: TrendingUp,
      color: "from-amber-500/20 to-amber-500/5",
      format: (v: number) => `${v}%`,
    },
  ];

  const stats = statsQuery.data || {
    totalReferrals: 0,
    activePartners: 0,
    monthlyRevenue: 0,
    conversionRate: 0,
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      <motion.div
        variants={item}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            B2B Referal Tizimi
          </h1>
          <p className="text-sm text-muted-foreground">
            Hamkorlar, referallar va QR kodlar orqali biznesingizni
            rivojlantiring
          </p>
        </div>
      </motion.div>

      <motion.div
        variants={item}
        className="grid gap-4 grid-cols-2 lg:grid-cols-4"
      >
        {statsConfig.map((s) => (
          <Card
            key={s.key}
            className="relative overflow-hidden border-border/50"
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${s.color}`} />
            <CardContent className="relative p-4 md:p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {s.label}
                </span>
                <s.icon className="size-4 text-muted-foreground/60" />
              </div>
              {statsQuery.isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold tracking-tight">
                  {s.format ? s.format(stats[s.key]) : stats[s.key]}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <motion.div variants={item}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="partners">Partnerlar</TabsTrigger>
            <TabsTrigger value="referrals">Referallar</TabsTrigger>
            <TabsTrigger value="qr">QR Kodlar</TabsTrigger>
          </TabsList>

          <TabsContent value="partners">
            <Card className="border-border/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Hamkorlar ro'yxati</CardTitle>
                  <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="size-4" />
                    Hamkor qo'shish
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {partnersQuery.isLoading ? (
                  <div className="space-y-3 p-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : partnersQuery.isError ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <AlertCircle className="size-8 text-destructive" />
                    <p className="text-sm text-muted-foreground">
                      Hamkorlarni yuklashda xatolik
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => partnersQuery.refetch()}
                    >
                      Qayta urinish
                    </Button>
                  </div>
                ) : partnersQuery.data && partnersQuery.data.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kompaniya</TableHead>
                        <TableHead>Kontakt</TableHead>
                        <TableHead>Referallar</TableHead>
                        <TableHead>Komissiya</TableHead>
                        <TableHead>Holat</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {partnersQuery.data.map((partner) => (
                        <TableRow key={partner.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Building2 className="size-4 text-muted-foreground shrink-0" />
                              {partner.company_name}
                            </div>
                          </TableCell>
                          <TableCell>{partner.contact}</TableCell>
                          <TableCell>{partner.referral_count}</TableCell>
                          <TableCell>{partner.commission}%</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                partner.status === "active"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {partner.status === "active"
                                ? "Faol"
                                : "Noaktiv"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <UserPlus className="size-10 text-muted-foreground/40" />
                    <p className="text-sm font-medium">
                      Hali hamkorlar yo'q
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Birinchi hamkorni qo'shish orqali boshlang
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDialogOpen(true)}
                    >
                      <Plus className="size-4" />
                      Hamkor qo'shish
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="referrals">
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle>Referallar ro'yxati</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {referralsQuery.isLoading ? (
                  <div className="space-y-3 p-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : referralsQuery.isError ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <AlertCircle className="size-8 text-destructive" />
                    <p className="text-sm text-muted-foreground">
                      Referallarni yuklashda xatolik
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => referralsQuery.refetch()}
                    >
                      Qayta urinish
                    </Button>
                  </div>
                ) : referralsQuery.data &&
                  referralsQuery.data.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bemor</TableHead>
                        <TableHead>Tavsiya beruvchi</TableHead>
                        <TableHead>Holat</TableHead>
                        <TableHead>Sana</TableHead>
                        <TableHead>Komissiya</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {referralsQuery.data.map((referral) => (
                        <TableRow key={referral.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Users className="size-4 text-muted-foreground shrink-0" />
                              {referral.patient_name}
                            </div>
                          </TableCell>
                          <TableCell>{referral.referred_by}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                referralStatusConfig[referral.status]
                                  ?.variant || "outline"
                              }
                            >
                              {referralStatusConfig[referral.status]
                                ?.label || referral.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <CalendarDays className="size-3.5" />
                              {formatDate(referral.date)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium text-emerald-500">
                              +{formatCurrency(referral.commission_earned)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <FileText className="size-10 text-muted-foreground/40" />
                    <p className="text-sm font-medium">
                      Hali referallar yo'q
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Hamkorlar orqali referallar qabul qilinganda bu yerda
                      ko'rinadi
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="qr">
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle>QR Kodlar</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center gap-6 py-4">
                  <div className="relative flex items-center justify-center size-56 rounded-xl bg-white dark:bg-white p-4 shadow-lg">
                    <div className="absolute inset-4 grid grid-cols-9 gap-0.5">
                      {Array.from({ length: 81 }).map((_, i) => {
                        const row = Math.floor(i / 9);
                        const col = i % 9;
                        const isBlack =
                          (row < 3 && col < 3) ||
                          (row < 3 && col > 5) ||
                          (row > 5 && col < 3) ||
                          (row + col) % 3 === 0 ||
                          (row * col) % 5 === 0 ||
                          row === 4 ||
                          col === 4;
                        return (
                          <div
                            key={i}
                            className={`rounded-[2px] ${
                              isBlack ? "bg-black" : "bg-white"
                            }`}
                          />
                        );
                      })}
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="size-10 rounded-lg bg-white flex items-center justify-center shadow-md">
                        <Share2 className="size-5 text-black" />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 max-w-md w-full bg-muted rounded-lg px-3 py-2">
                    <Link2 className="size-4 text-muted-foreground shrink-0" />
                    <code className="text-xs truncate flex-1">
                      {qrValue}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={handleCopyLink}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      onClick={() => toast.success("QR kod yuklab olindi")}
                    >
                      <Download className="size-4" />
                      Yuklab olish
                    </Button>
                    <Button variant="outline" onClick={handleCopyLink}>
                      <Copy className="size-4" />
                      Havolani nusxalash
                    </Button>
                  </div>

                  <Separator />

                  <div className="text-center">
                    <p className="text-sm font-medium mb-1">
                      Yangi QR kod yaratish
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Mavjud QR kod muddati tugagan yoki yangi hamkor uchun
                    </p>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        toast.success("Yangi QR kod yaratildi")
                      }
                    >
                      <RefreshCw className="size-4" />
                      Yangi QR kod
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Yangi hamkor qo'shish</DialogTitle>
            <DialogDescription>
              B2B hamkor ma'lumotlarini kiriting va tizimga qo'shing
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit as any)}>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="company_name">Kompaniya nomi</Label>
                <Input
                  id="company_name"
                  placeholder="Masalan: MedService Plus"
                  {...register("company_name")}
                />
                {errors.company_name && (
                  <p className="text-xs text-destructive">
                    {errors.company_name.message}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contact">Kontakt</Label>
                <Input
                  id="contact"
                  placeholder="Telefon yoki email"
                  {...register("contact")}
                />
                {errors.contact && (
                  <p className="text-xs text-destructive">
                    {errors.contact.message}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="commission">Komissiya (%)</Label>
                  <Input
                    id="commission"
                    type="number"
                    placeholder="10"
                    min={0}
                    max={100}
                    {...register("commission")}
                  />
                  {errors.commission && (
                    <p className="text-xs text-destructive">
                      {errors.commission.message}
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="status">Holat</Label>
                  <select
                    id="status"
                    className="flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                    {...register("status")}
                  >
                    <option value="active">Faol</option>
                    <option value="inactive">Noaktiv</option>
                  </select>
                </div>
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={addPartnerMutation.isPending}
              >
                Bekor qilish
              </Button>
              <Button
                type="submit"
                disabled={addPartnerMutation.isPending}
              >
                {addPartnerMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Saqlash
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
