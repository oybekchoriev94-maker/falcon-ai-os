// ============================================================
// ERPNext klient — unit testlar (DB'siz, tarmoqsiz)
//
// CI'da ERPNEXT_URL YO'Q — integratsiya o'chirilgan holatda
// testlanadi: sof konstruktorlar to'g'ri ishlashi kerak, tarmoq
// funksiyalari null qaytarishi (ichki ombor buzilmaydi).
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  isErpnextEnabled,
  toErpnextUom,
  toErpnextItem,
  toErpnextStockEntry,
  createErpnextDoc,
  updateErpnextDoc,
  findErpnextDoc,
} from '../backend/services/erpnext-client.js';

describe('ERPNext gate', () => {
  it('ERPNEXT_URL bo\'sh bo\'lsa integratsiya o\'chiq', () => {
    expect(isErpnextEnabled()).toBe(false);
  });

  it('o\'chiq holda create/update/find null qaytaradi (tarmoqqa chiqmaydi)', async () => {
    expect(await createErpnextDoc('Item', {})).toBeNull();
    expect(await updateErpnextDoc('Item', 'SKU-1', {})).toBeNull();
    expect(await findErpnextDoc('Item', [['item_code', '=', 'x']])).toBeNull();
  });
});

describe('toErpnextUom', () => {
  it('o\'zbek birliklarini ERPNext UOM\'ga o\'tkazadi', () => {
    expect(toErpnextUom('dona')).toBe('Unit');
    expect(toErpnextUom('quti')).toBe('Box');
    expect(toErpnextUom('litr')).toBe('Litre');
    expect(toErpnextUom('kg')).toBe('Kg');
    expect(toErpnextUom('ampula')).toBe('Unit');
  });

  it('registrga bog\'liq emas va noma\'lum birlik Unit bo\'ladi', () => {
    expect(toErpnextUom('DONA')).toBe('Unit');
    expect(toErpnextUom('shtukaturka')).toBe('Unit');
    expect(toErpnextUom(null)).toBe('Unit');
  });
});

describe('toErpnextItem', () => {
  it('ombor elementini ERPNext Item payload\'iga aylantiradi', () => {
    const doc = toErpnextItem({
      sku: 'DORI-001',
      name: 'Paratsetamol 500mg',
      unit: 'dona',
      category: 'Dorilar',
      cost_price: 1500,
    });
    expect(doc).toEqual({
      item_code: 'DORI-001',
      item_name: 'Paratsetamol 500mg',
      stock_uom: 'Unit',
      is_stock_item: 1,
      item_group: 'Dorilar',
      valuation_rate: 1500,
    });
  });

  it('category/cost_price bo\'lmasa chiqmaydi', () => {
    const doc = toErpnextItem({ sku: 'X-1', name: 'X', unit: 'quti' });
    expect(doc.item_group).toBeUndefined();
    expect(doc.valuation_rate).toBeUndefined();
    expect(doc.stock_uom).toBe('Box');
  });
});

describe('toErpnextStockEntry', () => {
  const base = { itemCode: 'DORI-001', warehouse: 'Asosiy ombor - F', company: 'Oqtosh Klinik' };

  it('IN → Material Receipt (t_warehouse)', () => {
    const doc = toErpnextStockEntry({ ...base, tx: { type: 'IN', quantity: 50, reason: 'Kirim' } });
    expect(doc.stock_entry_type).toBe('Material Receipt');
    expect(doc.items[0]).toEqual({ item_code: 'DORI-001', qty: 50, t_warehouse: 'Asosiy ombor - F' });
    expect(doc.company).toBe('Oqtosh Klinik');
    expect(doc.remarks).toBe('Kirim');
  });

  it('CONSUMPTION → Material Issue (s_warehouse)', () => {
    const doc = toErpnextStockEntry({ ...base, tx: { type: 'CONSUMPTION', quantity: 3 } });
    expect(doc.stock_entry_type).toBe('Material Issue');
    expect(doc.items[0].s_warehouse).toBe('Asosiy ombor - F');
    expect(doc.items[0].t_warehouse).toBeUndefined();
  });

  it('ADJUST ishoraga qarab: musbat = Receipt, manfiy = Issue (abs qty)', () => {
    const up = toErpnextStockEntry({ ...base, tx: { type: 'ADJUST', quantity: 5 } });
    const down = toErpnextStockEntry({ ...base, tx: { type: 'ADJUST', quantity: -2 } });
    expect(up.stock_entry_type).toBe('Material Receipt');
    expect(up.items[0].qty).toBe(5);
    expect(down.stock_entry_type).toBe('Material Issue');
    expect(down.items[0].qty).toBe(2);
  });

  it('ma\'lumot yetishmasa yoki miqdor 0 bo\'lsa null', () => {
    expect(toErpnextStockEntry({ ...base, tx: { type: 'IN', quantity: 0 } })).toBeNull();
    expect(toErpnextStockEntry({ ...base, itemCode: null, tx: { type: 'IN', quantity: 1 } })).toBeNull();
    expect(toErpnextStockEntry({ ...base, warehouse: '', tx: { type: 'IN', quantity: 1 } })).toBeNull();
    expect(toErpnextStockEntry({ ...base, tx: { type: 'NOTIQLASH', quantity: 1 } })).toBeNull();
  });

  it('posting_date va uzun remarks chegaralanadi', () => {
    const long = 'x'.repeat(500);
    const doc = toErpnextStockEntry({
      ...base,
      tx: { type: 'IN', quantity: 1, reason: long },
      postingDate: '2026-08-26',
    });
    expect(doc.posting_date).toBe('2026-08-26');
    expect(doc.remarks.length).toBe(240);
  });
});
