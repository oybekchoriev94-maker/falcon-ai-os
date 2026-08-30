// ============================================================
// Falcon AI OS — ERPNext ombor/dorixona sinhronizatsiya API
// (roadmap PR #11)
//
// inventory_items -> Item, inventory_transactions -> Stock Entry.
// ID ko'prigi: erpnext_item_code / erpnext_entry ustunlari
// (042-migration) — jadval ID'lari bigint bo'lgani uchun.
//
// Gate: ERPNEXT_URL bo'sh = 503 ERPNEXT_DISABLED. Ichki ombor
// oqimlari integratsiyadan UMUMAN bog'liq emas (push-only).
// ============================================================
import { Router } from 'express';
import { q, qGet } from '../db.js';
import { authMiddleware } from '../shared.js';
import { requirePermission } from '../rbac.js';
import {
  isErpnextEnabled,
  toErpnextItem,
  toErpnextStockEntry,
  createErpnextDoc,
  updateErpnextDoc,
} from '../services/erpnext-client.js';
import { serverFail } from '../services/safe-error.js';

const ERPNEXT_COMPANY = process.env.ERPNEXT_COMPANY || '';
const ERPNEXT_WAREHOUSE = process.env.ERPNEXT_WAREHOUSE || '';

export default function erpnextRoutes() {
  const router = Router();

  function guardDisabled(res) {
    if (isErpnextEnabled()) return false;
    res.status(503).json({
      success: false,
      code: 'ERPNEXT_DISABLED',
      error: "ERPNEXT_URL sozlanmagan — integratsiya o'chirilgan",
    });
    return true;
  }

  function guardWarehouse(res) {
    if (ERPNEXT_WAREHOUSE) return false;
    res.status(500).json({
      success: false,
      code: 'ERPNEXT_NO_WAREHOUSE',
      error: 'ERPNEXT_WAREHOUSE sozlanmagan (ombor nomi kerak)',
    });
    return true;
  }

  // GET /api/erpnext/status — integratsiya holati
  router.get('/status', authMiddleware, requirePermission('inventory.read'), async (req, res) => {
    try {
      const stat = await qGet(
        `SELECT COUNT(*)::int AS items_total,
                COUNT(erpnext_item_code)::int AS items_synced
           FROM inventory_items WHERE tenant_id = $1`,
        [req.user.tenant_id]
      );
      res.json({
        success: true,
        enabled: isErpnextEnabled(),
        warehouse: ERPNEXT_WAREHOUSE || null,
        items: stat?.items_total || 0,
        synced: stat?.items_synced || 0,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Holatni olib bo\'lmadi', details: e.message });
    }
  });

  // POST /api/erpnext/sync/item/:id — ombor elementini push qilish
  router.post('/sync/item/:id', authMiddleware, requirePermission('inventory.write'), async (req, res) => {
    if (guardDisabled(res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ success: false, error: 'id butun son bo\'lishi shart' });
      return;
    }
    try {
      const item = await qGet(
        'SELECT * FROM inventory_items WHERE tenant_id = $1 AND id = $2',
        [req.user.tenant_id, id]
      );
      if (!item) {
        res.status(404).json({ success: false, error: 'Element topilmadi' });
        return;
      }
      const doc = toErpnextItem(item);
      // item_code o'zgarmas tabiiy kalit — avval yaratilgan bo'lsa UPDATE
      const name = item.erpnext_item_code
        ? await updateErpnextDoc('Item', item.erpnext_item_code, doc)
        : await createErpnextDoc('Item', doc);
      if (!name) {
        res.status(502).json({ success: false, code: 'ERPNEXT_ERROR', error: "ERPNext'ga ulanib bo'lmadi" });
        return;
      }
      await q(
        'UPDATE inventory_items SET erpnext_item_code = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2',
        [req.user.tenant_id, id, name]
      );
      res.json({ success: true, synced: true, erpnext_item_code: name });
    } catch (e) {
      serverFail(res, e, 'Sinhronizatsiya xatosi', 500);
    }
  });

  // POST /api/erpnext/sync/items — barcha elementlarni batch push
  router.post('/sync/items', authMiddleware, requirePermission('inventory.write'), async (req, res) => {
    if (guardDisabled(res)) return;
    try {
      const items = await q(
        'SELECT * FROM inventory_items WHERE tenant_id = $1 ORDER BY name',
        [req.user.tenant_id]
      );
      const result = { created: 0, updated: 0, failed: 0 };
      for (const item of items) {
        const doc = toErpnextItem(item);
        const name = item.erpnext_item_code
          ? await updateErpnextDoc('Item', item.erpnext_item_code, doc)
          : await createErpnextDoc('Item', doc);
        if (!name) { result.failed += 1; continue; }
        if (!item.erpnext_item_code) {
          await q(
            'UPDATE inventory_items SET erpnext_item_code = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2',
            [req.user.tenant_id, item.id, name]
          );
        }
        result[item.erpnext_item_code ? 'updated' : 'created'] += 1;
      }
      res.json({ success: true, total: items.length, ...result });
    } catch (e) {
      serverFail(res, e, 'Sinhronizatsiya xatosi', 500);
    }
  });

  // POST /api/erpnext/sync/transaction/:id — ombor harakatini push qilish.
  // Element avval sinhronlangan bo'lishi SHART (Stock Entry item_code talab qiladi).
  router.post('/sync/transaction/:id', authMiddleware, requirePermission('inventory.write'), async (req, res) => {
    if (guardDisabled(res)) return;
    if (guardWarehouse(res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ success: false, error: 'id butun son bo\'lishi shart' });
      return;
    }
    try {
      const tx = await qGet(
        `SELECT t.*, i.erpnext_item_code
           FROM inventory_transactions t
           JOIN inventory_items i ON i.id = t.item_id AND i.tenant_id = t.tenant_id
          WHERE t.tenant_id = $1 AND t.id = $2`,
        [req.user.tenant_id, id]
      );
      if (!tx) {
        res.status(404).json({ success: false, error: 'Tranzaksiya topilmadi' });
        return;
      }
      if (tx.erpnext_entry) {
        res.json({ success: true, synced: true, already: true, erpnext_entry: tx.erpnext_entry });
        return;
      }
      if (!tx.erpnext_item_code) {
        res.status(400).json({
          success: false,
          code: 'ITEM_NOT_SYNCED',
          error: 'Element avval ERPNext\'ga sinhronlanishi kerak (/sync/item)',
        });
        return;
      }
      const doc = toErpnextStockEntry({
        tx,
        itemCode: tx.erpnext_item_code,
        warehouse: ERPNEXT_WAREHOUSE,
        company: ERPNEXT_COMPANY || undefined,
        postingDate: tx.created_at ? new Date(tx.created_at).toISOString().slice(0, 10) : undefined,
      });
      if (!doc) {
        res.status(422).json({ success: false, error: 'Tranzaksiyani Stock Entry\'ga aylantirib bo\'lmadi' });
        return;
      }
      const name = await createErpnextDoc('Stock Entry', doc);
      if (!name) {
        res.status(502).json({ success: false, code: 'ERPNEXT_ERROR', error: "ERPNext'ga ulanib bo'lmadi" });
        return;
      }
      await q(
        'UPDATE inventory_transactions SET erpnext_entry = $3 WHERE tenant_id = $1 AND id = $2',
        [req.user.tenant_id, id, name]
      );
      res.json({ success: true, synced: true, erpnext_entry: name });
    } catch (e) {
      serverFail(res, e, 'Sinhronizatsiya xatosi', 500);
    }
  });

  // GET /api/erpnext/mappings — sinhronlangan elementlar
  router.get('/mappings', authMiddleware, requirePermission('inventory.read'), async (req, res) => {
    try {
      const rows = await q(
        `SELECT id, name, sku, category, current_stock, erpnext_item_code
           FROM inventory_items
          WHERE tenant_id = $1 AND erpnext_item_code IS NOT NULL
          ORDER BY name LIMIT 200`,
        [req.user.tenant_id]
      );
      res.json({ success: true, total: rows.length, mappings: rows });
    } catch (e) {
      serverFail(res, e, "Ro'yxatni olib bo'lmadi", 500);
    }
  });

  return router;
}
