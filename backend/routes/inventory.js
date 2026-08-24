// ============================================================
// FALCON AI OS — Inventory Routes
// Material/procedure norms, batches, transactions, voice-add,
// FEFO consumption, waste reports, and internal agent endpoint
// ============================================================

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { safeError } from '../services/safe-error.js';

// ─── Local rate limiters ───────────────────────────────────
const inventoryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Juda ko\'p inventar so\'rovi, 1 daqiqa kuting' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  validate: { trustProxy: false },
});

/**
 * Factory: returns an Express Router with all inventory-related routes.
 *
 * Usage in server.js (mount at /api):
 *   import inventoryRoutes from './backend/routes/inventory.js';
 *   app.use('/api', inventoryRoutes(pool, authMiddleware, checkRole, validate,
 *            schemas, telegramOrJwtAuth, agentBypassOrAuth, upload));
 *
 * This covers these original prefixes:
 *   /api/inventory/*       — status, add, consume, search, voice-add,
 *                            transactions, batches, norms
 *   /api/internal/inventory/consume — agent-bypass consumption
 *   /api/reports/inventory-waste    — CEO/admin waste report
 *   /api/reports/limits             — admin/ceo monthly limits
 */
export default function inventoryRoutes(
  pool,
  authMiddleware,
  checkRole,
  validate,
  schemas,
  telegramOrJwtAuth,
  agentBypassOrAuth,
  upload
) {
  const router = Router();

  // ─── DB helpers ─────────────────────────────────────────
  const q = async (sql, params = []) => { const r = await pool.query(sql, params); return r.rows; };
  const qGet = async (sql, params = []) => { const r = await pool.query(sql, params); return r.rows[0] || null; };
  const getTenantId = (req) => {
    const tenantId = req.user?.tenant_id || req.tenant_id;
    if (!tenantId) throw new Error('Tenant konteksti talab qilinadi');
    return tenantId;
  };
  const routeError = (status, message) => Object.assign(new Error(message), { status });

  // Transaction helper: wraps async work in BEGIN/COMMIT/ROLLBACK
  async function withTransaction(fn) {
    await pool.query('BEGIN');
    try {
      const result = await fn();
      await pool.query('COMMIT');
      return result;
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }

  // ============================================================
  // 1. BASIC INVENTORY
  // ============================================================

  // GET /inventory/status — all items with batch count & low-stock
  router.get('/inventory/status', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const items = await q(
        `SELECT i.*,
                (SELECT COUNT(*)::int FROM inventory_batches b WHERE b.tenant_id = $1 AND b.item_id = i.id) as batch_count
         FROM inventory_items i
         WHERE i.tenant_id = $1
         ORDER BY i.category, i.name`,
        [tenantId]
      );
      const lowStock = items.filter(i => i.min_stock && i.current_stock <= i.min_stock);
      const totalValue = items.reduce((s, i) => s + (i.current_stock || 0) * (i.cost_price || 0), 0);

      const itemsWithBatches = [];
      for (const item of items) {
        const nearExpiry = await qGet(
          `SELECT b.id, b.batch_number, b.expiration_date, b.quantity
           FROM inventory_batches b
           WHERE b.tenant_id = $1 AND b.item_id = $2 AND b.quantity > 0
           ORDER BY b.expiration_date ASC
           LIMIT 1`,
          [tenantId, item.id]
        );
        itemsWithBatches.push({ ...item, nearest_batch: nearExpiry || null });
      }

      res.json({
        success: true,
        items: itemsWithBatches,
        low_stock: lowStock,
        total_value: totalValue,
        low_count: lowStock.length
      });
    } catch (e) { safeError(res, e); }
  });

  // POST /inventory/add — create or replenish an item (admin only)
  router.post(
    '/inventory/add',
    inventoryLimiter,
    authMiddleware,
    checkRole('admin'),
    validate(schemas.inventoryAdd),
    async (req, res) => {
      try {
        const { name, sku, category, quantity, unit, cost_price, min_stock, batch_number, expiration_date } = req.body;
        const tenantId = getTenantId(req);
        const qty = quantity;
        const userId = req.user?.id || req.user?.username || 'admin';
        const batchNo = batch_number || ('BATCH-' + Date.now().toString(36).toUpperCase());
        const expDate = expiration_date || null;

        const result = await withTransaction(async () => {
          const existing = await qGet(
            "SELECT id, current_stock FROM inventory_items WHERE tenant_id = $1 AND sku = $2",
            [tenantId, sku]
          );
          if (existing) {
            const before = existing.current_stock || 0;
            const after = before + qty;
            await q(
              "UPDATE inventory_items SET current_stock = current_stock + $1, updated_at = NOW() WHERE tenant_id = $2 AND sku = $3",
              [qty, tenantId, sku]
            );
            const batchRows = await q(
              "INSERT INTO inventory_batches (tenant_id, item_id, batch_number, quantity, expiration_date) VALUES ($1, $2, $3, $4, $5) RETURNING id",
              [tenantId, existing.id, batchNo, qty, expDate]
            );
            const batchId = batchRows[0].id;
            await q(
              `INSERT INTO inventory_transactions (tenant_id, item_id, type, quantity, performed_by, balance_before, balance_after, reason, batch_id, batch_number)
               VALUES ($1, $2, 'IN', $3, $4, $5, $6, $7, $8, $9)`,
              [tenantId, existing.id, qty, userId, before, after, `Kirim: ${name} (partiya: ${batchNo})`, batchId, batchNo]
            );
            return {
              success: true,
              item: { ...existing, current_stock: after },
              is_update: true,
              batch_id: batchId,
              batch_number: batchNo,
              expiration_date: expDate
            };
          } else {
            const newItemRows = await q(
              "INSERT INTO inventory_items (tenant_id, name, sku, category, current_stock, unit, cost_price, min_stock) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
              [tenantId, name, sku, category || null, qty, unit || 'dona', cost_price || null, min_stock || null]
            );
            const newItem = newItemRows[0];
            const batchRows = await q(
              "INSERT INTO inventory_batches (tenant_id, item_id, batch_number, quantity, expiration_date) VALUES ($1, $2, $3, $4, $5) RETURNING id",
              [tenantId, newItem.id, batchNo, qty, expDate]
            );
            const batchId = batchRows[0].id;
            await q(
              `INSERT INTO inventory_transactions (tenant_id, item_id, type, quantity, performed_by, balance_before, balance_after, reason, batch_id, batch_number)
               VALUES ($1, $2, 'IN', $3, $4, 0, $5, $6, $7, $8)`,
              [tenantId, newItem.id, qty, userId, qty, `Yangi: ${name} (partiya: ${batchNo})`, batchId, batchNo]
            );
            return {
              success: true,
              item: newItem,
              is_update: false,
              batch_id: batchId,
              batch_number: batchNo,
              expiration_date: expDate
            };
          }
        });

        res.json(result);
      } catch (e) { safeError(res, e); }
    }
  );

  // POST /inventory/consume — FEFO batch consumption (agent-bypass or JWT)
  router.post(
    '/inventory/consume',
    agentBypassOrAuth('admin', 'doctor'),
    validate(schemas.inventoryConsume),
    async (req, res) => {
      try {
        const { procedure_name, doctor_id, performed_by, item_id, requested_quantity, user_id } = req.body;
        const tenantId = getTenantId(req);
        const userId = user_id ?? performed_by ?? req.user?.id ?? req.user?.username ?? 'unknown';

        // Direct item consumption (agent mode)
        if (item_id && requested_quantity) {
          const result = await withTransaction(async () => {
            const item = await qGet(
              "SELECT id, name, current_stock FROM inventory_items WHERE tenant_id = $1 AND id = $2",
              [tenantId, item_id]
            );
            if (!item) throw routeError(404, 'Material topilmadi');
            if (item.current_stock < requested_quantity) {
              throw routeError(400, `Omborda yetarli material yo'q (qoldiq: ${item.current_stock}, kerak: ${requested_quantity})`);
            }

            // Overuse calculation
            const std = await qGet(
              "SELECT standard_quantity FROM procedure_material_standards WHERE tenant_id = $1 AND procedure_name = $2 AND item_id = $3",
              [tenantId, procedure_name || '', item_id]
            );
            const standardQty = std ? std.standard_quantity : requested_quantity;
            const overuseQty = Math.max(0, requested_quantity - standardQty);

            let need = requested_quantity;
            const batches = await q(
              "SELECT * FROM inventory_batches WHERE tenant_id = $1 AND item_id = $2 AND quantity > 0 ORDER BY expiration_date ASC NULLS LAST, id ASC",
              [tenantId, item_id]
            );
            if (batches.length === 0) throw routeError(400, `${item.name} uchun yaroqli partiya topilmadi`);
            const batchConsumptions = [];
            for (const batch of batches) {
              if (need <= 0) break;
              const take = Math.min(batch.quantity, need);
              await q(
                "UPDATE inventory_batches SET quantity = quantity - $1 WHERE tenant_id = $2 AND id = $3 AND quantity >= $4",
                [take, tenantId, batch.id, take]
              );
              need -= take;
              batchConsumptions.push({ batch_id: batch.id, batch_number: batch.batch_number, qty: take });
            }
            if (need > 0) throw routeError(400, `${item.name} uchun partiyalardagi qoldiq yetarli emas`);
            const totalRow = await qGet(
              "SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_batches WHERE tenant_id = $1 AND item_id = $2",
              [tenantId, item_id]
            );
            const totalLeft = totalRow.total;
            await q(
              "UPDATE inventory_items SET current_stock = $1, updated_at = NOW() WHERE tenant_id = $2 AND id = $3",
              [totalLeft, tenantId, item_id]
            );
            for (const bc of batchConsumptions) {
              await q(
                `INSERT INTO inventory_transactions (tenant_id, item_id, type, quantity, performed_by, balance_before, balance_after, reason, batch_id, batch_number, standard_quantity, overuse_quantity)
                 VALUES ($1, $2, 'CONSUMPTION', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [tenantId, item_id, bc.qty, userId, item.current_stock, totalLeft,
                 `Agent FEFO: ${procedure_name || 'to\'g\'ridan-to\'g\'ri'} (partiya: ${bc.batch_number})`,
                 bc.batch_id, bc.batch_number, standardQty, overuseQty]
              );
            }
            return {
              item_name: item.name,
              total_consumed: requested_quantity,
              balance_before: item.current_stock,
              balance_after: totalLeft,
              batch_consumptions: batchConsumptions,
              standard_quantity: standardQty,
              overuse_quantity: overuseQty,
              is_overused: overuseQty > 0
            };
          });

          return res.json({ success: true, ...result });
        }

        // Procedure-based consumption (original mode)
        if (!procedure_name) {
          return res.status(400).json({ success: false, error: 'procedure_name yoki item_id+requested_quantity talab qilinadi' });
        }
        const norms = await q(
          `SELECT pn.*, inv.name as item_name, inv.current_stock, inv.sku
           FROM procedure_material_norms pn
           JOIN inventory_items inv ON inv.tenant_id = pn.tenant_id AND inv.id = pn.item_id
           WHERE pn.tenant_id = $1 AND pn.procedure_name LIKE $2`,
          [tenantId, `%${procedure_name}%`]
        );
        if (norms.length === 0) {
          return res.status(404).json({ success: false, error: `"${procedure_name}" uchun me'yor topilmadi` });
        }

        // ACID transaction — FEFO batch consumption + overuse tracking
        const details = await withTransaction(async () => {
          for (const n of norms) {
            const freshItem = await qGet(
              "SELECT current_stock FROM inventory_items WHERE tenant_id = $1 AND id = $2",
              [tenantId, n.item_id]
            );
            if (!freshItem || freshItem.current_stock < n.standard_quantity) {
              const shortage = n.standard_quantity - (freshItem ? freshItem.current_stock : 0);
              throw routeError(400,
                `"${n.item_name}" uchun omborda yetarli zaxira yo'q. Kerak: ${n.standard_quantity}, bor: ${freshItem ? freshItem.current_stock : 0}`
              );
            }
          }
          const detailsArr = [];
          for (const n of norms) {
            let need = n.standard_quantity;

            const matStd = await qGet(
              "SELECT standard_quantity FROM procedure_material_standards WHERE tenant_id = $1 AND procedure_name = $2 AND item_id = $3",
              [tenantId, procedure_name, n.item_id]
            );
            const standardQty = matStd ? matStd.standard_quantity : n.standard_quantity;
            const overuseQty = Math.max(0, n.standard_quantity - standardQty);

            const batches = await q(
              "SELECT * FROM inventory_batches WHERE tenant_id = $1 AND item_id = $2 AND quantity > 0 ORDER BY expiration_date ASC NULLS LAST, id ASC",
              [tenantId, n.item_id]
            );
            if (batches.length === 0) throw routeError(400, `${n.item_name} uchun yaroqli partiya topilmadi`);

            const beforeRow = await qGet(
              "SELECT current_stock FROM inventory_items WHERE tenant_id = $1 AND id = $2",
              [tenantId, n.item_id]
            );
            const before = beforeRow ? beforeRow.current_stock : 0;
            const batchConsumptions = [];

            for (const batch of batches) {
              if (need <= 0) break;
              const take = Math.min(batch.quantity, need);
              await q(
                "UPDATE inventory_batches SET quantity = quantity - $1 WHERE tenant_id = $2 AND id = $3 AND quantity >= $4",
                [take, tenantId, batch.id, take]
              );
              need -= take;
              batchConsumptions.push({
                batch_id: batch.id,
                batch_number: batch.batch_number,
                expiration_date: batch.expiration_date,
                qty: take
              });
            }

            if (need > 0) {
              throw routeError(400,
                `${n.item_name} uchun barcha partiyalardagi jami qoldiq so'ralgan miqdordan kam. Kam qismi: ${need}`
              );
            }

            const totalRow = await qGet(
              "SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_batches WHERE tenant_id = $1 AND item_id = $2",
              [tenantId, n.item_id]
            );
            const totalLeft = totalRow.total;
            await q(
              "UPDATE inventory_items SET current_stock = $1, updated_at = NOW() WHERE tenant_id = $2 AND id = $3",
              [totalLeft, tenantId, n.item_id]
            );
            const after = totalLeft;

            for (const bc of batchConsumptions) {
              await q(
                `INSERT INTO inventory_transactions (tenant_id, item_id, type, quantity, performed_by, balance_before, balance_after, reason, batch_id, batch_number, standard_quantity, overuse_quantity)
                 VALUES ($1, $2, 'CONSUMPTION', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [tenantId, n.item_id, bc.qty, userId, before, after,
                 `FEFO: ${procedure_name} (partiya: ${bc.batch_number})`,
                 bc.batch_id, bc.batch_number, standardQty, overuseQty]
              );
            }

            detailsArr.push({
              item: n.item_name,
              sku: n.sku,
              qty: n.standard_quantity,
              balance_before: before,
              balance_after: after,
              standard_quantity: standardQty,
              overuse_quantity: overuseQty,
              is_overused: overuseQty > 0,
              batches: batchConsumptions.map(bc => ({
                batch_id: bc.batch_id,
                batch_number: bc.batch_number,
                expiration_date: bc.expiration_date,
                qty_taken: bc.qty
              }))
            });
          }

          // Update doctor analytics
          if (doctor_id) {
            const period = new Date().toISOString().slice(0, 10);
            await q(
              `INSERT INTO doctor_analytics (tenant_id, doctor_id, doctor_name, total_procedures, period_start, period_end)
               VALUES ($1, $2, $3, 1, $4, $5)
               ON CONFLICT (tenant_id, doctor_id, period_start)
               DO UPDATE SET total_procedures = total_procedures + 1`,
              [tenantId, doctor_id, doctor_id, period, period]
            );
          }
          return detailsArr;
        });

        const anyOverused = details.some(d => d.is_overused);
        res.json({
          success: true,
          procedure: procedure_name,
          materials_used: details.length,
          details,
          is_overused: anyOverused
        });
      } catch (e) { safeError(res, e, e.status || 500); }
    }
  );

  // GET /inventory/search — search items by name or SKU
  router.get('/inventory/search', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const qry = req.query.q || '';
      if (qry.length < 1) return res.json({ success: true, items: [] });
      const items = await q(
        "SELECT * FROM inventory_items WHERE tenant_id = $1 AND (name ILIKE $2 OR sku ILIKE $3) LIMIT 15",
        [tenantId, `%${qry}%`, `%${qry}%`]
      );
      res.json({ success: true, items });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // 2. VOICE ADD
  // ============================================================

  // POST /inventory/voice-add — AI-transcribed audio inventory receipt
  router.post(
    '/inventory/voice-add',
    telegramOrJwtAuth('admin'),
    upload.single('audio'),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Audio fayl majburiy' });

        // transcribe and llm are imported at the server level; we bridge via safe import
        // or require them here. The orchestrator is a peer dependency.
        const { transcribe, llm } = await import('../../ai/orchestrator.js');

        const { text, error } = await transcribe(req.file.buffer, req.file.originalname || 'audio.webm', { language: req.body?.language });
        if (error) return res.status(500).json({ success: false, error });

        const result = await llm(
          'Siz omborchi asistentsiz. Ovozli buyruqdan: material nomi, miqdor, partiya raqami va yaroqlilik muddatini (YYYY-MM-DD) ajrating. Agar partiya raqami aytilmagan bo\'lsa, batch_number ga null qo\'ying. Agar sana aytilmagan bo\'lsa, expiration_date ga null qo\'ying. JSON format: {"name":"...","quantity":1,"batch_number":"...","expiration_date":"YYYY-MM-DD"}',
          text
        );
        if (!result || !result.name) {
          return res.json({ success: true, transcription: text, data: result, requires_manual: true });
        }

        const qty = parseFloat(result.quantity);
        if (!qty || qty <= 0) return res.status(400).json({ success: false, error: 'Miqdor noto\'g\'ri' });

        // Safe input sanitisation
        const sanitizeInput = (s) => (s || '').replace(/[^\w\s\-.,()\/\u0400-\u04FF]/g, '').trim().substring(0, 500);
        const safeName = sanitizeInput(result.name);
        const safeBatch = sanitizeInput(result.batch_number);

        if (!safeName) {
          return res.status(400).json({ success: false, error: 'Material nomi bo\'sh yoki faqat maxsus belgilardan iborat' });
        }

        const now = new Date();
        const batchNo = safeBatch || ('BATCH-AUTO-' + now.toISOString().slice(0, 10).replace(/-/g, ''));
        const expDate = result.expiration_date || new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
        const userId = req.user?.id || req.user?.username || 'admin';
        const tenantId = getTenantId(req);

        // ACID transaction
        await withTransaction(async () => {
          const existing = await qGet("SELECT id, current_stock FROM inventory_items WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)", [tenantId, safeName]);
          let itemId, before;

          if (existing) {
            itemId = existing.id;
            before = existing.current_stock || 0;
          } else {
            const sku = 'V-' + Date.now().toString(36).toUpperCase();
            const r = await q(
              "INSERT INTO inventory_items (tenant_id, name, sku, category, current_stock, unit) VALUES ($1, $2, $3, $4, 0, 'dona') RETURNING id",
              [tenantId, safeName, sku, 'Boshqa']
            );
            itemId = r[0].id;
            before = 0;
          }

          // UPSERT batch (unique: tenant_id, item_id, batch_number)
          await q(
            `INSERT INTO inventory_batches (tenant_id, item_id, batch_number, quantity, expiration_date) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, item_id, batch_number) DO UPDATE SET quantity = inventory_batches.quantity + EXCLUDED.quantity`,
            [tenantId, itemId, batchNo, qty, expDate]
          );

          const totalRow = await qGet(
            "SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_batches WHERE tenant_id = $1 AND item_id = $2",
            [tenantId, itemId]
          );
          const after = totalRow.total;
          await q(
            "UPDATE inventory_items SET current_stock = $1, updated_at = NOW() WHERE tenant_id = $2 AND id = $3",
            [after, tenantId, itemId]
          );

          const batchRow = await qGet(
            "SELECT id FROM inventory_batches WHERE tenant_id = $1 AND item_id = $2 AND batch_number = $3",
            [tenantId, itemId, batchNo]
          );
          await q(
            `INSERT INTO inventory_transactions (tenant_id, item_id, type, quantity, performed_by, balance_before, balance_after, reason, batch_id, batch_number)
             VALUES ($1, $2, 'VOICE_RECEIPT', $3, $4, $5, $6, $7, $8, $9)`,
            [tenantId, itemId, qty, userId, before, after,
             `Ovozli kirim: ${safeName} (partiya: ${batchNo}, yaroqlilik: ${expDate})`,
             batchRow ? batchRow.id : null, batchNo]
          );
        });

        res.json({ success: true, transcription: text, data: result });
      } catch (e) { safeError(res, e); }
    }
  );

  // ============================================================
  // 3. TRANSACTIONS
  // ============================================================

  // GET /inventory/transactions — recent transactions
  router.get('/inventory/transactions', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const limit = parseInt(req.query.limit) || 50;
      const txns = await q(
        `SELECT t.*, i.name as item_name, i.sku as item_sku
         FROM inventory_transactions t
         LEFT JOIN inventory_items i ON i.tenant_id = t.tenant_id AND i.id = t.item_id
         WHERE t.tenant_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2`,
        [tenantId, limit]
      );
      res.json({ success: true, total: txns.length, transactions: txns });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // 4. BATCHES
  // ============================================================

  // GET /inventory/batches/:item_id — list batches for an item
  router.get('/inventory/batches/:item_id', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const batches = await q(
        "SELECT * FROM inventory_batches WHERE tenant_id = $1 AND item_id = $2 ORDER BY expiration_date ASC NULLS LAST, id ASC",
        [tenantId, req.params.item_id]
      );
      const item = await qGet(
        "SELECT id, name, sku, current_stock FROM inventory_items WHERE tenant_id = $1 AND id = $2",
        [tenantId, req.params.item_id]
      );
      res.json({ success: true, item, batches });
    } catch (e) { safeError(res, e); }
  });

  // PUT /inventory/batches/:id — update batch details
  router.put('/inventory/batches/:id', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const { batch_number, expiration_date } = req.body;
      const tenantId = getTenantId(req);
      const existing = await qGet(
        `SELECT b.*, i.name as item_name
         FROM inventory_batches b
         JOIN inventory_items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
         WHERE b.tenant_id = $1 AND b.id = $2`,
        [tenantId, id]
      );
      if (!existing) return res.status(404).json({ success: false, error: 'Partiya topilmadi' });

      await withTransaction(async () => {
        if (batch_number !== undefined) {
          await q("UPDATE inventory_batches SET batch_number = $1 WHERE tenant_id = $2 AND id = $3", [batch_number, tenantId, id]);
        }
        if (expiration_date !== undefined) {
          await q("UPDATE inventory_batches SET expiration_date = $1 WHERE tenant_id = $2 AND id = $3", [expiration_date || null, tenantId, id]);
        }
      });

      const updated = await qGet(
        `SELECT id, tenant_id, item_id, batch_number, quantity,
                TO_CHAR(expiration_date, 'YYYY-MM-DD') AS expiration_date, created_at
         FROM inventory_batches WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id]
      );
      res.json({ success: true, batch: updated });
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ success: false, error: 'Bu partiya raqami ushbu material uchun allaqachon mavjud' });
      }
      safeError(res, e);
    }
  });

  // DELETE /inventory/batches/:id — delete batch + adjust current_stock
  router.delete('/inventory/batches/:id', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const tenantId = getTenantId(req);
      const existing = await qGet(
        `SELECT b.*, i.name as item_name
         FROM inventory_batches b
         JOIN inventory_items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
         WHERE b.tenant_id = $1 AND b.id = $2`,
        [tenantId, id]
      );
      if (!existing) return res.status(404).json({ success: false, error: 'Partiya topilmadi' });

      await withTransaction(async () => {
        await q("DELETE FROM inventory_batches WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
        const totalRow = await qGet(
          "SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_batches WHERE tenant_id = $1 AND item_id = $2",
          [tenantId, existing.item_id]
        );
        const totalLeft = totalRow.total;
        await q(
          "UPDATE inventory_items SET current_stock = $1, updated_at = NOW() WHERE tenant_id = $2 AND id = $3",
          [totalLeft, tenantId, existing.item_id]
        );
        await q(
          `INSERT INTO inventory_transactions (tenant_id, item_id, type, quantity, performed_by, balance_before, balance_after, reason, batch_id, batch_number)
           VALUES ($1, $2, 'ADJUST', $3, $4, $5, $6, $7, $8, $9)`,
          [tenantId, existing.item_id, -existing.quantity, req.user?.id || req.user?.username || 'admin',
           totalLeft + existing.quantity, totalLeft,
           `Partiya o'chirildi: ${existing.batch_number}`, id, existing.batch_number]
        );
      });

      res.json({ success: true, message: `${existing.batch_number} partiyasi o'chirildi`, item_id: existing.item_id });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // 5. INTERNAL — Agent-bypass consumption
  // ============================================================

  // POST /internal/inventory/consume — AI agent FEFO consumption (agent-bypass or JWT)
  router.post('/internal/inventory/consume', agentBypassOrAuth('admin', 'doctor'), async (req, res) => {
    try {
      const { item_id, quantity, reason, procedure_name } = req.body;
      const tenantId = getTenantId(req);
      if (!item_id || !quantity || quantity <= 0) {
        return res.status(400).json({ success: false, error: 'item_id va quantity (musbat) talab qilinadi' });
      }
      const item = await qGet(
        "SELECT id, name, current_stock FROM inventory_items WHERE tenant_id = $1 AND id = $2",
        [tenantId, item_id]
      );
      if (!item) return res.status(404).json({ success: false, error: 'Material topilmadi' });
      if (item.current_stock < quantity) {
        return res.status(400).json({
          success: false,
          error: `Omborda yetarli material yo'q (qoldiq: ${item.current_stock}, kerak: ${quantity})`,
          current_stock: item.current_stock
        });
      }

      const result = await withTransaction(async () => {
        let need = quantity;
        const batches = await q(
          "SELECT * FROM inventory_batches WHERE tenant_id = $1 AND item_id = $2 AND quantity > 0 ORDER BY expiration_date ASC NULLS LAST, id ASC",
          [tenantId, item_id]
        );
        if (batches.length === 0) throw routeError(400, `${item.name} uchun yaroqli partiya topilmadi`);
        const batchConsumptions = [];
        for (const batch of batches) {
          if (need <= 0) break;
          const take = Math.min(batch.quantity, need);
          await q(
            "UPDATE inventory_batches SET quantity = quantity - $1 WHERE tenant_id = $2 AND id = $3 AND quantity >= $4",
            [take, tenantId, batch.id, take]
          );
          need -= take;
          batchConsumptions.push({ batch_id: batch.id, batch_number: batch.batch_number, qty: take });
        }
        if (need > 0) throw routeError(400, `${item.name} uchun partiyalardagi qoldiq yetarli emas`);
        const totalRow = await qGet(
          "SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_batches WHERE tenant_id = $1 AND item_id = $2",
          [tenantId, item_id]
        );
        const totalLeft = totalRow.total;
        await q(
          "UPDATE inventory_items SET current_stock = $1, updated_at = NOW() WHERE tenant_id = $2 AND id = $3",
          [totalLeft, tenantId, item_id]
        );
        for (const bc of batchConsumptions) {
          await q(
            `INSERT INTO inventory_transactions (tenant_id, item_id, type, quantity, performed_by, balance_before, balance_after, reason, batch_id, batch_number)
             VALUES ($1, $2, 'CONSUMPTION', $3, 'internal-agent', $4, $5, $6, $7, $8)`,
            [tenantId, item_id, bc.qty, item.current_stock, totalLeft,
             reason || `Agent: ${procedure_name || 'noaniq'} (partiya: ${bc.batch_number})`,
             bc.batch_id, bc.batch_number]
          );
        }
        return { batch_consumptions: batchConsumptions, balance_before: item.current_stock, balance_after: totalLeft };
      });

      res.json({ success: true, item: item.name, quantity, ...result });
    } catch (e) { safeError(res, e, e.status || 500); }
  });

  // ============================================================
  // 6. REPORTS
  // ============================================================

  // GET /reports/inventory-waste — overuse/waste analytics (CEO/admin)
  router.get('/reports/inventory-waste', telegramOrJwtAuth('ceo', 'admin'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const totalWaste = await qGet(`
        SELECT COALESCE(SUM(t.overuse_quantity * i.cost_price), 0) as total_waste_sum,
               COALESCE(SUM(t.overuse_quantity), 0) as total_waste_qty,
               COUNT(*) as waste_transactions
        FROM inventory_transactions t
        JOIN inventory_items i ON i.tenant_id = t.tenant_id AND i.id = t.item_id
        WHERE t.tenant_id = $1 AND t.overuse_quantity > 0
      `, [tenantId]);

      const topOverused = await q(`
        SELECT i.name, i.sku, i.unit,
               SUM(t.overuse_quantity) as total_overuse_qty,
               SUM(t.overuse_quantity * i.cost_price) as total_waste_cost,
               COUNT(*) as usage_count
        FROM inventory_transactions t
        JOIN inventory_items i ON i.tenant_id = t.tenant_id AND i.id = t.item_id
        WHERE t.tenant_id = $1 AND t.overuse_quantity > 0
        GROUP BY t.item_id, i.name, i.sku, i.unit
        ORDER BY total_waste_cost DESC
        LIMIT 5
      `, [tenantId]);

      const doctorWaste = await q(`
        SELECT COALESCE(s.full_name, t.performed_by, 'noma''lum') as doctor_name,
               SUM(t.overuse_quantity) as total_overuse_qty,
               SUM(t.overuse_quantity * i.cost_price) as total_waste_cost,
               COUNT(*) as overuse_events
        FROM inventory_transactions t
        JOIN inventory_items i ON i.tenant_id = t.tenant_id AND i.id = t.item_id
        LEFT JOIN staff_members s ON s.tenant_id = t.tenant_id AND CAST(s.telegram_id AS TEXT) = t.performed_by
        WHERE t.tenant_id = $1 AND t.overuse_quantity > 0
        GROUP BY t.performed_by, s.full_name
        ORDER BY total_waste_cost DESC
      `, [tenantId]);

      const cleanCount = await qGet(
        "SELECT COUNT(*) as c FROM inventory_transactions WHERE tenant_id = $1 AND (overuse_quantity IS NULL OR overuse_quantity = 0)",
        [tenantId]
      );

      res.json({
        success: true,
        total_waste_sum: totalWaste?.total_waste_sum || 0,
        total_waste_qty: totalWaste?.total_waste_qty || 0,
        waste_transactions: totalWaste?.waste_transactions || 0,
        total_items_used: (totalWaste?.waste_transactions || 0) + (cleanCount?.c || 0),
        overuse_count: totalWaste?.waste_transactions || 0,
        top_overused_items: topOverused || [],
        doctor_waste_ranking: doctorWaste || []
      });
    } catch (e) { safeError(res, e); }
  });

  // GET /reports/limits — doctor monthly limit report
  router.get('/reports/limits', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const monthlyLimit = 200;
      const doctors = await q(
        `SELECT s.full_name as doctor_name,
                COUNT(a.id) as used_this_month,
                $1 as monthly_limit
         FROM staff_members s
         LEFT JOIN appointments a
           ON a.tenant_id = s.tenant_id
           AND a.doctor_name = s.full_name
           AND a.status = 'completed'
           AND a.created_at >= date_trunc('month', CURRENT_DATE)
         WHERE s.tenant_id = $2 AND s.role = 'DOCTOR'
         GROUP BY s.id
         ORDER BY s.full_name`,
        [monthlyLimit, tenantId]
      );
      res.json({ success: true, data: doctors });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // 7. PROCEDURE MATERIAL NORMS CRUD (admin)
  // ============================================================

  // GET /inventory/norms — list all norms
  router.get('/inventory/norms', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const norms = await q(
        `SELECT pn.*, inv.name as item_name, inv.sku, inv.current_stock
         FROM procedure_material_norms pn
         LEFT JOIN inventory_items inv ON inv.tenant_id = pn.tenant_id AND inv.id = pn.item_id
         WHERE pn.tenant_id = $1
         ORDER BY pn.procedure_name`,
        [tenantId]
      );
      res.json({ success: true, norms });
    } catch (e) { safeError(res, e); }
  });

  // POST /inventory/norms — create a norm
  router.post(
    '/inventory/norms',
    authMiddleware,
    checkRole('admin'),
    validate(schemas.normsCreate),
    async (req, res) => {
      try {
        const { procedure_name, item_id, standard_quantity } = req.body;
        const tenantId = getTenantId(req);
        const item = await qGet("SELECT id FROM inventory_items WHERE tenant_id = $1 AND id = $2", [tenantId, item_id]);
        if (!item) return res.status(404).json({ success: false, error: 'Material topilmadi' });
        const r = await q(
          "INSERT INTO procedure_material_norms (tenant_id, procedure_name, item_id, standard_quantity) VALUES ($1, $2, $3, $4) RETURNING id",
          [tenantId, procedure_name, item_id, standard_quantity]
        );
        const norm = await qGet(
          `SELECT pn.*, inv.name as item_name
           FROM procedure_material_norms pn
           LEFT JOIN inventory_items inv ON inv.tenant_id = pn.tenant_id AND inv.id = pn.item_id
           WHERE pn.tenant_id = $1 AND pn.id = $2`,
          [tenantId, r[0].id]
        );
        res.json({ success: true, norm });
      } catch (e) { safeError(res, e); }
    }
  );

  // PUT /inventory/norms/:id — update a norm
  router.put(
    '/inventory/norms/:id',
    authMiddleware,
    checkRole('admin'),
    validate(schemas.normsUpdate),
    async (req, res) => {
      try {
        const { id } = req.params;
        const tenantId = getTenantId(req);
        const existing = await qGet(
          "SELECT id FROM procedure_material_norms WHERE tenant_id = $1 AND id = $2",
          [tenantId, id]
        );
        if (!existing) return res.status(404).json({ success: false, error: 'Me\'yor topilmadi' });

        if (req.body.item_id !== undefined) {
          const item = await qGet(
            "SELECT id FROM inventory_items WHERE tenant_id = $1 AND id = $2",
            [tenantId, req.body.item_id]
          );
          if (!item) return res.status(404).json({ success: false, error: 'Material topilmadi' });
        }

        const fields = [];
        const values = [];
        let paramIndex = 1;
        for (const [key, val] of Object.entries(req.body)) {
          if (val !== undefined && ['procedure_name', 'item_id', 'standard_quantity'].includes(key)) {
            fields.push(`${key} = $${paramIndex++}`);
            values.push(val);
          }
        }
        if (fields.length === 0) {
          return res.status(400).json({ success: false, error: 'Yangilanadigan maydon yo\'q' });
        }
        values.push(id, tenantId);
        await q(
          `UPDATE procedure_material_norms SET ${fields.join(', ')} WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}`,
          values
        );

        const norm = await qGet(
          `SELECT pn.*, inv.name as item_name
           FROM procedure_material_norms pn
           LEFT JOIN inventory_items inv ON inv.tenant_id = pn.tenant_id AND inv.id = pn.item_id
           WHERE pn.tenant_id = $1 AND pn.id = $2`,
          [tenantId, id]
        );
        res.json({ success: true, norm });
      } catch (e) { safeError(res, e); }
    }
  );

  // DELETE /inventory/norms/:id — delete a norm
  router.delete('/inventory/norms/:id', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const tenantId = getTenantId(req);
      const existing = await qGet(
        "SELECT id FROM procedure_material_norms WHERE tenant_id = $1 AND id = $2",
        [tenantId, id]
      );
      if (!existing) return res.status(404).json({ success: false, error: 'Me\'yor topilmadi' });
      await q("DELETE FROM procedure_material_norms WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
      res.json({ success: true, message: 'Me\'yor o\'chirildi' });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
