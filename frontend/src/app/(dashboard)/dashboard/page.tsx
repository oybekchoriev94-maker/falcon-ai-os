"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import {
  Users,
  ClipboardList,
  DollarSign,
  Building2,
  Activity,
  TrendingUp,
  CalendarDays,
  HeartPulse,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";

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

const statsConfig = [
  {
    label: "Bugungi bemorlar",
    key: "todayPatients",
    icon: Users,
    gradient: "from-violet-500/20 via-violet-500/10 to-transparent",
    accent: "text-violet-500",
    bgAccent: "bg-violet-500/10",
    change: +12,
  },
  {
    label: "Navbatdagi",
    key: "pendingAppointments",
    icon: ClipboardList,
    gradient: "from-amber-500/20 via-amber-500/10 to-transparent",
    accent: "text-amber-500",
    bgAccent: "bg-amber-500/10",
    change: -3,
  },
  {
    label: "Bugungi tushum",
    key: "todayRevenue",
    icon: DollarSign,
    gradient: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    accent: "text-emerald-500",
    bgAccent: "bg-emerald-500/10",
    prefix: "$",
    change: +8,
  },
  {
    label: "Band palatalar",
    key: "occupiedBeds",
    icon: Building2,
    gradient: "from-rose-500/20 via-rose-500/10 to-transparent",
    accent: "text-rose-500",
    bgAccent: "bg-rose-500/10",
    suffix: "%",
    change: -2,
  },
];

const chartData = [
  { name: "Du", value: 24 },
  { name: "Se", value: 18 },
  { name: "Chor", value: 31 },
  { name: "Pay", value: 27 },
  { name: "Jum", value: 35 },
  { name: "Shan", value: 15 },
  { name: "Yak", value: 8 },
];

const revenueData = [
  { name: "Yan", value: 4200 },
  { name: "Fev", value: 5800 },
  { name: "Mar", value: 6300 },
  { name: "Apr", value: 5100 },
  { name: "May", value: 7200 },
  { name: "Iyun", value: 8900 },
];

function StatSkeleton() {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="border-border/50">
          <CardContent className="p-4 md:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="size-4 rounded" />
            </div>
            <Skeleton className="h-8 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const res = await api.get<{
        todayPatients: number;
        pendingAppointments: number;
        todayRevenue: number;
        occupiedBeds: number;
        totalBeds: number;
        totalPatients: number;
        activeDoctors: number;
      }>("/api/v1/subscription/usage");
      if (res.success) return res;
      return {
        todayPatients: 0,
        pendingAppointments: 0,
        todayRevenue: 0,
        occupiedBeds: 0,
        totalBeds: 0,
        totalPatients: 0,
        activeDoctors: 0,
      };
    },
    refetchInterval: 30_000,
  });

  const statValues = stats || {
    todayPatients: 0,
    pendingAppointments: 0,
    todayRevenue: 0,
    occupiedBeds: 0,
    totalBeds: 0,
    totalPatients: 0,
    activeDoctors: 0,
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <HeartPulse className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Klinika faoliyati haqida umumiy ma&apos;lumot</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-1.5 w-fit">
          <CalendarDays className="size-4" />
          {new Date().toLocaleDateString("uz-UZ", { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>

      {isLoading ? (
        <StatSkeleton />
      ) : (
        <motion.div variants={item} className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {statsConfig.map((s) => (
            <Card
              key={s.key}
              className="relative overflow-hidden border-border/50 hover:border-border transition-all duration-300 group"
            >
              <div className={cn("absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-500", s.gradient)} />
              <div className={cn("absolute top-0 right-0 size-24 -translate-y-1/2 translate-x-1/2 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-500", s.bgAccent)} />
              <CardContent className="relative p-4 md:p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {s.label}
                  </span>
                  <div className={cn("size-8 rounded-lg flex items-center justify-center", s.bgAccent)}>
                    <s.icon className={cn("size-4", s.accent)} />
                  </div>
                </div>
                <div className="text-2xl font-bold tracking-tight">
                  {s.prefix || ""}
                  {statValues[s.key as keyof typeof statValues]}
                  {s.suffix || ""}
                </div>
                {s.change !== 0 && (
                  <div className={cn(
                    "flex items-center gap-1 mt-1.5 text-xs font-medium",
                    s.change > 0 ? "text-emerald-500" : "text-destructive"
                  )}>
                    {s.change > 0 ? (
                      <ArrowUpRight className="size-3" />
                    ) : (
                      <ArrowDownRight className="size-3" />
                    )}
                    <span>{Math.abs(s.change)}% o&apos;tgan hafta</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </motion.div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div variants={item}>
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="size-4 text-primary" />
                  <CardTitle className="text-sm font-medium">Haftalik tashriflar</CardTitle>
                </div>
                <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-0.5">
                  {chartData.reduce((a, b) => a + b.value, 0)} ta
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.3} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} stroke="var(--color-muted-foreground)" opacity={0.5} />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-md)",
                        fontSize: 13,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                      }}
                      cursor={{ fill: "var(--color-muted)", opacity: 0.3 }}
                    />
                    <Bar
                      dataKey="value"
                      fill="var(--color-primary)"
                      radius={[6, 6, 0, 0]}
                      opacity={0.8}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="size-4 text-emerald-500" />
                  <CardTitle className="text-sm font-medium">Oylik tushum</CardTitle>
                </div>
                <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-0.5">
                  ${revenueData[revenueData.length - 1]?.value.toLocaleString()} oxirgi
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueData}>
                    <defs>
                      <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.3} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} stroke="var(--color-muted-foreground)" opacity={0.5} />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-md)",
                        fontSize: 13,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                      }}
                      formatter={((value: number) => [`$${value.toLocaleString()}`, "Tushum"]) as any}
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
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={item}>
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Qisqacha tahlil</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { label: "Jami bemorlar", value: statValues.totalPatients, icon: Users, color: "text-violet-500" },
                { label: "Faol shifokorlar", value: statValues.activeDoctors, icon: HeartPulse, color: "text-amber-500" },
                { label: "Jami o'rinlar", value: statValues.totalBeds, icon: Building2, color: "text-emerald-500" },
                {
                  label: "Bandlik",
                  value: statValues.totalBeds > 0
                    ? `${Math.round((statValues.occupiedBeds / statValues.totalBeds) * 100)}%`
                    : "0%",
                  icon: Activity,
                  color: "text-rose-500",
                },
              ].map((stat, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className={cn("size-9 rounded-lg flex items-center justify-center shrink-0", stat.color.replace("text-", "bg-").replace("500", "500/10"))}>
                    <stat.icon className={cn("size-4", stat.color)} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="text-lg font-semibold">{stat.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
