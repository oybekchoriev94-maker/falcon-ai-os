// ============================================================
// FALCON AI OS — Biznes tahlili agentlari (Bosqich P)
//
// CEO/direktor uchun. Barcha kirish ma'lumotlari AVVAL SQL bilan bemor
// darajasiga qadar TUSHURILADI (aggregate only). LLM'ga bemor F.I.O yoki
// telefon o'tmaydi — faqat sonlar, xizmat nomlari, vaqt.
//
// PRINSIP: AI biznes qarori QILMAYDI. Faqat tavsiya beradi. Yakuniy
// qaror CEO ixtiyorida. Har tavsiya "AI tavsiyasi" belgi bilan
// ko'rsatiladi va business_report_audit'ga yoziladi.
// ============================================================

import { z } from 'zod';
import { llmJson } from '../core/tools.js';

// ============================================================
// 1) REVENUE FORECASTER — 30 kunlik daromad bashorati
//    Kirish: oxirgi N oy oylik daromad
//    Chiqish: {forecast_next_month, trend: 'up|down|stable', drivers[], risks[]}
// ============================================================
export const revenueForecaster = {
  name: 'revenue-forecaster',
  description: 'Oxirgi oylik daromad tarixidan kelasi oy bashorati va risklar.',
  version: '1.0.0',
  category: 'business',
  schema: z.object({
    monthly_revenue: z.array(z.object({
      month: z.string(),          // 'YYYY-MM'
      total: z.number(),          // so'm
      appointments_count: z.number(),
      unique_patients: z.number(),
    })).min(1).max(24),
    top_services_this_month: z.array(z.object({
      name: z.string(),
      revenue: z.number(),
    })).optional(),
  }),

  async handler(input) {
    const months = input.monthly_revenue;
    // Determinisitik trend
    const recent = months.slice(-3).map((m) => m.total);
    const avg = recent.reduce((s, v) => s + v, 0) / (recent.length || 1);
    const last = months[months.length - 1].total;
    const trend = last > avg * 1.1 ? 'up' : (last < avg * 0.9 ? 'down' : 'stable');

    const prompt =
      "Siz biznes tahlilchisi. Klinika oxirgi oylik daromad tarixi berilgan. " +
      "Kelasi oy bashoratini bering va 2-3 ta driver + 2 ta risk sanab bering. " +
      "Faqat JSON qaytaring: " +
      `{"forecast_next_month":number,"trend":"up|down|stable","confidence":"low|medium|high","drivers":["driver 1"],"risks":["risk 1"],"note":"1 gap izoh"}`;

    try {
      const res = await llmJson(prompt, JSON.stringify(input), { timeoutMs: 7000 });
      return {
        forecast_next_month: Number(res?.forecast_next_month) || Math.round(avg),
        trend: res?.trend || trend,
        confidence: res?.confidence || 'medium',
        drivers: Array.isArray(res?.drivers) ? res.drivers.slice(0, 5) : [],
        risks: Array.isArray(res?.risks) ? res.risks.slice(0, 5) : [],
        note: String(res?.note || '').slice(0, 300),
      };
    } catch (_) {
      return {
        forecast_next_month: Math.round(avg),
        trend, confidence: 'low',
        drivers: [], risks: ['LLM tafsili mavjud emas — deterministik o\'rtacha bashorat'],
        note: 'Bashorat oxirgi 3 oy o\'rtachasidan hisoblangan',
      };
    }
  },
};

// ============================================================
// 2) STAFF UTILIZATION — shifokorlar yuki foizi
//    Deterministik SQL asosida hisoblanadi (LLM'siz).
// ============================================================
export const staffUtilization = {
  name: 'staff-utilization',
  description: 'Shifokorlarning yuklanganlik foizi (haftalik ish soatiga nisbatan).',
  version: '1.0.0',
  category: 'business',
  schema: z.object({
    doctors: z.array(z.object({
      id: z.string(),
      name: z.string(),
      specialization: z.string().nullable().optional(),
      capacity_hours_per_week: z.number(),   // sozlangan ish soati
      booked_hours_per_week: z.number(),     // haqiqatda bron qilingan
    })),
  }),

  handler(input) {
    const rows = input.doctors.map((d) => {
      const util = d.capacity_hours_per_week > 0
        ? Math.round((d.booked_hours_per_week / d.capacity_hours_per_week) * 100)
        : 0;
      let status = 'balanced';
      if (util >= 90) status = 'overloaded';
      else if (util >= 70) status = 'high';
      else if (util <= 30) status = 'underused';
      return { ...d, utilization_pct: util, status };
    }).sort((a, b) => b.utilization_pct - a.utilization_pct);

    const overloaded = rows.filter((r) => r.status === 'overloaded').map((r) => r.name);
    const underused = rows.filter((r) => r.status === 'underused').map((r) => r.name);

    return {
      doctors: rows,
      summary: {
        overloaded_count: overloaded.length,
        underused_count: underused.length,
        avg_utilization: Math.round(rows.reduce((s, r) => s + r.utilization_pct, 0) / (rows.length || 1)),
      },
      recommendations: [
        ...(overloaded.length ? [`Yuklangan (${overloaded.slice(0, 3).join(', ')}) — jadval qo\'shing yoki yordamchi tayinlang`] : []),
        ...(underused.length ? [`Bo\'sh (${underused.slice(0, 3).join(', ')}) — reklama yoki qo\'shimcha xizmat`] : []),
      ],
    };
  },
};

// ============================================================
// 3) SERVICE PROFITABILITY — xizmatlar bo'yicha rentabellik
//    Deterministik SQL — xizmat × soni × narx.
// ============================================================
export const serviceProfitability = {
  name: 'service-profitability',
  description: 'Xizmatlar bo\'yicha daromad va o\'sish tendensiyasi.',
  version: '1.0.0',
  category: 'business',
  schema: z.object({
    services: z.array(z.object({
      name: z.string(),
      category: z.string().nullable().optional(),
      count: z.number(),
      revenue: z.number(),
      avg_price: z.number(),
      trend_pct: z.number().nullable().optional(),  // o'tgan oyga nisbatan %
    })),
  }),

  handler(input) {
    const sorted = [...input.services].sort((a, b) => b.revenue - a.revenue);
    const totalRev = sorted.reduce((s, v) => s + v.revenue, 0);
    const top5 = sorted.slice(0, 5);
    const bottom5 = sorted.slice(-5).reverse();
    const top5Share = totalRev > 0 ? Math.round((top5.reduce((s, v) => s + v.revenue, 0) / totalRev) * 100) : 0;

    return {
      total_revenue: totalRev,
      top_services: top5,
      bottom_services: bottom5,
      top5_share_pct: top5Share,
      concentration_risk: top5Share > 70
        ? 'Yuqori — 5 xizmatga daromadning ' + top5Share + '%i to\'plangan'
        : 'Normal',
    };
  },
};

// ============================================================
// 4) CHURN DETECTOR — qaytmagan bemorlarni topib chaqirish
//    Kirish: oxirgi N kunda tashrifi bo'lmagan lekin ilgari 2+ marta
//            kelgan bemorlar ro'yxati (SQL bilan olinadi).
//    Chiqish: chaqirilishi kerak bo'lgan bemorlar + LLM tavsiyasi.
// ============================================================
export const churnDetector = {
  name: 'churn-detector',
  description: 'Oxirgi 90 kunda kelmagan sobiq bemorlarni topadi.',
  version: '1.0.0',
  category: 'business',
  schema: z.object({
    patients: z.array(z.object({
      patient_id: z.string(),
      last_visit_days_ago: z.number(),
      total_visits: z.number(),
      last_diagnosis_category: z.string().nullable().optional(),
    })),
    total_active_patients: z.number(),
  }),

  handler(input) {
    const highValue = input.patients
      .filter((p) => p.total_visits >= 3)
      .sort((a, b) => b.total_visits - a.total_visits);
    const churnRate = input.total_active_patients > 0
      ? Math.round((input.patients.length / input.total_active_patients) * 100)
      : 0;

    return {
      total_churn_candidates: input.patients.length,
      high_value_churn: highValue.slice(0, 20),
      churn_rate_pct: churnRate,
      recommendation: highValue.length
        ? `Yuqori qiymatli ${highValue.length} bemor — kuzatuv qo\'ng\'iroq yoki Telegram xabar yuboring`
        : 'Yuqori qiymatli churn yo\'q — bemorlarga sadoqat qulay',
    };
  },
};

export const BUSINESS_AGENTS = [
  revenueForecaster, staffUtilization, serviceProfitability, churnDetector,
];
