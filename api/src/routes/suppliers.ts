import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const suppliers = new Hono<{ Bindings: Bindings; Variables: Variables }>();
suppliers.use('*', authMiddleware);

suppliers.get('/', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const search = c.req.query('q') || '';
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM suppliers WHERE user_id = ? AND is_active = 1';
  const params: any[] = [tenantId];
  if (search) { query += ' AND (name LIKE ? OR company_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all();
  const countRow = await db.prepare(
    'SELECT COUNT(*) as count FROM suppliers WHERE user_id = ? AND is_active = 1' +
    (search ? ' AND (name LIKE ? OR company_name LIKE ?)' : '')
  ).bind(...(search ? [tenantId, `%${search}%`, `%${search}%`] : [tenantId])).first<{ count: number }>();

  return c.json({ data: rows.results, total: countRow?.count || 0, page, limit });
});

suppliers.get('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const row = await c.env.DB.prepare('SELECT * FROM suppliers WHERE id = ? AND user_id = ?').bind(c.req.param('id'), tenantId).first();
  if (!row) return c.json({ error: 'Supplier not found' }, 404);
  return c.json(row);
});

const createSchema = z.object({
  name: z.string().min(1), company_name: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')), phone: z.string().optional(),
  address: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
  postal_code: z.string().optional(), country: z.string().optional(),
  notes: z.string().optional(), tax_id: z.string().optional(), payment_terms: z.string().optional(),
});

suppliers.post('/', zValidator('json', createSchema), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `s-${uuidv4().slice(0, 8)}`;

  await db.prepare(
    `INSERT INTO suppliers (id, user_id, name, company_name, email, phone, address, city, state, postal_code, country, notes, tax_id, payment_terms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, data.name, data.company_name || null, data.email || null, data.phone || null,
    data.address || null, data.city || null, data.state || null, data.postal_code || null,
    data.country || 'Hong Kong', data.notes || null, data.tax_id || null, data.payment_terms || null).run();

  await db.prepare('INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, changes) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(`al-${uuidv4().slice(0, 8)}`, user.id, 'create', 'supplier', id, JSON.stringify(data)).run();

  const row = await db.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

suppliers.put('/:id', zValidator('json', createSchema.partial()), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const existing = await db.prepare('SELECT id FROM suppliers WHERE id = ? AND user_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Supplier not found' }, 404);

  const sets: string[] = []; const params: any[] = [];
  for (const [key, value] of Object.entries(data)) { sets.push(`${key} = ?`); params.push(value); }
  sets.push('updated_at = datetime(\'now\')'); params.push(id, tenantId);

  await db.prepare(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  await db.prepare('INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, changes) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(`al-${uuidv4().slice(0, 8)}`, user.id, 'update', 'supplier', id, JSON.stringify(data)).run();

  const row = await db.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first();
  return c.json(row);
});

suppliers.delete('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT id FROM suppliers WHERE id = ? AND user_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Supplier not found' }, 404);
  await db.prepare('UPDATE suppliers SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?').bind(id, tenantId).run();
  return c.json({ success: true });
});

export { suppliers as supplierRoutes };
