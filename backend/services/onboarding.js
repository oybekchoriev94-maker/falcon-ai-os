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

  // Multi-klinika modeli (PR #4): yangi tenant uchun default klinika va
  // bosh filial. Idempotent — takroriy onboarding'da nusxa yaratilmaydi.
  await execute(
    `INSERT INTO clinics (id, tenant_id, name, code, status)
     VALUES (gen_random_uuid(), $1, $2, 'main', 'active')
     ON CONFLICT (tenant_id, code) DO NOTHING`,
    [tenantId, clinicName || 'Klinika']
  );
  await execute(
    `INSERT INTO branches (id, tenant_id, clinic_id, name, code, status)
     SELECT gen_random_uuid(), $1, c.id, 'Bosh filial', 'main', 'active'
     FROM clinics c
     WHERE c.tenant_id = $1 AND c.code = 'main'
       AND NOT EXISTS (
         SELECT 1 FROM branches b WHERE b.tenant_id = $1 AND b.code = 'main'
       )`,
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
