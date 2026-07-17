import { llm } from '../engines/llm.js';
import { transcribe } from '../engines/stt.js';

export const name = 'inventory-manager';
export const description = 'Omborchi AI — ovoz va matn orqali inventarizatsiya, sarf me\'yorlari va kam qoldiq xavflarini boshqaradi';
export const version = '2.1.0';

const SYSTEM_PROMPT = `Siz "Falcon AI OS" ning Inventory Manager agentsiz — klinika omborini boshqaruvchi super AI.
Vazifangiz: ovozli buyruq yoki matndan mahsulot nomi, SKU, kategoriya, miqdor va o'lchov birligini aniqlash.

Qoidalar:
1. Agar SKU aytilmasa, nomga asoslanib taklif qiling
2. Kategoriyani aniqlay olmasangiz "Boshqa" qo'ying
3. Miqdor aniq aytilmasa 1 deb oling
4. O'lchov birligi (unit): dona, gr, ml, kg, litr, paket, rulon, juft, shisha, tabletka

JSON formatda qaytaring:
{
  "name": "string",
  "sku": "string|null",
  "category": "string",
  "quantity": 1,
  "unit": "dona",
  "suggest_min_stock": "number|null",
  "notes": "string|null"
}`;

export const inputSchema = {
  text: { type: 'string', required: false, description: 'Matnli buyruq' },
  audio: { type: 'buffer', required: false, description: 'Audio buyruq' },
  action: { type: 'string', required: false, description: 'Harakat: add, consume, check, list, status' }
};

export async function handler(input, context = {}) {
  const db = context.db;

  if (input.action === 'list') {
    if (!db?.isReady()) return { error: 'DB mavjud emas' };
    const items = db.q('SELECT id, name, sku, category, current_stock, unit, min_stock FROM inventory_items ORDER BY name');
    return { action: 'list', total: items.length, items };
  }

  if (input.action === 'status') {
    if (!db?.isReady()) return { error: 'DB mavjud emas' };
    const total = db.qGet('SELECT COUNT(*) as count, SUM(current_stock) as total_qty FROM inventory_items');
    const lowStock = db.q("SELECT id, name, current_stock, min_stock, unit FROM inventory_items WHERE current_stock <= min_stock ORDER BY (current_stock * 1.0 / NULLIF(min_stock, 0)) ASC");
    const categories = db.q('SELECT category, COUNT(*) as count FROM inventory_items GROUP BY category');
    return { action: 'status', summary: { total_items: total?.count || 0, total_quantity: total?.total_qty || 0, low_stock_count: lowStock.length }, low_stock: lowStock, categories, has_db: true };
  }

  if (input.action === 'check') {
    if (!db?.isReady()) return { error: 'DB mavjud emas' };
    const searchTerm = input.text || '';
    if (searchTerm.length < 2) return { error: 'Qidiruv so\'zi juda qisqa' };
    const items = db.q('SELECT id, name, sku, category, current_stock, unit, min_stock, cost_price FROM inventory_items WHERE name LIKE ? OR sku LIKE ?', [`%${searchTerm}%`, `%${searchTerm}%`]);
    return { action: 'check', query: searchTerm, total: items.length, items };
  }

  let text = input.text;
  if (input.audio && !text) {
    const result = await transcribe(input.audio, 'inventory_audio.webm');
    if (result.error) return { error: `Transkripsiya xatosi: ${result.error}` };
    text = result.text;
  }

  if (!text || text.trim().length < 2) return { error: 'Buyruq matni juda qisqa' };

  let prompt = SYSTEM_PROMPT;
  if (input.action) prompt += `\nHarakat: ${input.action}`;

  const parsed = await llm(prompt, text, { temperature: 0.1, maxTokens: 800 });
  if (parsed.error) return { error: `AI tahlil xatosi: ${parsed.error}` };

  let savedItem = null;
  if (db?.isReady() && input.action === 'add' && parsed?.name) {
    try {
      const sku = parsed.sku || ('SKU-' + Date.now().toString(36).toUpperCase());
      db.qExec('INSERT INTO inventory_items (name, sku, category, current_stock, unit, min_stock) VALUES (?, ?, ?, ?, ?, ?)',
        [parsed.name, sku, parsed.category || 'Boshqa', parsed.quantity || 1, parsed.unit || 'dona', parsed.suggest_min_stock || null]);
      savedItem = { sku, name: parsed.name };
    } catch (e) {
      savedItem = { error: e.message };
    }
  }

  return {
    transcription: text,
    parsed,
    action: input.action || 'auto',
    saved_to_db: !!savedItem,
    saved_item: savedItem
  };
}
