const TENANT_HEADER = 'x-tenant-id';

export function tenantContext(req, res, next) {
  const tenantId = req.headers[TENANT_HEADER] || req.query.tenant_id || req.user?.tenant_id;
  req.tenant_id = tenantId || null;
  if (tenantId) res.setHeader('x-tenant-id', tenantId);
  next();
}

export function enforceTenant(req, res, next) {
  if (!req.tenant_id || req.tenant_id === 'default') {
    return res.status(400).json({ error: 'tenant_id talab qilinadi' });
  }
  next();
}


