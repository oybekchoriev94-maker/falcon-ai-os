const tenantCounters = new Map();

const PLAN_LIMITS = {
  free:       { rpm: 30,  rpd: 500,   ai_rpd: 10 },
  basic:      { rpm: 60,  rpd: 2000,  ai_rpd: 100 },
  pro:        { rpm: 120, rpd: 10000, ai_rpd: 500 },
  enterprise: { rpm: 600, rpd: 100000, ai_rpd: 999999 },
};

function getLimits(planCode) {
  return PLAN_LIMITS[planCode] || PLAN_LIMITS.free;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [key, entry] of tenantCounters) {
    if (now > entry.expiresAt) tenantCounters.delete(key);
  }
}
setInterval(cleanupExpired, 60000);

export function tenantRateLimit(type = 'api') {
  return (req, res, next) => {
    const tenantId = req.tenant_id || 'default';
    const planCode = req.subscription?.plan_code || 'free';
    const limits = getLimits(planCode);

    const limit = type === 'ai' ? limits.ai_rpd : limits.rpm;
    const windowMs = type === 'ai' ? 86400000 : 60000;

    const key = `${tenantId}:${type}:${Math.floor(Date.now() / windowMs)}`;
    const now = Date.now();

    let entry = tenantCounters.get(key);
    if (!entry || now > entry.expiresAt) {
      entry = { count: 0, expiresAt: now + windowMs };
      tenantCounters.set(key, entry);
    }

    entry.count++;
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - entry.count));
    res.setHeader('X-RateLimit-Plan', planCode);
    res.setHeader('X-Tenant-Id', tenantId);

    if (entry.count > limit) {
      const planNames = { free: 'Bepul', basic: 'Basic', pro: 'Professional', enterprise: 'Enterprise' };
      const retryAfter = Math.ceil((entry.expiresAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: `So'rovlar limiti tugadi. Sizning tarifingiz: ${planNames[planCode] || planCode}. Limit: ${limit} ta / ${type === 'ai' ? 'kun' : 'daqiqa'}. Tarifni yangilang.`,
        limit, plan: planCode, retry_after: retryAfter, type,
      });
    }

    next();
  };
}

export function getTenantUsage(tenantId) {
  const now = Date.now();
  const minuteKey = `${tenantId}:api:${Math.floor(now / 60000)}`;
  const dayKey = `${tenantId}:ai:${Math.floor(now / 86400000)}`;
  return {
    rpm: tenantCounters.get(minuteKey)?.count || 0,
    ai_rpd: tenantCounters.get(dayKey)?.count || 0,
  };
}
