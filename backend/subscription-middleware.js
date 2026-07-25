import { qGet } from './db.js';

const FREE_LIMITS = {
  max_doctors: 2, max_patients: 100, ai_requests_limit: 10,
};

export async function checkSubscription(req, res, next) {
  try {
    const tenantId = req.tenant_id || 'default';

    const sub = await qGet(`
      SELECT s.*, sp.code as plan_code, sp.name as plan_name,
        sp.max_doctors, sp.max_patients, sp.ai_requests_limit,
        sp.b2b_referrals_enabled, sp.inpatient_enabled,
        sp.reports_enabled, sp.api_access_enabled
      FROM subscriptions s
      JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.tenant_id = $1 AND s.status = 'active'
    `, [tenantId]);

    if (!sub) {
      req.subscription = {
        plan_code: 'free', plan_name: 'Bepul',
        max_doctors: FREE_LIMITS.max_doctors,
        max_patients: FREE_LIMITS.max_patients,
        ai_requests_limit: FREE_LIMITS.ai_requests_limit,
        b2b_referrals_enabled: false,
        inpatient_enabled: false, reports_enabled: true,
        api_access_enabled: false,
      };
    } else {
      req.subscription = sub;
    }

    const today = new Date().toISOString().slice(0, 10);

    const usage = await qGet(`
      SELECT
        COALESCE(SUM(CASE WHEN metric = 'ai_requests' THEN count ELSE 0 END), 0) as ai_requests_today,
        (SELECT COUNT(*) FROM doctors WHERE tenant_id = $1) as doctor_count,
        (SELECT COUNT(*) FROM patients WHERE tenant_id = $1) as patient_count
      FROM usage_metering WHERE tenant_id = $1 AND date = CURRENT_DATE
    `, [tenantId]);

    req.usage = usage;
    next();
  } catch (e) {
    console.error('[SUBSCRIPTION] Error:', e.message);
    return res.status(503).json({ error: 'Obuna ma\'lumotini olishda xatolik. Keyinroq urinib ko\'ring.' });
  }
}

export function requireFeature(feature) {
  return (req, res, next) => {
    const sub = req.subscription;
    if (!sub) return res.status(403).json({ error: 'Obuna ma\'lumoti topilmadi' });

    const featureMap = {
      b2b: 'b2b_referrals_enabled',
      inpatient: 'inpatient_enabled',
      reports: 'reports_enabled',
      api: 'api_access_enabled',
    };

    const flag = featureMap[feature];
    if (flag && !sub[flag]) {
      return res.status(403).json({
        error: `Bu funksiya sizning tarifingizda mavjud emas. Tarifni yangilang.`,
        required_feature: feature,
        current_plan: sub.plan_code || 'free',
      });
    }
    next();
  };
}

export async function checkAiLimit(req, res, next) {
  const limit = req.subscription?.ai_requests_limit || FREE_LIMITS.ai_requests_limit;
  const used = req.usage?.ai_requests_today || 0;
  if (used >= limit) {
    return res.status(429).json({
      error: `Kunlik AI so'rovlar limiti tugadi (${limit}). Tarifni yangilang.`,
      limit, used,
    });
  }
  next();
}

export function checkDoctorLimit(req, res, next) {
  const limit = req.subscription?.max_doctors || FREE_LIMITS.max_doctors;
  const count = req.usage?.doctor_count || 0;
  if (count >= limit) {
    return res.status(403).json({
      error: `Shifokorlar soni limitiga yetdingiz (${limit}). Tarifni yangilang.`,
      limit, current: count,
    });
  }
  next();
}

export function checkPatientLimit(req, res, next) {
  const limit = req.subscription?.max_patients || FREE_LIMITS.max_patients;
  const count = req.usage?.patient_count || 0;
  if (count >= limit) {
    return res.status(403).json({
      error: `Bemorlar soni limitiga yetdingiz (${limit}). Tarifni yangilang.`,
      limit, current: count,
    });
  }
  next();
}
