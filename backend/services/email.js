let transporter = null;

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_ADDRESS = process.env.SMTP_FROM || 'noreply@falconai.uz';

export async function initEmail() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('[EMAIL] SMTP sozlanmagan — email yuborish mavjud emas');
    return false;
  }
  try {
    const nodemailer = await import('nodemailer');
    transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.verify();
    console.log('[EMAIL] SMTP connected');
    return true;
  } catch (e) {
    console.warn('[EMAIL] SMTP ulanmadi:', e.message);
    return false;
  }
}

export async function sendEmail({ to, subject, text, html }) {
  if (!transporter) return { success: false, error: 'SMTP sozlanmagan' };
  try {
    await transporter.sendMail({ from: FROM_ADDRESS, to, subject, text, html });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function sendWelcomeEmail(email, clinicName, trialDays) {
  return sendEmail({
    to: email,
    subject: `Falcon AI OS ga xush kelibsiz, ${clinicName}!`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2>Assalomu alaykum, ${clinicName}!</h2>
      <p>Falcon AI OS ga ro'yxatdan o'tganingiz uchun tashakkur.</p>
      <p><strong>${trialDays} kunlik</strong> bepul sinov muddati boshlandi.</p>
      <p>Kirish: <a href="${process.env.PUBLIC_URL || 'http://localhost:3000'}">${process.env.PUBLIC_URL || 'http://localhost:3000'}</a></p>
      <hr><p style="color:#666;font-size:12px">Falcon AI OS — Klinikalar uchun AI ekotizim</p>
    </div>`,
    text: `Assalomu alaykum, ${clinicName}! Falcon AI OS ga xush kelibsiz. ${trialDays} kunlik bepul sinov muddati boshlandi. Kirish: ${process.env.PUBLIC_URL || 'http://localhost:3000'}`,
  });
}

export async function sendInvoiceEmail(email, clinicName, planName, amount, billingCycle) {
  return sendEmail({
    to: email,
    subject: `Falcon AI OS — hisob-faktura (${planName})`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2>${clinicName}, hisob-faktura</h2>
      <p>Tarifingiz: <strong>${planName}</strong> (${billingCycle === 'annual' ? 'yillik' : 'oylik'})</p>
      <p>Summa: <strong>${Number(amount).toLocaleString()} UZS</strong></p>
      <p>To'lov muddati: ${new Date(Date.now() + 3*86400000).toLocaleDateString('uz-UZ')}</p>
      <hr><p style="color:#666;font-size:12px">Falcon AI OS — Klinikalar uchun AI ekotizim</p>
    </div>`,
    text: `${clinicName}, Falcon AI OS hisob-faktura. Tarif: ${planName} — ${Number(amount).toLocaleString()} UZS`,
  });
}

export async function sendPasswordResetEmail(email, resetLink) {
  return sendEmail({
    to: email,
    subject: `Falcon AI OS — parolni tiklash`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2>Parolni tiklash</h2>
      <p>Parolingizni tiklash uchun quyidagi linkni bosing:</p>
      <a href="${resetLink}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:6px">Parolni tiklash</a>
      <p style="color:#666;font-size:12px;margin-top:24px">Agar siz so'ramagan bo'lsangiz, bu xabarni e'tiborsiz qoldiring.</p>
    </div>`,
    text: `Parolni tiklash: ${resetLink}`,
  });
}

export async function sendSuspensionEmail(email, clinicName) {
  return sendEmail({
    to: email,
    subject: `Falcon AI OS — hisobingiz to'xtatildi`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2>${clinicName}, hisobingiz to'xtatildi</h2>
      <p>To'lov amalga oshmaganligi sababli hisobingiz vaqtincha to'xtatildi.</p>
      <p>Iltimos, admin panel orqali to'lovni amalga oshiring.</p>
    </div>`,
    text: `${clinicName}, to'lov amalga oshmaganligi sababli hisobingiz to'xtatildi.`,
  });
}
