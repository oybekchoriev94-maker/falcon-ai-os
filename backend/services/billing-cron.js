import { q, qGet, unsafeQuery } from '../db.js';
import { createPayment } from './payment-gateway.js';
import { v4 as uuidv4 } from 'uuid';

export async function processRecurringBilling() {
  const due = await unsafeQuery.q(`
    SELECT s.id as sub_id, s.tenant_id, s.billing_cycle,
      sp.id as plan_id, sp.name as plan_name, sp.code as plan_code,
      CASE WHEN s.billing_cycle = 'annual' THEN sp.annual_price ELSE sp.monthly_price END as amount,
      t.name as tenant_name, t.phone
    FROM subscriptions s
    JOIN subscription_plans sp ON sp.id = s.plan_id
    JOIN tenants t ON t.id = s.tenant_id
    WHERE s.status = 'active'
      AND s.current_period_end < NOW() + INTERVAL '3 days'
      AND s.current_period_end > NOW() - INTERVAL '7 days'
      AND sp.monthly_price > 0
      AND s.trial_ends_at IS NULL
    LIMIT 50
  `);

  const results = [];
  for (const invoice of due) {
    try {
      const existingPending = await qGet(
        `SELECT id, payment_url FROM payment_transactions
         WHERE tenant_id = $1 AND type = 'subscription' AND status = 'pending'
           AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC LIMIT 1`,
        [invoice.tenant_id]
      );
      if (existingPending) {
        results.push({ tenant_id: invoice.tenant_id, plan: invoice.plan_code, amount: invoice.amount, status: 'pending', payment_url: existingPending.payment_url });
        continue;
      }

      const txId = uuidv4();
      const payment = await createPayment({
        amount: invoice.amount,
        description: `Falcon AI OS — ${invoice.plan_name} (${invoice.billing_cycle}) — ${invoice.tenant_name}`,
        orderId: `sub-${invoice.tenant_id}-${Date.now()}`,
      });

      await q(
        `INSERT INTO payment_transactions (id, tenant_id, amount, description, services_json, provider, type, status, payment_url, provider_transaction_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'subscription', 'pending', $7, $8, NOW())`,
        [txId, invoice.tenant_id, invoice.amount,
         `Subscription: ${invoice.plan_name} (${invoice.billing_cycle})`,
         JSON.stringify({ plan_id: invoice.plan_id, billing_cycle: invoice.billing_cycle }),
         payment.provider, payment.paymentUrl || null, payment.transactionId || null]
      );

      results.push({ tenant_id: invoice.tenant_id, plan: invoice.plan_code, amount: invoice.amount, status: 'pending', payment_url: payment.paymentUrl });
    } catch (e) {
      console.error(`[BILLING] Xatolik ${invoice.tenant_id}:`, e.message);
      results.push({ tenant_id: invoice.tenant_id, plan: invoice.plan_code, amount: invoice.amount, status: 'error', error: e.message });
    }
  }

  const overdue = await unsafeQuery.q(`
    SELECT s.id, s.tenant_id, t.name as tenant_name
    FROM subscriptions s
    JOIN tenants t ON t.id = s.tenant_id
    WHERE s.status = 'active'
      AND s.current_period_end < NOW() - INTERVAL '7 days'
      AND s.trial_ends_at IS NULL
  `);

  for (const sub of overdue) {
    await q("UPDATE subscriptions SET status = 'past_due' WHERE id = $1 AND tenant_id = $2", [sub.id, sub.tenant_id]);
    await q("UPDATE tenants SET status = 'suspended' WHERE id = $1", [sub.tenant_id]);
    console.log(`[BILLING] ${sub.tenant_name} — to'lov amalga oshmadi, hisob to'xtatildi`);
  }

  return { processed: results.length, overdue: overdue.length, details: results };
}

export async function getBillingSummary(tenantId) {
  const invoices = await q(
    `SELECT * FROM payment_transactions WHERE tenant_id = $1 AND type = 'subscription' ORDER BY created_at DESC LIMIT 12`,
    [tenantId]
  );
  const sub = await qGet(`
    SELECT s.*, sp.name as plan_name, sp.code as plan_code, sp.monthly_price, sp.annual_price
    FROM subscriptions s
    JOIN subscription_plans sp ON sp.id = s.plan_id
    WHERE s.tenant_id = $1
  `, [tenantId]);
  return { subscription: sub, invoices };
}
