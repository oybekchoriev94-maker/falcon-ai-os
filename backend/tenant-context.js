export function tenantContext(req, res, next) {
  // Oddiy HTTP header/query tenant vakolati emas. Tenant faqat JWT,
  // tasdiqlangan Telegram konteksti yoki internal-secret middleware orqali
  // keyinroq o'rnatiladi.
  req.tenant_id = req.user?.tenant_id || null;
  next();
}

export function enforceTenant(req, res, next) {
  if (!req.tenant_id) {
    return res.status(400).json({ error: 'tenant_id talab qilinadi' });
  }
  next();
}

