import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const calendar = new Hono<{ Bindings: Bindings; Variables: Variables }>();
calendar.use('*', authMiddleware);

// ── List events (with date range filter) — includes virtual events from documents & invoices ──
calendar.get('/events', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const start = c.req.query('start') || new Date().toISOString().split('T')[0];
  const end = c.req.query('end');

  // Real calendar events
  let query = `SELECT ce.*, c.name as customer_name FROM calendar_events ce LEFT JOIN customers c ON ce.customer_id = c.id WHERE ce.user_id = ? AND ce.start_time >= ?`;
  const params: any[] = [tenantId, start];
  if (end) { query += ' AND ce.start_time <= ?'; params.push(end); }
  query += ' ORDER BY ce.start_time ASC';
  const rows = await db.prepare(query).bind(...params).all();
  const events = (rows.results || []) as any[];

  // Virtual events: unpaid/overdue invoices (應收未收)
  const invoices = await db.prepare(
    `SELECT i.id, i.invoice_number, i.due_date, i.total, i.status, i.customer_id, c.name as customer_name
     FROM invoices i JOIN customers c ON i.customer_id = c.id
     WHERE i.user_id = ? AND i.status NOT IN ('paid','cancelled') AND i.due_date IS NOT NULL`
  ).bind(tenantId).all();

  for (const inv of (invoices.results || []) as any[]) {
    if (!inv.due_date) continue;
    const isOverdue = inv.due_date < new Date().toISOString().split('T')[0];
    events.push({
      id: `inv-${inv.id}`,
      user_id: user.id,
      title: `${isOverdue ? '⚠ ' : ''}${inv.invoice_number} - ${inv.customer_name || ''}`,
      description: `Invoice ${inv.status}: HKD ${(inv.total || 0).toLocaleString()}`,
      event_type: 'invoice_due',
      start_time: inv.due_date,
      end_time: inv.due_date,
      all_day: 1,
      customer_id: inv.customer_id,
      customer_name: inv.customer_name,
      color: isOverdue ? '#dc2626' : '#ca8a04',
      reference_type: 'invoice',
      reference_id: inv.id,
      location: '',
    });
  }

  // Virtual events: document expiry dates (BR, CI, EI, EC, TC, RL)
  const docs = await db.prepare(
    `SELECT id, doc_type, doc_year, file_name, expiry_date, issue_date, br_number, company_name_ocr
     FROM documents WHERE user_id = ? AND expiry_date IS NOT NULL AND expiry_date != ''`
  ).bind(tenantId).all();

  const docColors: Record<string, string> = { br: '#2563eb', ci: '#16a34a', ei: '#9333ea', ec: '#0891b2', tc: '#db2777', rl: '#4f46e5' };
  const docLabels: Record<string, string> = { br: 'BR', ci: 'CI', ei: 'EI', ec: 'Employment', tc: 'Telecom', rl: 'Rental' };

  for (const doc of (docs.results || []) as any[]) {
    if (!doc.expiry_date) continue;
    events.push({
      id: `doc-${doc.id}`,
      user_id: user.id,
      title: `${docLabels[doc.doc_type] || doc.doc_type} Expiry - ${doc.company_name_ocr || doc.br_number || doc.file_name || ''}`,
      description: `${docLabels[doc.doc_type] || doc.doc_type} ${doc.doc_year || ''} expires`,
      event_type: 'deadline',
      start_time: doc.expiry_date,
      end_time: doc.expiry_date,
      all_day: 1,
      customer_id: null,
      customer_name: null,
      color: docColors[doc.doc_type] || '#6b7280',
      reference_type: 'document',
      reference_id: doc.id,
      location: '',
    });
  }

  // Sort merged events by start_time
  events.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  return c.json({ data: events });
});

// ── Create event ──
const eventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  event_type: z.string().optional(),
  start_time: z.string(),
  end_time: z.string().optional(),
  all_day: z.number().optional(),
  customer_id: z.string().optional(),
  color: z.string().optional(),
  location: z.string().optional(),
});

calendar.post('/events', zValidator('json', eventSchema), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `ev-${uuidv4().slice(0, 8)}`;

  await db.prepare(
    'INSERT INTO calendar_events (id, user_id, title, description, event_type, start_time, end_time, all_day, customer_id, color, location) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(id, user.id, data.title, data.description || null, data.event_type || 'appointment',
    data.start_time, data.end_time || null, data.all_day || 0, data.customer_id || null,
    data.color || '#2563eb', data.location || null).run();

  const row = await db.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

// ── Update event ──
calendar.put('/events/:id', zValidator('json', eventSchema.partial()), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const existing = await db.prepare('SELECT id FROM calendar_events WHERE id = ? AND user_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const sets: string[] = []; const params: any[] = [];
  for (const [k, v] of Object.entries(data)) { sets.push(`${k} = ?`); params.push(v); }
  sets.push("updated_at = datetime('now')");
  params.push(id, tenantId);

  await db.prepare(`UPDATE calendar_events SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  const row = await db.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
  return c.json(row);
});

// ── Delete event ──
calendar.delete('/events/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM calendar_events WHERE id = ? AND user_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM calendar_events WHERE id = ? AND user_id = ?').bind(id, tenantId).run();
  return c.json({ success: true });
});

export { calendar as calendarRoutes };
