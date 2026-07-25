// ============================================================
// Inventory Manager Agent — ovoz/matn orqali ombor boshqaruvi
// ============================================================

import { z } from 'zod';
import { llmJson } from '../core/tools.js';
import { transcribe } from '../engines/stt.js';

export const name = 'inventory-manager';
export const description = 'Omborchi AI — ovoz va matn orqali inventarizatsiya, qoldiq nazorati va kam zaxira xavflari';
export const version = '3.0.0';
export const category = 'logistics';

export const schema = z.object({
  action: z.enum(['add', 'check', 'list', 'status', 'parse']).optional(),
  text: z.string().max(2000).optional(),
  audio: z.any().optional(),
  language: z.enum(['uz', 'ru']).optional(),
});

const PARSE_PROMPT = `Siz klinika omborchisining yordamchisisiz.
Ovozli buyruq o'zbek yoki rus tilida bo'lishi mumkin.
Matndan mahsulot ma'lumotlarini ajratib, faqat JSON qaytaring:
{
  "name": "string",
  "sku": "string|null",
  "category": "string",
  "quantity": 1,
  "unit": "dona",
  "suggest_min_stock": null,
  "notes": null
}
Qoidalar: SKU aytilmasa null; kategoriya aniqlanmasa "Boshqa"; miqdor aytilmasa 1;
o'lchov birligi: dona, gr, ml, kg, litr, paket, rulon, juft, shisha, tabletka.`;

const sanitize = (s) => String(s || '').replace(/[^\w\s\-.,()\/Ѐ-ӿ]/g, '').trim().slice(0, 255);

export async function handler(input, ctx) {
  const { db, tenantId } = ctx;
  const action = input.action || 'parse';

  // ─── Faqat o'qish amallari ────────────────────────────────
  if (action === 'list') {
    const items = await db.q(
      `SELECT id, name, sku, category, current_stock, unit, min_stock
       FROM inventory_items WHERE tenant_id = $1 ORDER BY name LIMIT 200`,
      [tenantId]
    );
    return { action, total: items.length, items };
  }

  if (action === 'status') {
    const totals = await db.qGet(
      `SELECT COUNT(*)::int AS total_items, COALESCE(SUM(current_stock), 0) AS total_quantity
       FROM inventory_items WHERE tenant_id = $1`,
      [tenantId]
    );
    const lowStock = await db.q(
      `SELECT id, name, current_stock, min_stock, unit FROM inventory_items
       WHERE tenant_id = $1 AND min_stock IS NOT NULL AND current_stock <= min_stock
       ORDER BY (current_stock / NULLIF(min_stock, 0)) ASC LIMIT 50`,
      [tenantId]
    );
    const categories = await db.q(
      `SELECT COALESCE(category, 'Boshqa') AS category, COUNT(*)::int AS count
       FROM inventory_items WHERE tenant_id = $1 GROUP BY 1 ORDER BY 2 DESC`,
      [tenantId]
    );
    return {
      action,
      summary: { ...totals, low_stock_count: lowStock.length },
      low_stock: lowStock,
      categories,
    };
  }

  if (action === 'check') {
    const term = (input.text || '').trim();
    if (term.length < 2) return { error: 'Qidiruv so\'zi juda qisqa', code: 'QUERY_TOO_SHORT' };
    const items = await db.q(
      `SELECT id, name, sku, category, current_stock, unit, min_stock, cost_price
       FROM inventory_items WHERE tenant_id = $1 AND (name ILIKE $2 OR sku ILIKE $2)
       ORDER BY name LIMIT 50`,
      [tenantId, `%${term}%`]
    );
    return { action, query: term, total: items.length, items };
  }

  // ─── Ovoz/matndan ajratish (parse) yoki qo'shish (add) ────
  let text = input.text;
  if (input.audio && !text) {
    const stt = await transcribe(input.audio, 'inventory.webm', { language: input.language });
    if (stt.error) return { error: `Transkripsiya xatosi: ${stt.error}`, code: 'STT_ERROR' };
    text = stt.text;
  }
  if (!text || text.trim().length < 2) {
    return { error: 'Buyruq matni juda qisqa', code: 'INPUT_TOO_SHORT' };
  }

  const parsed = await llmJson(PARSE_PROMPT, text, { temperature: 0.1, maxTokens: 800 });
  if (!parsed || typeof parsed !== 'object' || parsed.error) {
    return { error: `AI tahlil xatosi: ${parsed?.error || 'tuzilgan javob olinmadi'}`, code: 'LLM_ERROR' };
  }

  const safeName = sanitize(parsed.name);
  if (!safeName) return { transcription: text, parsed, action, saved: false, requires_manual: true };

  if (action !== 'add') {
    return { transcription: text, parsed: { ...parsed, name: safeName }, action, saved: false };
  }

  // ─── Omborga qo'shish (ACID, tenant chegarasida) ─────────
  const qty = parseFloat(parsed.quantity);
  if (!qty || qty <= 0) return { error: 'Miqdor noto\'g\'ri', code: 'INVALID_QUANTITY' };

  const saved = await db.transaction(async (tx) => {
    const existing = await tx.qGet(
      'SELECT id, current_stock FROM inventory_items WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)',
      [tenantId, safeName]
    );
    let itemId;
    if (existing) {
      itemId = existing.id;
      await tx.qExec(
        'UPDATE inventory_items SET current_stock = COALESCE(current_stock,0) + $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
        [qty, itemId, tenantId]
      );
    } else {
      const sku = sanitize(parsed.sku) || 'AI-' + Date.now().toString(36).toUpperCase();
      const rows = await tx.q(
        `INSERT INTO inventory_items (tenant_id, name, sku, category, current_stock, unit, min_stock)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [tenantId, safeName, sku, sanitize(parsed.category) || 'Boshqa', qty, sanitize(parsed.unit) || 'dona',
         parsed.suggest_min_stock ? parseFloat(parsed.suggest_min_stock) : null]
      );
      itemId = rows[0].id;
    }

    const after = await tx.qGet('SELECT current_stock FROM inventory_items WHERE id = $1 AND tenant_id = $2', [itemId, tenantId]);
    await tx.qExec(
      `INSERT INTO inventory_transactions (tenant_id, item_id, type, quantity, performed_by, balance_before, balance_after, reason)
       VALUES ($1, $2, 'AI_RECEIPT', $3, $4, $5, $6, $7)`,
      [tenantId, itemId, qty, ctx.user?.username || 'ai-agent',
       existing?.current_stock || 0, after?.current_stock || qty, `AI agent: ${safeName}`]
    );
    return { item_id: itemId, name: safeName, quantity: qty, new_stock: after?.current_stock };
  });

  return { transcription: text, parsed: { ...parsed, name: safeName }, action, saved: true, item: saved };
}
