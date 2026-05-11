import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const quotations = new Hono<{ Bindings: Bindings; Variables: Variables }>();
quotations.use('*', authMiddleware);

quotations.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const status = c.req.query('status') || '';
  const search = c.req.query('q') || '';
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = (page - 1) * limit;

  let query = `SELECT q.*, c.name as customer_name, c.company_name as customer_company FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id WHERE q.user_id = ?`;
  const params: any[] = [user.id];
  if (status) { query += ' AND q.status = ?'; params.push(status); }
  if (search) { query += ' AND (q.quotation_number LIKE ? OR c.name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY q.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all();
  const countRow = await db.prepare(
    `SELECT COUNT(*) as count FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id WHERE q.user_id = ?` +
    (status ? ' AND q.status = ?' : '') + (search ? ' AND (q.quotation_number LIKE ? OR c.name LIKE ?)' : '')
  ).bind(...params.slice(0, -2)).first<{ count: number }>();
  return c.json({ data: rows.results, total: countRow?.count || 0, page, limit });
});

quotations.get('/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = c.req.param('id');
  const quotation = await db.prepare(
    'SELECT q.*, c.name as customer_name, c.email as customer_email, c.address as customer_address FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id WHERE q.id = ? AND q.user_id = ?'
  ).bind(id, user.id).first();
  if (!quotation) return c.json({ error: 'Quotation not found' }, 404);
  const items = await db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order').bind(id).all();
  return c.json({ ...quotation, items: items.results });
});

const itemSchema = z.object({
  product_id: z.string().optional(), description: z.string().min(1), quantity: z.number().min(0),
  unit_price: z.number().min(0), amount: z.number().min(0), sort_order: z.number().optional(),
});

const createSchema = z.object({
  quotation_number: z.string().min(1), customer_id: z.string().min(1), issue_date: z.string(), valid_until: z.string(),
  status: z.string().optional(), currency: z.string().optional(), tax_rate: z.number().optional(),
  discount_amount: z.number().optional(), notes: z.string().optional(), terms: z.string().optional(), items: z.array(itemSchema).min(1),
});

quotations.post('/', zValidator('json', createSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `q-${uuidv4().slice(0, 8)}`;

  const subtotal = data.items.reduce((sum, item) => sum + item.amount, 0);
  const taxRate = data.tax_rate || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const discount = data.discount_amount || 0;
  const total = subtotal + taxAmount - discount;

  await db.prepare(
    `INSERT INTO quotations (id, user_id, quotation_number, customer_id, status, issue_date, valid_until, subtotal, tax_rate, tax_amount, discount_amount, total, currency, notes, terms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, data.quotation_number, data.customer_id, data.status || 'draft', data.issue_date, data.valid_until, subtotal, taxRate, taxAmount, discount, total, data.currency || 'HKD', data.notes || null, data.terms || null).run();

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    await db.prepare(
      'INSERT INTO quotation_items (id, quotation_id, product_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(`qi-${uuidv4().slice(0, 8)}`, id, item.product_id || null, item.description, item.quantity, item.unit_price, item.amount, item.sort_order || i).run();
  }

  await db.prepare('INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, changes) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(`al-${uuidv4().slice(0, 8)}`, user.id, 'create', 'quotation', id, JSON.stringify({ quotation_number: data.quotation_number })).run();

  const quotation = await db.prepare('SELECT * FROM quotations WHERE id = ?').bind(id).first();
  const items = await db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order').bind(id).all();
  return c.json({ ...quotation, items: items.results }, 201);
});

quotations.post('/:id/convert', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = c.req.param('id');
  const quotation = await db.prepare('SELECT * FROM quotations WHERE id = ? AND user_id = ?').bind(id, user.id).first<Record<string, any>>();
  if (!quotation) return c.json({ error: 'Quotation not found' }, 404);
  if (quotation.status === 'converted') return c.json({ error: 'Already converted' }, 400);

  const invoiceId = `i-${uuidv4().slice(0, 8)}`;
  const invoiceNumber = `INV-${Date.now()}`;
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  await db.prepare(
    `INSERT INTO invoices (id, user_id, invoice_number, customer_id, status, issue_date, due_date, subtotal, tax_rate, tax_amount, discount_amount, total, currency, notes, terms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(invoiceId, user.id, invoiceNumber, quotation.customer_id, 'draft', new Date().toISOString().split('T')[0], dueDate, quotation.subtotal, quotation.tax_rate, quotation.tax_amount, quotation.discount_amount, quotation.total, quotation.currency, quotation.notes, quotation.terms).run();

  const items = await db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order').bind(id).all();
  for (const item of items.results as any[]) {
    await db.prepare(
      'INSERT INTO invoice_items (id, invoice_id, product_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(`ii-${uuidv4().slice(0, 8)}`, invoiceId, item.product_id, item.description, item.quantity, item.unit_price, item.amount, item.sort_order).run();
  }

  await db.prepare('UPDATE quotations SET status = ?, converted_invoice_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind('converted', invoiceId, id).run();
  return c.json({ invoice_id: invoiceId, invoice_number: invoiceNumber });
});

quotations.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM quotations WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Quotation not found' }, 404);
  await c.env.DB.prepare('DELETE FROM quotations WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return c.json({ success: true });
});

export { quotations as quotationRoutes };
