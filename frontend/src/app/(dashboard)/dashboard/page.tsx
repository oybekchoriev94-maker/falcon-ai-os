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
} from "recharts";

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
  { label: "Bugungi bemorlar", key: "todayPatients", icon: Users, color: "from-blue-500/20 to-blue-500/5" },
  { label: "Navbatdagi", key: "pendingAppointments", icon: ClipboardList, color: "from-amber-500/20 to-amber-500/5" },
  { label: "Bugungi tushum", key: "todayRevenue", icon: DollarSign, color: "from-emerald-500/20 to-emerald-500/5", prefix: "$" },
  { label: "Band palatalar", key: "occupiedBeds", icon: Building2, color: "from-purple-500/20 to-purple-500/5", suffix: "%" },
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Klinika faoliyati haqida umumiy ma'lumot</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4" />
          {new Date().toLocaleDateString("uz-UZ", { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>

      <motion.div variants={item} className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {statsConfig.map((s) => (
          <Card key={s.key} className="relative overflow-hidden border-border/50">
            <div className={`absolute inset-0 bg-gradient-to-br ${s.color}`} />
            <CardContent className="relative p-4 md:p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {s.label}
                </span>
                <s.icon className="size-4 text-muted-foreground/60" />
              </div>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold tracking-tight">
                  {s.prefix || ""}
                  {statValues[s.key as keyof typeof statValues]}
                  {s.suffix || ""}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div variants={item}>
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="size-4 text-primary" />
                <CardTitle className="text-sm font-medium">Haftalik tashriflar</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-md)",
                        fontSize: 13,
                      }}
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
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-emerald-500" />
                <CardTitle className="text-sm font-medium">Oylik tushum</CardTitle>
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
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-md)",
                        fontSize: 13,
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
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Qisqacha tahlil</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Jami bemorlar</span>
                <p className="text-lg font-semibold">{statValues.totalPatients}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Faol shifokorlar</span>
                <p className="text-lg font-semibold">{statValues.activeDoctors}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Jami o'rinlar</span>
                <p className="text-lg font-semibold">{statValues.totalBeds}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Bandlik</span>
                <p className="text-lg font-semibold">
                  {statValues.totalBeds > 0
                    ? Math.round((statValues.occupiedBeds / statValues.totalBeds) * 100)
                    : 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
