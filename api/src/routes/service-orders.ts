import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ensureProducts } from '../lib/auto-product';

const so = new Hono<{ Bindings: Bindings; Variables: Variables }>();
so.use('*', authMiddleware);

so.get('/', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const status = c.req.query('status') || '';
  const search = c.req.query('q') || '';
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = (page - 1) * limit;

  let query = `SELECT s.*, c.name as customer_name, c.company_name as customer_company FROM service_orders s LEFT JOIN customers c ON s.customer_id = c.id WHERE s.user_id = ?`;
  const params: any[] = [tenantId];
  if (status) { query += ' AND s.status = ?'; params.push(status); }
  if (search) { query += ' AND (s.so_number LIKE ? OR c.name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all();
  const countRow = await db.prepare(
    `SELECT COUNT(*) as count FROM service_orders s LEFT JOIN customers c ON s.customer_id = c.id WHERE s.user_id = ?` +
    (status ? ' AND s.status = ?' : '') + (search ? ' AND (s.so_number LIKE ? OR c.name LIKE ?)' : '')
  ).bind(...params.slice(0, -2)).first<{ count: number }>();
  return c.json({ data: rows.results, total: countRow?.count || 0, page, limit });
});

so.get('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const doc = await db.prepare(
    'SELECT s.*, c.name as customer_name, c.email as customer_email, c.address as customer_address FROM service_orders s LEFT JOIN customers c ON s.customer_id = c.id WHERE s.id = ? AND s.user_id = ?'
  ).bind(id, tenantId).first();
  if (!doc) return c.json({ error: 'Service order not found' }, 404);
  const items = await db.prepare('SELECT * FROM service_order_items WHERE so_id = ? ORDER BY sort_order').bind(id).all();
  return c.json({ ...doc, items: items.results });
});

const itemSchema = z.object({
  product_id: z.string().optional(), description: z.string().min(1), quantity: z.number().min(0),
  unit_price: z.number().min(0), amount: z.number().min(0), sort_order: z.number().optional(),
});

const createSchema = z.object({
  so_number: z.string().min(1), customer_id: z.string().min(1),
  issue_date: z.string(), valid_from: z.string().optional(), valid_until: z.string().optional(),
  status: z.string().optional(), currency: z.string().optional(),
  tax_rate: z.number().optional(), discount_amount: z.number().optional(),
  notes: z.string().optional(), terms: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

so.post('/', zValidator('json', createSchema), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `so-${uuidv4().slice(0, 8)}`;

  const subtotal = data.items.reduce((sum, item) => sum + item.amount, 0);
  const taxRate = data.tax_rate || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const discount = data.discount_amount || 0;
  const total = subtotal + taxAmount - discount;

  await db.prepare(
    `INSERT INTO service_orders (id, user_id, so_number, customer_id, status, issue_date, valid_from, valid_until, subtotal, tax_rate, tax_amount, discount_amount, total, currency, notes, terms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, data.so_number, data.customer_id, data.status || 'draft', data.issue_date, data.valid_from || null, data.valid_until || null, subtotal, taxRate, taxAmount, discount, total, data.currency || 'HKD', data.notes || null, data.terms || null).run();

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    await db.prepare(
      'INSERT INTO service_order_items (id, so_id, product_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(`soi-${uuidv4().slice(0, 8)}`, id, item.product_id || null, item.description, item.quantity, item.unit_price, item.amount, item.sort_order || i).run();
  }

  await ensureProducts(db, user.id, data.items);

  const doc = await db.prepare('SELECT * FROM service_orders WHERE id = ?').bind(id).first();
  const items = await db.prepare('SELECT * FROM service_order_items WHERE so_id = ? ORDER BY sort_order').bind(id).all();
  return c.json({ ...doc, items: items.results }, 201);
});

so.patch('/:id/status', zValidator('json', z.object({ status: z.string() })), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  const existing = await db.prepare('SELECT id FROM service_orders WHERE id = ? AND user_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Service order not found' }, 404);
  await db.prepare("UPDATE service_orders SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, id).run();
  const doc = await db.prepare('SELECT * FROM service_orders WHERE id = ?').bind(id).first();
  return c.json(doc);
});

so.delete('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM service_orders WHERE id = ? AND user_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Service order not found' }, 404);
  await c.env.DB.prepare('DELETE FROM service_orders WHERE id = ? AND user_id = ?').bind(id, tenantId).run();
  return c.json({ success: true });
});

export { so as serviceOrderRoutes };
