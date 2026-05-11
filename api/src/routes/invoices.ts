import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const invoices = new Hono<{ Bindings: Bindings; Variables: Variables }>();
invoices.use('*', authMiddleware);

invoices.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const status = c.req.query('status') || '';
  const search = c.req.query('q') || '';
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = (page - 1) * limit;

  let query = `SELECT i.*, c.name as customer_name, c.company_name as customer_company FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.user_id = ?`;
  const params: any[] = [user.id];
  if (status) { query += ' AND i.status = ?'; params.push(status); }
  if (search) { query += ' AND (i.invoice_number LIKE ? OR c.name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY i.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all();
  const countRow = await db.prepare(
    `SELECT COUNT(*) as count FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.user_id = ?` +
    (status ? ' AND i.status = ?' : '') + (search ? ' AND (i.invoice_number LIKE ? OR c.name LIKE ?)' : '')
  ).bind(...params.slice(0, -2)).first<{ count: number }>();
  return c.json({ data: rows.results, total: countRow?.count || 0, page, limit });
});

invoices.get('/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = c.req.param('id');
  const invoice = await db.prepare(
    'SELECT i.*, c.name as customer_name, c.email as customer_email, c.address as customer_address FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ? AND i.user_id = ?'
  ).bind(id, user.id).first();
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404);
  const items = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(id).all();
  return c.json({ ...invoice, items: items.results });
});

const itemSchema = z.object({
  product_id: z.string().optional(), description: z.string().min(1), quantity: z.number().min(0),
  unit_price: z.number().min(0), amount: z.number().min(0), sort_order: z.number().optional(),
});

const createSchema = z.object({
  invoice_number: z.string().min(1), customer_id: z.string().min(1), supplier_id: z.string().optional(),
  issue_date: z.string(), due_date: z.string(), status: z.string().optional(),
  currency: z.string().optional(), tax_rate: z.number().optional(), discount_amount: z.number().optional(),
  notes: z.string().optional(), terms: z.string().optional(), items: z.array(itemSchema).min(1),
});

invoices.post('/', zValidator('json', createSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `i-${uuidv4().slice(0, 8)}`;

  const subtotal = data.items.reduce((sum, item) => sum + item.amount, 0);
  const taxRate = data.tax_rate || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const discount = data.discount_amount || 0;
  const total = subtotal + taxAmount - discount;

  await db.prepare(
    `INSERT INTO invoices (id, user_id, invoice_number, customer_id, supplier_id, status, issue_date, due_date, subtotal, tax_rate, tax_amount, discount_amount, total, currency, notes, terms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, data.invoice_number, data.customer_id, data.supplier_id || null, data.status || 'draft', data.issue_date, data.due_date, subtotal, taxRate, taxAmount, discount, total, data.currency || 'HKD', data.notes || null, data.terms || null).run();

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    await db.prepare(
      'INSERT INTO invoice_items (id, invoice_id, product_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(`ii-${uuidv4().slice(0, 8)}`, id, item.product_id || null, item.description, item.quantity, item.unit_price, item.amount, item.sort_order || i).run();
  }

  await db.prepare('INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, changes) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(`al-${uuidv4().slice(0, 8)}`, user.id, 'create', 'invoice', id, JSON.stringify({ invoice_number: data.invoice_number, total })).run();

  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first();
  const items = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(id).all();
  return c.json({ ...invoice, items: items.results }, 201);
});

invoices.patch('/:id/status', zValidator('json', z.object({ status: z.string() })), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  const existing = await db.prepare('SELECT id FROM invoices WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Invoice not found' }, 404);
  await db.prepare('UPDATE invoices SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(status, id).run();
  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first();
  return c.json(invoice);
});

invoices.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM invoices WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Invoice not found' }, 404);
  await c.env.DB.prepare('DELETE FROM invoices WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return c.json({ success: true });
});

export { invoices as invoiceRoutes };
