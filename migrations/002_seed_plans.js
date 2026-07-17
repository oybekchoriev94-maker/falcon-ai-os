export async function up(knex) {
  const plans = [
    {
      id: 'plan_free', name: 'Bepul', code: 'free',
      description: 'Yangi klinikalar uchun boshlang\'ich tarif',
      monthly_price: 0, annual_price: 0,
      max_doctors: 2, max_patients: 100, max_storage_mb: 50,
      ai_requests_limit: 10, face_id_enabled: false,
      b2b_referrals_enabled: false, inpatient_enabled: false,
      reports_enabled: true, api_access_enabled: false,
    },
    {
      id: 'plan_basic', name: 'Basic', code: 'basic',
      description: 'Kichik klinikalar uchun asosiy tarif',
      monthly_price: 29, annual_price: 290,
      max_doctors: 5, max_patients: 500, max_storage_mb: 200,
      ai_requests_limit: 100, face_id_enabled: true,
      b2b_referrals_enabled: true, inpatient_enabled: false,
      reports_enabled: true, api_access_enabled: true,
    },
    {
      id: 'plan_pro', name: 'Professional', code: 'pro',
      description: 'O\'rta klinikalar uchun kengaytirilgan tarif',
      monthly_price: 79, annual_price: 790,
      max_doctors: 20, max_patients: 2000, max_storage_mb: 1000,
      ai_requests_limit: 500, face_id_enabled: true,
      b2b_referrals_enabled: true, inpatient_enabled: true,
      reports_enabled: true, api_access_enabled: true,
    },
    {
      id: 'plan_enterprise', name: 'Enterprise', code: 'enterprise',
      description: 'Katta klinikalar uchun cheksiz tarif',
      monthly_price: 199, annual_price: 1990,
      max_doctors: 999999, max_patients: 999999, max_storage_mb: 10000,
      ai_requests_limit: 999999, face_id_enabled: true,
      b2b_referrals_enabled: true, inpatient_enabled: true,
      reports_enabled: true, api_access_enabled: true,
    },
  ];

  for (const p of plans) {
    await knex('subscription_plans').insert(p).onConflict('id').merge();
  }

  const tenantId = 'default';
  const existing = await knex('tenants').where('id', tenantId).first();
  if (!existing) {
    await knex('tenants').insert({
      id: tenantId, code: 'DEFAULT', name: 'Default Clinic',
      type: 'private', status: 'active', verified: true,
      plan: 'enterprise',
    });
    await knex('subscriptions').insert({
      id: knex.fn.uuid ? knex.fn.uuid() : 'sub_default',
      tenant_id: tenantId, plan_id: 'plan_enterprise',
      billing_cycle: 'monthly', status: 'active',
    });
  }
}

export async function down(knex) {
  await knex('subscriptions').del();
  await knex('subscription_plans').del();
  await knex('tenants').where('id', 'default').del();
}
