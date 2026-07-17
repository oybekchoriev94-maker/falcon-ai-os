import { v4 as uuidv4 } from 'uuid';

export function auditLog(poolOrGetter) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (req.method !== 'GET' && res.statusCode >= 200 && res.statusCode < 300) {
        const entry = {
          tenant_id: req.tenant_id || 'default',
          user_id: req.user?.id || req.user?.staff_id || 'anonymous',
          user_name: req.user?.name || req.user?.username || 'unknown',
          action: `${req.method} ${req.path}`,
          resource: req.originalUrl,
          details: JSON.stringify({
            body: sanitizeBody(req.body),
            status: res.statusCode,
          }),
          ip_address: req.ip || req.headers['x-forwarded-for'],
        };
        try {
          const pool = typeof poolOrGetter === 'function' ? poolOrGetter() : poolOrGetter;
          if (pool) {
            pool.query(
              `INSERT INTO audit_logs (tenant_id, user_id, user_name, action, resource, details, ip_address, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
              [entry.tenant_id, entry.user_id, entry.user_name, entry.action, entry.resource, entry.details, entry.ip_address]
            ).catch(() => {});
          }
        } catch (_) {}
      }
      return originalJson(body);
    };
    next();
  };
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const sanitized = { ...body };
  delete sanitized.password;
  delete sanitized.password_hash;
  delete sanitized.face_descriptor;
  delete sanitized.token;
  return sanitized;
}
