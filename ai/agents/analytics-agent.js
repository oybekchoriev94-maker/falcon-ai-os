import { llm } from '../engines/llm.js';

export const name = 'analytics-agent';
export const description = 'Klinika tahlilchisi — moliyaviy KPI, doktor samaradorligi, trend va prognozlarni tahlil qiladi';
export const version = '2.1.0';

const SYSTEM_PROMPT = `Siz "Falcon AI OS" ning Analytics Agent bo'limining bosh tahlilchisisiz.
Sizga klinika ma'lumotlari beriladi, siz esa quyidagilarni tahlil qilasiz:

1. **Umumiy holat** — klinikaning moliyaviy va operatsion holati
2. **Trendlar** — tushum, bemorlar soni, xarajatlar dinamikasi
3. **Anomaliyalar** — kutilmagan o'zgarishlar yoki muammolar
4. **Tavsiyalar** — aniq, bajariladigan takliflar
5. **Prognoz** — keyingi davr uchun bashorat

JSON formatda qaytaring:
{
  "summary": "string",
  "score": 0.0,
  "trends": { "revenue": "up|down|stable", "patients": "up|down|stable" },
  "anomalies": ["string"],
  "recommendations": ["string"],
  "forecast": { "next_month_revenue": 0, "confidence": 0.0 }
}`;

export const inputSchema = {
  type: { type: 'string', required: false, description: 'Tahlil turi: kpi, doctor, finance, inventory, full (default: full)' },
  doctor_id: { type: 'string', required: false, description: 'Doktor ID (doctor turi uchun)' }
};

export async function handler(input, context = {}) {
  const db = context.db;
  let data = {};

  if (db?.isReady()) {
    try {
      const patients = db.qGet('SELECT COUNT(*) as count FROM appointments WHERE date(created_at) = date(\'now\')');
      const revenue = db.qGet("SELECT COALESCE(SUM(JSON_EXTRACT(data_json, '$.estimated_cost')), 0) as total FROM referrals WHERE date(created_at) = date('now') AND status = 'completed'");
      const lowStock = db.q("SELECT COUNT(*) as count FROM inventory_items WHERE current_stock <= min_stock");
      const doctors = db.q("SELECT doctor_name, patients_count, total_revenue, total_procedures, errors_count FROM doctor_analytics ORDER BY total_revenue DESC LIMIT 10");
      const pendingRefs = db.q("SELECT COUNT(*) as count FROM referrals WHERE status = 'pending'");
      const appointments = db.q("SELECT department, COUNT(*) as count FROM appointments WHERE date(created_at) = date('now') GROUP BY department");

      data = {
        today_patients: patients?.count || 0,
        today_revenue: revenue?.total || 0,
        low_stock_items: lowStock[0]?.count || 0,
        doctor_count: doctors.length,
        doctor_leaderboard: doctors,
        pending_referrals: pendingRefs[0]?.count || 0,
        department_distribution: appointments,
        analysis_time: new Date().toISOString()
      };
    } catch (e) {
      data = { error: `DB query failed: ${e.message}`, analysis_time: new Date().toISOString() };
    }
  } else if (input.data) {
    data = input.data;
  } else {
    return { error: 'DB mavjud emas, data parametrini yuboring' };
  }

  let prompt = SYSTEM_PROMPT;
  prompt += `\n\nTahlil turi: ${input.type || 'full'}`;
  if (input.doctor_id) prompt += `\nDoktor ID: ${input.doctor_id}`;
  prompt += `\n\nMa'lumotlar:\n${JSON.stringify(data, null, 2)}`;
  prompt += `\n\nYuqoridagi ma'lumotlarni tahlil qiling va JSON qaytaring.`;

  const result = await llm(prompt, 'Tahlil qil', { temperature: 0.2, maxTokens: 1500 });
  if (result.error) return { error: `AI tahlil xatosi: ${result.error}` };

  return {
    analysis_type: input.type || 'full',
    data_source: db?.isReady() ? 'database' : 'input',
    metrics: data,
    analysis: result
  };
}

export async function doctorLeaderboard(doctors) {
  const prompt = `Siz shifokorlar KPI tahlilchisisiz. Quyidagi doktorlar ma'lumotlarini tahlil qiling:
${JSON.stringify(doctors, null, 2)}

Har bir doktor uchun samaradorlik bahosini (0-100) hisoblang.
Eng yaxshi va eng yomon ko'rsatkichlarni aniqlang.
Faqat JSON qaytaring:
{
  "leaderboard": [{"doctor_name": "...", "efficiency": 85, "strengths": ["..."], "improvements": ["..."]}],
  "top_performer": "...",
  "needs_attention": "...",
  "team_average": 0,
  "recommendations": ["..."]
}`;

  return await llm(prompt, 'Leaderboard tahlil', { temperature: 0.1, maxTokens: 2000 });
}
