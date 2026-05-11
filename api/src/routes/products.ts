import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const products = new Hono<{ Bindings: Bindings; Variables: Variables }>();
products.use('*', authMiddleware);

products.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const search = c.req.query('q') || '';
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM products WHERE user_id = ? AND is_active = 1';
  const params: any[] = [user.id];
  if (search) { query += ' AND (name LIKE ? OR description LIKE ? OR sku LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  query += ' ORDER BY name ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all();
  const countRow = await db.prepare(
    'SELECT COUNT(*) as count FROM products WHERE user_id = ? AND is_active = 1' +
    (search ? ' AND (name LIKE ? OR description LIKE ? OR sku LIKE ?)' : '')
  ).bind(...(search ? [user.id, `%${search}%`, `%${search}%`, `%${search}%`] : [user.id])).first<{ count: number }>();
  return c.json({ data: rows.results, total: countRow?.count || 0, page, limit });
});

products.get('/:id', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT * FROM products WHERE id = ? AND user_id = ?').bind(c.req.param('id'), user.id).first();
  if (!row) return c.json({ error: 'Product not found' }, 404);
  return c.json(row);
});

const createSchema = z.object({
  name: z.string().min(1), description: z.string().optional(), unit_price: z.number().min(0),
  currency: z.string().optional(), unit: z.string().optional(), category: z.string().optional(), sku: z.string().optional(),
});

products.post('/', zValidator('json', createSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `p-${uuidv4().slice(0, 8)}`;
  await db.prepare(
    'INSERT INTO products (id, user_id, name, description, unit_price, currency, unit, category, sku) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, data.name, data.description || null, data.unit_price, data.currency || 'HKD', data.unit || 'pcs', data.category || null, data.sku || null).run();
  const row = await db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

products.put('/:id', zValidator('json', createSchema.partial()), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const existing = await db.prepare('SELECT id FROM products WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Product not found' }, 404);

  const sets: string[] = []; const params: any[] = [];
  for (const [key, value] of Object.entries(data)) { sets.push(`${key} = ?`); params.push(value); }
  sets.push('updated_at = datetime(\'now\')'); params.push(id, user.id);
  await db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  const row = await db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  return c.json(row);
});

products.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM products WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Product not found' }, 404);
  await c.env.DB.prepare('UPDATE products SET is_active = 0 WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return c.json({ success: true });
});

export { products as productRoutes };
