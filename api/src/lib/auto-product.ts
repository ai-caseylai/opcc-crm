import { v4 as uuidv4 } from 'uuid';

export async function ensureProducts(db: D1Database, userId: string, items: { description?: string; unit_price?: number }[]) {
  for (const item of items) {
    if (!item.description) continue;
    const existing = await db.prepare(
      'SELECT id FROM products WHERE user_id = ? AND name = ? AND is_active = 1 LIMIT 1'
    ).bind(userId, item.description).first();
    if (!existing) {
      const id = `p-${uuidv4().slice(0, 8)}`;
      await db.prepare(
        'INSERT INTO products (id, user_id, name, category, unit_price, currency, unit) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, userId, item.description, 'Service', item.unit_price || 0, 'HKD', 'unit').run();
    }
  }
}
