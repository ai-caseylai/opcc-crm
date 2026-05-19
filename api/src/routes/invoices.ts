import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ensureProducts } from '../lib/auto-product';

const invoices = new Hono<{ Bindings: Bindings; Variables: Variables }>();
invoices.use('*', authMiddleware);

async function generateInvoiceNumber(db: D1Database, userId: string): Promise<string> {
  const row = await db.prepare(
    'SELECT invoice_number_pattern FROM company_settings WHERE user_id = ?'
  ).bind(userId).first<{ invoice_number_pattern: string }>();

  const pattern = row?.invoice_number_pattern || 'INV{YY}{MM}-{NNN}';
  const now = new Date();
  const YYYY = now.getFullYear().toString();
  const YY = YYYY.slice(-2);
  const MM = (now.getMonth() + 1).toString().padStart(2, '0');
  const DD = now.getDate().toString().padStart(2, '0');

  // Expand date tokens to get prefix before counter
  let prefix = pattern
    .replace('{YYYY}', YYYY)
    .replace('{YY}', YY)
    .replace('{MM}', MM)
    .replace('{DD}', DD);

  // Extract counter length from {N+} placeholder
  const counterMatch = pattern.match(/\{(N+)\}/);
  const counterLen = counterMatch ? counterMatch[1].length : 4;
  prefix = prefix.replace(/\{N+\}/, '');

  // Find highest existing number with this prefix
  const result = await db.prepare(
    'SELECT invoice_number FROM invoices WHERE user_id = ? AND invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1'
  ).bind(userId, `${prefix}%`).first<{ invoice_number: string }>();

  let counter = 1;
  if (result) {
    const numPart = result.invoice_number.substring(prefix.length);
    const num = parseInt(numPart, 10);
    if (!isNaN(num)) counter = num + 1;
  }

  return prefix + counter.toString().padStart(counterLen, '0');
}

invoices.get('/', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const status = c.req.query('status') || '';
  const search = c.req.query('q') || '';
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = (page - 1) * limit;

  let query = `SELECT i.*, c.name as customer_name, c.company_name as customer_company FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.user_id = ?`;
  const params: any[] = [tenantId];
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
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const invoice = await db.prepare(
    'SELECT i.*, c.name as customer_name, c.email as customer_email, c.address as customer_address FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ? AND i.user_id = ?'
  ).bind(id, tenantId).first();
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404);
  const items = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(id).all();
  return c.json({ ...invoice, items: items.results });
});

const itemSchema = z.object({
  product_id: z.string().optional(), description: z.string().min(1), quantity: z.number().min(0),
  unit_price: z.number().min(0), amount: z.number().min(0), sort_order: z.number().optional(),
});

const createSchema = z.object({
  invoice_number: z.string().optional(), customer_id: z.string().min(1), supplier_id: z.string().optional(),
  issue_date: z.string(), due_date: z.string(), status: z.string().optional(),
  currency: z.string().optional(), tax_rate: z.number().optional(), discount_amount: z.number().optional(),
  notes: z.string().optional(), terms: z.string().optional(),
  receipt_number: z.string().optional(), paid_date: z.string().optional(),
  attn: z.string().optional(), customer_phone: z.string().optional(),
  customer_email: z.string().optional(), customer_address: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

invoices.post('/', zValidator('json', createSchema), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `i-${uuidv4().slice(0, 8)}`;

  const invoice_number = data.invoice_number || await generateInvoiceNumber(db, tenantId);

  const subtotal = data.items.reduce((sum, item) => sum + item.amount, 0);
  const taxRate = data.tax_rate || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const discount = data.discount_amount || 0;
  const total = subtotal + taxAmount - discount;

  await db.prepare(
    `INSERT INTO invoices (id, user_id, invoice_number, customer_id, supplier_id, status, issue_date, due_date, subtotal, tax_rate, tax_amount, discount_amount, total, currency, notes, terms, receipt_number, paid_date, attn, customer_phone, customer_email, customer_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, invoice_number, data.customer_id, data.supplier_id || null, data.status || 'draft', data.issue_date, data.due_date, subtotal, taxRate, taxAmount, discount, total, data.currency || 'HKD', data.notes || null, data.terms || null, data.receipt_number || null, data.paid_date || null, data.attn || null, data.customer_phone || null, data.customer_email || null, data.customer_address || null).run();

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    await db.prepare(
      'INSERT INTO invoice_items (id, invoice_id, product_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(`ii-${uuidv4().slice(0, 8)}`, id, item.product_id || null, item.description, item.quantity, item.unit_price, item.amount, item.sort_order || i).run();
  }

  await db.prepare('INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, changes) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(`al-${uuidv4().slice(0, 8)}`, user.id, 'create', 'invoice', id, JSON.stringify({ invoice_number: data.invoice_number, total })).run();

  await ensureProducts(db, user.id, data.items);

  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first();
  const items = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(id).all();
  return c.json({ ...invoice, items: items.results }, 201);
});

invoices.patch('/:id/status', zValidator('json', z.object({ status: z.string() })), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  const existing = await db.prepare('SELECT id FROM invoices WHERE id = ? AND user_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Invoice not found' }, 404);
  await db.prepare('UPDATE invoices SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(status, id).run();
  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first();
  return c.json(invoice);
});

invoices.delete('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM invoices WHERE id = ? AND user_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Invoice not found' }, 404);
  await c.env.DB.prepare('DELETE FROM invoices WHERE id = ? AND user_id = ?').bind(id, tenantId).run();
  return c.json({ success: true });
});

export { invoices as invoiceRoutes };
