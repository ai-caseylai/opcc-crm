import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ensureProducts } from '../lib/auto-product';

const po = new Hono<{ Bindings: Bindings; Variables: Variables }>();
po.use('*', authMiddleware);

async function generatePONumber(db: D1Database, userId: string): Promise<string> {
  const now = new Date();
  const YY = now.getFullYear().toString().slice(-2);
  const MM = (now.getMonth() + 1).toString().padStart(2, '0');
  const prefix = `PO${YY}${MM}-`;

  const result = await db.prepare(
    'SELECT po_number FROM purchase_orders WHERE user_id = ? AND po_number LIKE ? ORDER BY po_number DESC LIMIT 1'
  ).bind(userId, `${prefix}%`).first<{ po_number: string }>();

  let counter = 1;
  if (result) {
    const num = parseInt(result.po_number.substring(prefix.length), 10);
    if (!isNaN(num)) counter = num + 1;
  }
  return prefix + counter.toString().padStart(3, '0');
}

po.get('/', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const status = c.req.query('status') || '';
  const search = c.req.query('q') || '';
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = (page - 1) * limit;

  let query = `SELECT p.*, s.name as supplier_name, s.company_name as supplier_company FROM purchase_orders p LEFT JOIN suppliers s ON p.supplier_id = s.id WHERE p.user_id = ?`;
  const params: any[] = [tenantId];
  if (status) { query += ' AND p.status = ?'; params.push(status); }
  if (search) { query += ' AND (p.po_number LIKE ? OR s.name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all();
  const countRow = await db.prepare(
    `SELECT COUNT(*) as count FROM purchase_orders p LEFT JOIN suppliers s ON p.supplier_id = s.id WHERE p.user_id = ?` +
    (status ? ' AND p.status = ?' : '') + (search ? ' AND (p.po_number LIKE ? OR s.name LIKE ?)' : '')
  ).bind(...params.slice(0, -2)).first<{ count: number }>();
  return c.json({ data: rows.results, total: countRow?.count || 0, page, limit });
});

po.get('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const doc = await db.prepare(
    'SELECT p.*, s.name as supplier_name, s.email as supplier_email, s.address as supplier_address FROM purchase_orders p LEFT JOIN suppliers s ON p.supplier_id = s.id WHERE p.id = ? AND p.user_id = ?'
  ).bind(id, tenantId).first();
  if (!doc) return c.json({ error: 'Purchase order not found' }, 404);
  const items = await db.prepare('SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY sort_order').bind(id).all();
  return c.json({ ...doc, items: items.results });
});

const itemSchema = z.object({
  product_id: z.string().optional(), description: z.string().min(1), quantity: z.number().min(0),
  unit_price: z.number().min(0), amount: z.number().min(0), sort_order: z.number().optional(),
});

const createSchema = z.object({
  po_number: z.string().optional(), supplier_id: z.string().optional(),
  issue_date: z.string(), due_date: z.string().optional(), status: z.string().optional(),
  currency: z.string().optional(), tax_rate: z.number().optional(), discount_amount: z.number().optional(),
  notes: z.string().optional(), terms: z.string().optional(),
  receipt_number: z.string().optional(), paid_date: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

po.post('/', zValidator('json', createSchema), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `po-${uuidv4().slice(0, 8)}`;
  const po_number = data.po_number || await generatePONumber(db, tenantId);

  const subtotal = data.items.reduce((sum, item) => sum + item.amount, 0);
  const taxRate = data.tax_rate || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const discount = data.discount_amount || 0;
  const total = subtotal + taxAmount - discount;

  await db.prepare(
    `INSERT INTO purchase_orders (id, user_id, po_number, supplier_id, status, issue_date, due_date, subtotal, tax_rate, tax_amount, discount_amount, total, currency, notes, terms, receipt_number, paid_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, po_number, data.supplier_id || null, data.status || 'draft', data.issue_date, data.due_date || null, subtotal, taxRate, taxAmount, discount, total, data.currency || 'HKD', data.notes || null, data.terms || null, data.receipt_number || null, data.paid_date || null).run();

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    await db.prepare(
      'INSERT INTO purchase_order_items (id, po_id, product_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(`poi-${uuidv4().slice(0, 8)}`, id, item.product_id || null, item.description, item.quantity, item.unit_price, item.amount, item.sort_order || i).run();
  }

  await ensureProducts(db, user.id, data.items);

  const doc = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(id).first();
  const items = await db.prepare('SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY sort_order').bind(id).all();
  return c.json({ ...doc, items: items.results }, 201);
});

po.patch('/:id/status', zValidator('json', z.object({ status: z.string() })), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  const existing = await db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND user_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Purchase order not found' }, 404);
  await db.prepare("UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, id).run();
  const doc = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(id).first();
  return c.json(doc);
});

po.delete('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM purchase_orders WHERE id = ? AND user_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Purchase order not found' }, 404);
  await c.env.DB.prepare('DELETE FROM purchase_orders WHERE id = ? AND user_id = ?').bind(id, tenantId).run();
  return c.json({ success: true });
});

export { po as purchaseOrderRoutes };
