"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import { useAuth } from "@/lib/auth-store"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"
import { toast } from "sonner"
import { useState } from "react"
import {
  Shield,
  Building2,
  Users,
  DollarSign,
  Clock,
  Eye,
  Lock,
  Activity,
  ServerCog,
  Database,
  HardDrive,
  Brain,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07 },
  },
}

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
}

interface Tenant {
  id: number
  name: string
  domain: string
  plan: "free" | "basic" | "pro" | "enterprise"
  status: "active" | "suspended" | "trial"
  created_at: string
}

interface AdminUser {
  id: number
  username: string
  role: string
  tenant_name: string
  last_login: string | null
}

interface AdminStats {
  totalTenants: number
  activeUsers: number
  totalRevenue: number
  uptime: number
}

interface DeepHealth {
  overall: "ok" | "degraded" | "down"
  problems: string[]
  database: { ok: boolean; latency_ms: number | null }
  backup: {
    state: "ok" | "stale" | "failed" | "missing"
    ageHours: number | null
    file: string | null
    timestamp: string | null
  }
  engines: Record<string, boolean>
  uptime_sec: number
  timestamp: string
}

const statusConfig: Record<string, { label: string; className: string }> = {
  active: {
    label: "Faol",
    className:
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  suspended: {
    label: "Bloklangan",
    className:
      "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
  },
  trial: {
    label: "Sinov",
    className:
      "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
}

const planLabels: Record<string, string> = {
  free: "Bepul",
  basic: "Asosiy",
  pro: "Professional",
  enterprise: "Korxona",
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleDateString("uz-UZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleDateString("uz-UZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("uz-UZ", {
    style: "currency",
    currency: "UZS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function formatUptime(hours: number): string {
  const days = Math.floor(hours / 24)
  const h = Math.floor(hours % 24)
  const parts: string[] = []
  if (days > 0) parts.push(`${days} kun`)
  if (h > 0) parts.push(`${h} soat`)
  return parts.join(" ") || "0 soat"
}

function TenantSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-24 shrink-0" />
          <Skeleton className="h-8 w-20 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function UsersSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-28 shrink-0" />
          <Skeleton className="h-4 w-20 shrink-0" />
          <Skeleton className="h-8 w-16 shrink-0" />
        </div>
      ))}
    </div>
  )
}

export default function AdminPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState("tenants")

  const { data: tenantsData, isLoading: tenantsLoading } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: async () => {
      const res = await api.get<{ tenants: Tenant[] }>("/api/admin/tenants")
      if (!res.success) throw new Error(res.error)
      return res as unknown as { tenants: Tenant[] }
    },
    enabled: user?.role === "superadmin",
  })

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await api.get<{ users: AdminUser[] }>("/api/admin/users")
      if (!res.success) throw new Error(res.error)
      return res as unknown as { users: AdminUser[] }
    },
    enabled: user?.role === "superadmin",
  })

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const res = await api.get<AdminStats>("/api/admin/stats")
      if (!res.success) throw new Error(res.error)
      return res as unknown as AdminStats
    },
    enabled: user?.role === "superadmin",
  })

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ["admin-health"],
    queryFn: async () => {
      const res = await api.get<DeepHealth>("/api/health/deep")
      if (!res.success) throw new Error(res.error)
      return res as unknown as DeepHealth
    },
    enabled: user?.role === "superadmin",
    refetchInterval: 60_000,
  })

  const toggleStatusMutation = useMutation({
    mutationFn: async (tenantId: number) => {
      const res = await api.post(`/api/admin/tenants/${tenantId}/status`)
      if (!res.success) throw new Error(res.error)
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] })
      toast.success("Tenant holati o'zgartirildi")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const tenants = tenantsData?.tenants ?? []
  const adminUsers = usersData?.users ?? []

  if (!user || user.role !== "superadmin") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex min-h-[60vh] flex-col items-center justify-center text-center"
      >
        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10">
          <Lock className="size-8 text-destructive" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Ruxsat yo'q</h2>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          Ushbu sahifaga faqat super administratorlar kirishi mumkin
        </p>
      </motion.div>
    )
  }

  const statCards = [
    {
      label: "Jami tenantlar",
      value: stats?.totalTenants ?? 0,
      icon: Building2,
      color: "from-blue-500/20 to-blue-500/5",
      iconColor: "text-blue-500",
    },
    {
      label: "Faol foydalanuvchilar",
      value: stats?.activeUsers ?? 0,
      icon: Users,
      color: "from-emerald-500/20 to-emerald-500/5",
      iconColor: "text-emerald-500",
    },
    {
      label: "Jami daromad",
      value: stats?.totalRevenue ?? 0,
      icon: DollarSign,
      color: "from-purple-500/20 to-purple-500/5",
      iconColor: "text-purple-500",
      format: formatCurrency,
    },
    {
      label: "Tizim ishlash vaqti",
      value: stats?.uptime ?? 0,
      icon: Clock,
      color: "from-amber-500/20 to-amber-500/5",
      iconColor: "text-amber-500",
      format: formatUptime,
    },
  ]

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div
        variants={item}
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
            <p className="text-sm text-muted-foreground">
              Tizim boshqaruvi va monitoring
            </p>
          </div>
          <Badge
            variant="outline"
            className="gap-1.5 border-primary/30 bg-primary/5 text-primary"
          >
            <Shield className="size-3" />
            Super Admin
          </Badge>
        </div>
      </motion.div>

      <motion.div variants={item} className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card
            key={s.label}
            className="relative overflow-hidden border-border/50"
          >
            <div className={cn("absolute inset-0 bg-gradient-to-br", s.color)} />
            <CardContent className="relative p-4 md:p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </span>
                <s.icon className={cn("size-4", s.iconColor)} />
              </div>
              {statsLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold tracking-tight">
                  {s.format ? s.format(s.value) : s.value}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <motion.div variants={item}>
        <Tabs
          value={tab}
          onValueChange={(v) => {
            if (v !== null) setTab(v)
          }}
        >
          <TabsList variant="line" className="mb-4">
            <TabsTrigger value="tenants" className="gap-1.5">
              <Building2 className="size-4" />
              Tenantlar
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-1.5">
              <Users className="size-4" />
              Foydalanuvchilar
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-1.5">
              <Activity className="size-4" />
              Statistika
            </TabsTrigger>
            <TabsTrigger value="health" className="gap-1.5">
              <ServerCog className="size-4" />
              Tizim holati
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tenants">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 text-primary" />
                  <CardTitle className="text-sm font-medium">
                    Tenantlar ({tenants.length})
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {tenantsLoading ? (
                  <TenantSkeleton />
                ) : tenants.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Building2 className="mb-3 size-12 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-muted-foreground">
                      Hali tenant yo'q
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      Yangi tenant qo'shish uchun API orqali yarating
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nomi</TableHead>
                          <TableHead>Domen</TableHead>
                          <TableHead>Tarif</TableHead>
                          <TableHead>Holat</TableHead>
                          <TableHead>Yaratilgan</TableHead>
                          <TableHead className="text-right">Amallar</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tenants.map((tenant) => (
                          <TableRow key={tenant.id}>
                            <TableCell className="font-medium">
                              {tenant.name}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {tenant.domain}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs">
                                {planLabels[tenant.plan] || tenant.plan}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "border",
                                  statusConfig[tenant.status]?.className,
                                )}
                              >
                                {statusConfig[tenant.status]?.label ||
                                  tenant.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDate(tenant.created_at)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="icon-sm">
                                  <Eye className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() =>
                                    toggleStatusMutation.mutate(tenant.id)
                                  }
                                  disabled={toggleStatusMutation.isPending}
                                >
                                  {tenant.status === "suspended"
                                    ? "Faollashtirish"
                                    : "Bloklash"}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-primary" />
                  <CardTitle className="text-sm font-medium">
                    Foydalanuvchilar ({adminUsers.length})
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {usersLoading ? (
                  <UsersSkeleton />
                ) : adminUsers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Users className="mb-3 size-12 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-muted-foreground">
                      Hali foydalanuvchi yo'q
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      Tizimda ro'yxatdan o'tgan foydalanuvchilar mavjud emas
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Foydalanuvchi</TableHead>
                          <TableHead>Rol</TableHead>
                          <TableHead>Tenant</TableHead>
                          <TableHead>Oxirgi kirish</TableHead>
                          <TableHead className="text-right">Amallar</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {adminUsers.map((u) => (
                          <TableRow key={u.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                                  {u.username.slice(0, 2).toUpperCase()}
                                </div>
                                <span className="font-medium">
                                  {u.username}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className="text-xs capitalize"
                              >
                                {u.role}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {u.tenant_name}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDateTime(u.last_login)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon-sm">
                                <Eye className="size-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stats">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Activity className="size-4 text-primary" />
                  <CardTitle className="text-sm font-medium">
                    Tizim statistikasi
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <div className="space-y-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-5">
                    {statCards.map((s) => (
                      <div
                        key={s.label}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className={cn(
                              "flex size-8 items-center justify-center rounded-lg",
                              s.color,
                            )}
                          >
                            <s.icon className={cn("size-4", s.iconColor)} />
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {s.label}
                          </span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums">
                          {s.format ? s.format(s.value) : s.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="health">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ServerCog className="size-4 text-primary" />
                    <CardTitle className="text-sm font-medium">
                      Tizim holati (chuqur tekshiruv)
                    </CardTitle>
                  </div>
                  {health && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "gap-1.5",
                        health.overall === "ok" &&
                          "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                        health.overall === "degraded" &&
                          "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                        health.overall === "down" &&
                          "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          health.overall === "ok" && "bg-emerald-500",
                          health.overall === "degraded" && "bg-amber-500",
                          health.overall === "down" && "bg-red-500",
                        )}
                      />
                      {health.overall === "ok"
                        ? "Barchasi ishlayapti"
                        : health.overall === "degraded"
                          ? "Qisman nosoz"
                          : "Ishdan chiqqan"}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {healthLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-14" />
                    ))}
                  </div>
                ) : !health ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-4 text-center text-sm text-red-600 dark:text-red-400">
                    Tizim tekshiruvidan javob olinmadi — server holatini tekshiring
                  </div>
                ) : (
                  <>
                    {health.problems.length > 0 && (
                      <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        {health.problems.map((p) => (
                          <div key={p} className="text-sm text-amber-700 dark:text-amber-400">
                            • {p}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Database className="size-3.5" /> Ma&apos;lumotlar bazasi
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                          <span className={cn(
                            "text-sm font-semibold",
                            health.database.ok
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400",
                          )}>
                            {health.database.ok ? "Ishlayapti" : "Javob bermayapti"}
                          </span>
                          {health.database.latency_ms != null && (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {health.database.latency_ms} ms
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <HardDrive className="size-3.5" /> Zaxira nusxa (backup)
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                          <span className={cn(
                            "text-sm font-semibold",
                            health.backup.state === "ok" && "text-emerald-600 dark:text-emerald-400",
                            health.backup.state === "stale" && "text-amber-600 dark:text-amber-400",
                            (health.backup.state === "failed" || health.backup.state === "missing") &&
                              "text-red-600 dark:text-red-400",
                          )}>
                            {health.backup.state === "ok" && "Yangi"}
                            {health.backup.state === "stale" && "Eskirgan"}
                            {health.backup.state === "failed" && "Xato"}
                            {health.backup.state === "missing" && "Hali yo'q"}
                          </span>
                          {health.backup.ageHours != null && (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {health.backup.ageHours} soat oldin
                            </span>
                          )}
                        </div>
                        {health.backup.file && (
                          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                            {health.backup.file}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <Brain className="size-3.5" /> AI dvigatellari
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {Object.entries(health.engines).map(([name, ok]) => (
                          <div key={name} className="rounded-lg border p-3">
                            <div className="text-xs uppercase text-muted-foreground">{name}</div>
                            <div className={cn(
                              "mt-1 text-sm font-semibold",
                              ok
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground",
                            )}>
                              {ok ? "Tayyor" : "O'chiq"}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Dvigatel o&apos;chiq bo&apos;lsa ham tizim ishlayveradi — AI funksiyalar
                        vaqtinchalik cheklanadi (graceful degradation).
                      </p>
                    </div>

                    <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                      <span>
                        Uptime: {Math.floor(health.uptime_sec / 86400)} kun{" "}
                        {Math.floor((health.uptime_sec % 86400) / 3600)} soat
                      </span>
                      <span>Har 60 soniyada yangilanadi</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>
    </motion.div>
  )
}
