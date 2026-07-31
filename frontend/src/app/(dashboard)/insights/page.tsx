"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useState } from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Users, Package, AlertCircle,
  BarChart3, Building2, DollarSign, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function fmtSum(n: number) { return new Intl.NumberFormat("uz-UZ").format(Math.round(n)) + " so'm"; }

interface RevenueData {
  forecast_next_month: number;
  trend: "up" | "down" | "stable";
  confidence: string;
  drivers?: string[];
  risks?: string[];
  note?: string;
  history?: { month: string; total: number; appointments_count: number; unique_patients: number }[];
}
interface StaffData {
  doctors: { id: string; name: string; specialization?: string; utilization_pct: number; status: string; booked_hours_per_week: number; capacity_hours_per_week: number }[];
  summary: { overloaded_count: number; underused_count: number; avg_utilization: number };
  recommendations: string[];
}
interface ServicesData {
  total_revenue: number;
  top_services: { name: string; count: number; revenue: number; avg_price: number }[];
  bottom_services: { name: string; count: number; revenue: number }[];
  top5_share_pct: number;
  concentration_risk: string;
}
interface ChurnData {
  total_churn_candidates: number;
  high_value_churn: { patient_id: string; last_visit_days_ago: number; total_visits: number }[];
  churn_rate_pct: number;
  recommendation: string;
}

export default function InsightsPage() {
  const [period, setPeriod] = useState<"30d" | "90d">("30d");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
            <BarChart3 className="size-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Biznes tahlili — CEO paneli</h1>
            <p className="text-xs text-muted-foreground">
              AI tavsiyalar — yakuniy qaror sizniki. Barcha hisobotlar 1 soat keshda.
            </p>
          </div>
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {(["30d", "90d"] as const).map((p) => (
            <button key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium",
                period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              )}>
              {p === "30d" ? "30 kun" : "90 kun"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RevenueCard />
        <StaffCard period={period} />
        <ServicesCard period={period} />
        <ChurnCard />
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">
        <AlertCircle className="size-3.5 inline text-amber-600 mr-1" />
        <strong>Xavfsizlik:</strong> ushbu sahifa faqat CEO/admin uchun. Har chaqiruv audit qilinadi
        (kim, qachon, qanday hisobot). AI tafsili LLM'ga faqat aggregated sonlar yuboradi — bemor
        F.I.O va telefon LLM'ga o'tmaydi.
      </div>
    </div>
  );
}

function RevenueCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["insights-revenue"],
    queryFn: async () => {
      const res = await api.get<RevenueData & { success: boolean; empty?: boolean; message?: string }>("/api/insights/revenue?period=12m");
      return res;
    },
    staleTime: 5 * 60_000,
  });

  const TrendIcon = data?.trend === "up" ? ArrowUpRight : data?.trend === "down" ? ArrowDownRight : Minus;
  const trendColor = data?.trend === "up" ? "text-emerald-600" : data?.trend === "down" ? "text-rose-600" : "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <DollarSign className="size-4 text-emerald-500" />
          Daromad bashorati (kelasi oy)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : data?.empty ? (
          <p className="text-sm text-muted-foreground">{data.message || "Ma'lumot yo'q"}</p>
        ) : data && (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{fmtSum(data.forecast_next_month || 0)}</span>
              <TrendIcon className={cn("size-5", trendColor)} />
              <Badge variant="outline" className="text-[10px]">{data.confidence}</Badge>
            </div>
            {data.note && <p className="text-xs text-muted-foreground mt-2">{data.note}</p>}
            {data.drivers && data.drivers.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium mb-1">Drayvlar:</p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {data.drivers.map((d, i) => <li key={i}>+ {d}</li>)}
                </ul>
              </div>
            )}
            {data.risks && data.risks.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium mb-1 text-rose-600">Risklar:</p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {data.risks.map((r, i) => <li key={i}>! {r}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StaffCard({ period }: { period: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["insights-staff", period],
    queryFn: async () => api.get<StaffData & { success: boolean }>(`/api/insights/staff?period=${period}`),
    staleTime: 5 * 60_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="size-4 text-blue-500" />
          Shifokorlar yuklanganligi
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : data && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="text-center rounded p-2 bg-rose-500/5">
                <p className="text-xs text-muted-foreground">Yuklangan</p>
                <p className="text-lg font-bold text-rose-600">{data.summary?.overloaded_count || 0}</p>
              </div>
              <div className="text-center rounded p-2 bg-emerald-500/5">
                <p className="text-xs text-muted-foreground">O'rtacha</p>
                <p className="text-lg font-bold text-emerald-600">{data.summary?.avg_utilization || 0}%</p>
              </div>
              <div className="text-center rounded p-2 bg-amber-500/5">
                <p className="text-xs text-muted-foreground">Bo'sh</p>
                <p className="text-lg font-bold text-amber-600">{data.summary?.underused_count || 0}</p>
              </div>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(data.doctors || []).slice(0, 8).map((d) => (
                <div key={d.id} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1">{d.name || "—"}</span>
                  <span className={cn(
                    "font-semibold px-2 py-0.5 rounded text-[10px]",
                    d.status === "overloaded" ? "text-rose-600 bg-rose-500/10" :
                    d.status === "high" ? "text-amber-600 bg-amber-500/10" :
                    d.status === "underused" ? "text-muted-foreground bg-muted" : "text-emerald-600 bg-emerald-500/10"
                  )}>{d.utilization_pct}%</span>
                </div>
              ))}
            </div>
            {data.recommendations && data.recommendations.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/50 space-y-1">
                {data.recommendations.map((r, i) => (
                  <p key={i} className="text-xs text-muted-foreground">💡 {r}</p>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ServicesCard({ period }: { period: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["insights-services", period],
    queryFn: async () => api.get<ServicesData & { success: boolean }>(`/api/insights/services?period=${period}`),
    staleTime: 5 * 60_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Package className="size-4 text-violet-500" />
          Xizmatlar rentabelligi
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : data && (
          <>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-xl font-bold">{fmtSum(data.total_revenue || 0)}</span>
              <span className="text-xs text-muted-foreground">jami</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Top-5 xizmat = <strong>{data.top5_share_pct}%</strong> daromad · {data.concentration_risk}
            </p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {(data.top_services || []).map((s) => (
                <div key={s.name} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1">{s.name}</span>
                  <span className="text-muted-foreground shrink-0 ml-2">
                    {s.count}× · {fmtSum(s.revenue)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ChurnCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["insights-churn"],
    queryFn: async () => api.get<ChurnData & { success: boolean }>("/api/insights/churn?period=90"),
    staleTime: 5 * 60_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingDown className="size-4 text-rose-500" />
          Qaytmagan bemorlar (90 kun)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : data && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="text-center rounded p-2 bg-muted/40">
                <p className="text-xs text-muted-foreground">Kutuvchi</p>
                <p className="text-lg font-bold">{data.total_churn_candidates}</p>
              </div>
              <div className="text-center rounded p-2 bg-rose-500/5">
                <p className="text-xs text-muted-foreground">Churn %</p>
                <p className="text-lg font-bold text-rose-600">{data.churn_rate_pct}%</p>
              </div>
            </div>
            {data.recommendation && (
              <p className="text-xs text-muted-foreground mb-3">💡 {data.recommendation}</p>
            )}
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {(data.high_value_churn || []).slice(0, 6).map((p) => (
                <Link key={p.patient_id} href={`/patients/${p.patient_id}`} target="_blank"
                      className="flex items-center justify-between text-xs hover:bg-accent rounded px-2 py-1">
                  <span className="font-mono truncate">{p.patient_id.slice(0, 8)}...</span>
                  <span className="text-muted-foreground shrink-0">
                    {p.total_visits} tashrif · {p.last_visit_days_ago} kun oldin
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
