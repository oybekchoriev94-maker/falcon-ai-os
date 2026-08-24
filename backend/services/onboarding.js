import { q } from '../db.js';

export async function afterRegistration(tenantId, userId, clinicName, execute = q) {
  await execute(
    `INSERT INTO clinic_settings (tenant_id, key, value, updated_at) VALUES
     ($1, 'timezone', 'Asia/Tashkent', NOW()),
     ($1, 'language', 'uz', NOW()),
     ($1, 'currency', 'UZS', NOW()),
     ($1, 'patient_referral_percent', '10', NOW()),
     ($1, 'patient_campaign_mode', 'manual', NOW()) ON CONFLICT (tenant_id, key) DO NOTHING`,
    [tenantId]
  );

  const welcomeMessage = `Assalomu alaykum, ${clinicName}!

Falcon AI OS ga xush kelibsiz! 🎉

Sizning ${clinicName} klinikangiz uchun hisob yaratildi.
14 kunlik bepul sinov muddati boshlandi.

Quyidagi imkoniyatlardan foydalanishingiz mumkin:
- Bemorlarni boshqarish
- AI yordamida tashxis
- Bemorlarga referral yuborish
- Yuzni tanish orqali tekshiruv
- Statistika va hisobotlar

Pro tarifga o'tish orqali qo'shimcha imkoniyatlarga ega bo'ling:
- Cheksiz AI so'rovlar
- 120 RPM tezlik
- 10 000 RPD
- Batafsil tahliliy hisobotlar

Savollaringiz bormi? Biz bilan bog'laning.
Email: support@falconai.uz`;

  return { success: true, welcomeMessage };
}

export async function checkOnboardingStatus(tenantId) {
  const settingsCount = await q(
    "SELECT COUNT(*) as count FROM clinic_settings WHERE tenant_id = $1",
    [tenantId]
  );
  const userCount = await q(
    "SELECT COUNT(*) as count FROM users WHERE tenant_id = $1",
    [tenantId]
  );
  const hasCompleted = settingsCount[0].count >= 5;
  return {
    completed: hasCompleted,
    settings_configured: Number(settingsCount[0].count),
    users_invited: Number(userCount[0].count),
    next_steps: hasCompleted ? [] : ['Klinika sozlamalarini sozlash', 'Xodimlarni qo\'shish', 'Shifokorlarni ro\'yxatdan o\'tkazish'],
  };
}
