"use client"

import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { motion } from "framer-motion"
import { toast } from "sonner"
import {
  TrendingUp,
  DollarSign,
  Clock,
  Award,
  CreditCard,
  Smartphone,
  Wallet,
  CalendarDays,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
} from "lucide-react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { useState, useEffect } from "react"

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

interface Payment {
  id: number
  patient_name: string
  amount: number
  method: "payme" | "click" | "cash"
  status: "paid" | "pending" | "failed"
  created_at: string
}

interface RevenueData {
  today: number
  monthly: number
  pending: number
  payments: Payment[]
}

interface SubscriptionInfo {
  loyalty_points?: number
  plan?: string
}

const dayNames = ["Du", "Se", "Chor", "Pay", "Jum", "Shan", "Yak"]

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("uz-UZ", {
    style: "currency",
    currency: "UZS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString("uz-UZ", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  paid: { label: "To'landi", variant: "default" },
  pending: { label: "Kutilmoqda", variant: "secondary" },
  failed: { label: "Bekor qilindi", variant: "destructive" },
}

const methodIcons: Record<string, typeof CreditCard> = {
  payme: Smartphone,
  click: Smartphone,
  cash: Wallet,
}

const methodLabels: Record<string, string> = {
  payme: "Payme",
  click: "Click",
  cash: "Naqd",
}

function buildWeekChartData(payments: Payment[]): { name: string; value: number }[] {
  const days: { name: string; value: number }[] = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().slice(0, 10)
    const dayTotal = payments
      .filter((p) => p.status === "paid" && p.created_at.startsWith(dateStr))
      .reduce((sum, p) => sum + p.amount, 0)
    days.push({ name: dayNames[date.getDay() === 0 ? 6 : date.getDay() - 1] || dayNames[6], value: dayTotal })
  }
  return days
}

function getMethodTotals(payments: Payment[]) {
  const totals: Record<string, number> = { payme: 0, click: 0, cash: 0 }
  payments
    .filter((p) => p.status === "paid")
    .forEach((p) => {
      totals[p.method] = (totals[p.method] || 0) + p.amount
    })
  return totals
}

export default function BillingPage() {
  const [chartData, setChartData] = useState<{ name: string; value: number }[]>([])

  const {
    data: revenue,
    isLoading: revenueLoading,
    error: revenueError,
  } = useQuery({
    queryKey: ["billing-revenue"],
    queryFn: async () => {
      const res = await api.get<RevenueData>("/api/billing/revenue")
      if (res.success) return res as RevenueData & { success: true }
      toast.error("To'lov ma'lumotlarini yuklashda xatolik")
      return null
    },
    refetchInterval: 30_000,
  })

  const { data: subscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      const res = await api.get<SubscriptionInfo>("/api/v1/subscription")
      if (res.success) return res as SubscriptionInfo & { success: true }
      return null
    },
  })

  useEffect(() => {
    if (revenue?.payments) {
      setChartData(buildWeekChartData(revenue.payments))
    }
  }, [revenue?.payments])

  const isLoading = revenueLoading

  const statCards = [
    {
      label: "Bugungi tushum",
      value: revenue?.today ?? 0,
      icon: DollarSign,
      color: "from-emerald-500/20 to-emerald-500/5",
      iconColor: "text-emerald-500",
    },
    {
      label: "Oylik jami",
      value: revenue?.monthly ?? 0,
      icon: TrendingUp,
      color: "from-blue-500/20 to-blue-500/5",
      iconColor: "text-blue-500",
    },
    {
      label: "Kutilayotgan to'lovlar",
      value: revenue?.pending ?? 0,
      icon: Clock,
      color: "from-amber-500/20 to-amber-500/5",
      iconColor: "text-amber-500",
    },
    {
      label: "Loyallik ballari",
      value: subscription?.loyalty_points ?? 0,
      icon: Award,
      color: "from-purple-500/20 to-purple-500/5",
      iconColor: "text-purple-500",
    },
  ]

  const payments = revenue?.payments ?? []
  const methodTotals = getMethodTotals(payments)
  const totalPaid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0)

  const methodCards = [
    { method: "payme" as const, amount: methodTotals.payme, percentage: totalPaid ? Math.round((methodTotals.payme / totalPaid) * 100) : 0 },
    { method: "click" as const, amount: methodTotals.click, percentage: totalPaid ? Math.round((methodTotals.click / totalPaid) * 100) : 0 },
    { method: "cash" as const, amount: methodTotals.cash, percentage: totalPaid ? Math.round((methodTotals.cash / totalPaid) * 100) : 0 },
  ]

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={item} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">To'lovlar va Loyallik</h1>
          <p className="text-sm text-muted-foreground">Klinika to'lov statistikasi va tahlili</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <CalendarDays className="size-4" />
          <span>{new Date().toLocaleDateString("uz-UZ", { weekday: "long", day: "numeric", month: "long" })}</span>
          <span className="text-xs text-muted-foreground/50">|</span>
          <span className="font-medium text-foreground">
            {isLoading ? (
              <Skeleton className="inline-block h-4 w-24 align-middle" />
            ) : (
              <>{formatCurrency(revenue?.monthly ?? 0)}</>
            )}
          </span>
        </div>
      </motion.div>

      <motion.div variants={item} className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.label} className="relative overflow-hidden border-border/50">
            <div className={`absolute inset-0 bg-gradient-to-br ${s.color}`} />
            <CardContent className="relative p-4 md:p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {s.label}
                </span>
                <s.icon className={`size-4 ${s.iconColor}`} />
              </div>
              {isLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <div className="text-2xl font-bold tracking-tight">
                  {formatCurrency(s.value)}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div variants={item} className="lg:col-span-2">
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="size-4 text-primary" />
                <CardTitle className="text-sm font-medium">7 kunlik tushum grafigi</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={{
                          background: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: "var(--radius-md)",
                          fontSize: 13,
                        }}
                        formatter={((value: number) => [formatCurrency(value), "Tushum"]) as any}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="var(--color-primary)"
                        fill="url(#revenueGradient)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="border-border/50 h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CreditCard className="size-4 text-primary" />
                <CardTitle className="text-sm font-medium">To'lov usullari</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-2 w-full" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  ))
                : methodCards.map((m) => {
                    const Icon = methodIcons[m.method]
                    return (
                      <div key={m.method}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <Icon className="size-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{methodLabels[m.method]}</span>
                          </div>
                          <span className="text-sm font-semibold">{formatCurrency(m.amount)}</span>
                        </div>
                        <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${m.percentage}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{m.percentage}% ulush</p>
                      </div>
                    )
                  })}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={item}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Wallet className="size-4 text-primary" />
              <CardTitle className="text-sm font-medium">So'nggi to'lovlar</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            ) : payments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Wallet className="size-10 mb-3 opacity-30" />
                <p className="text-sm">Hali hech qanday to'lov mavjud emas</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Bemor</TableHead>
                    <TableHead>Miqdor</TableHead>
                    <TableHead>Usul</TableHead>
                    <TableHead>Holat</TableHead>
                    <TableHead>Sana</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.slice(0, 10).map((p) => {
                    const MethodIcon = methodIcons[p.method]
                    const statusInfo = statusConfig[p.status]
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          #{p.id}
                        </TableCell>
                        <TableCell className="font-medium">{p.patient_name}</TableCell>
                        <TableCell className="font-semibold">{formatCurrency(p.amount)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm">
                            <MethodIcon className="size-3.5 text-muted-foreground" />
                            {methodLabels[p.method]}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {formatDate(p.created_at)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
