import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const calendar = new Hono<{ Bindings: Bindings; Variables: Variables }>();
calendar.use('*', authMiddleware);

// ── List events (with date range filter) ──
calendar.get('/events', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const start = c.req.query('start') || new Date().toISOString().split('T')[0];
  const end = c.req.query('end');

  let query = `SELECT ce.*, c.name as customer_name FROM calendar_events ce LEFT JOIN customers c ON ce.customer_id = c.id WHERE ce.user_id = ? AND ce.start_time >= ?`;
  const params: any[] = [user.id, start];
  if (end) { query += ' AND ce.start_time <= ?'; params.push(end); }
  query += ' ORDER BY ce.start_time ASC';

  const rows = await db.prepare(query).bind(...params).all();
  return c.json({ data: rows.results });
});

// ── Auto-include invoice due dates as calendar events ──
calendar.get('/overdue-invoices', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT i.id as reference_id, i.invoice_number, i.due_date as start_time, i.total, i.status as invoice_status, c.name as customer_name
     FROM invoices i JOIN customers c ON i.customer_id = c.id
     WHERE i.user_id = ? AND i.status NOT IN ('paid','cancelled') AND i.due_date >= date('now')
     ORDER BY i.due_date ASC LIMIT 50`
  ).bind(user.id).all();
  return c.json({ data: rows.results });
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
  const db = c.env.DB;
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const existing = await db.prepare('SELECT id FROM calendar_events WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const sets: string[] = []; const params: any[] = [];
  for (const [k, v] of Object.entries(data)) { sets.push(`${k} = ?`); params.push(v); }
  sets.push("updated_at = datetime('now')");
  params.push(id, user.id);

  await db.prepare(`UPDATE calendar_events SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  const row = await db.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
  return c.json(row);
});

// ── Delete event ──
calendar.delete('/events/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM calendar_events WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM calendar_events WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return c.json({ success: true });
});

export { calendar as calendarRoutes };
