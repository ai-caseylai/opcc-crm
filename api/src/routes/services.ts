import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const services = new Hono<{ Bindings: Bindings; Variables: Variables }>();
services.use('*', authMiddleware);

// ── List services ──
services.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM services WHERE user_id = ? AND is_active = 1 ORDER BY category, name'
  ).bind(user.id).all();
  return c.json({ data: rows.results });
});

// ── Create service ──
const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  duration_minutes: z.number().optional(),
  price: z.number().min(0),
  currency: z.string().optional(),
});

services.post('/', zValidator('json', serviceSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `sv-${uuidv4().slice(0, 8)}`;

  await db.prepare(
    'INSERT INTO services (id, user_id, name, description, category, duration_minutes, price, currency) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(id, user.id, data.name, data.description || null, data.category || 'general',
    data.duration_minutes || 60, data.price, data.currency || 'HKD').run();

  const row = await db.prepare('SELECT * FROM services WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

services.put('/:id', zValidator('json', serviceSchema.partial()), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const existing = await db.prepare('SELECT id FROM services WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const sets: string[] = []; const params: any[] = [];
  for (const [k, v] of Object.entries(data)) { sets.push(`${k} = ?`); params.push(v); }
  sets.push("updated_at = datetime('now')"); params.push(id, user.id);

  await db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  const row = await db.prepare('SELECT * FROM services WHERE id = ?').bind(id).first();
  return c.json(row);
});

services.delete('/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('UPDATE services SET is_active = 0 WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).run();
  return c.json({ success: true });
});

// ── Bookings ──
services.get('/bookings', async (c) => {
  const user = c.get('user');
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];

  const rows = await c.env.DB.prepare(
    `SELECT sb.*, s.name as service_name, s.duration_minutes, c.name as customer_name, c.phone as customer_phone
     FROM service_bookings sb JOIN services s ON sb.service_id = s.id JOIN customers c ON sb.customer_id = c.id
     WHERE sb.user_id = ? AND sb.booking_date = ? ORDER BY sb.start_time`
  ).bind(user.id, date).all();
  return c.json({ data: rows.results });
});

const bookingSchema = z.object({
  service_id: z.string().min(1),
  customer_id: z.string().min(1),
  booking_date: z.string(),
  start_time: z.string(),
  end_time: z.string().optional(),
  notes: z.string().optional(),
  price: z.number().optional(),
});

services.post('/bookings', zValidator('json', bookingSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `bk-${uuidv4().slice(0, 8)}`;

  // Calculate end_time from service duration if not provided
  let endTime = data.end_time;
  if (!endTime) {
    const svc = await db.prepare('SELECT duration_minutes FROM services WHERE id = ?').bind(data.service_id).first<{ duration_minutes: number }>();
    if (svc) {
      const start = new Date(`${data.booking_date}T${data.start_time}`);
      start.setMinutes(start.getMinutes() + (svc.duration_minutes || 60));
      endTime = start.toTimeString().slice(0, 5);
    } else {
      endTime = data.start_time;
    }
  }

  await db.prepare(
    'INSERT INTO service_bookings (id, user_id, service_id, customer_id, booking_date, start_time, end_time, notes, price) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(id, user.id, data.service_id, data.customer_id, data.booking_date, data.start_time, endTime, data.notes || null, data.price || null).run();

  const row = await db.prepare(
    'SELECT sb.*, s.name as service_name, c.name as customer_name FROM service_bookings sb JOIN services s ON sb.service_id = s.id JOIN customers c ON sb.customer_id = c.id WHERE sb.id = ?'
  ).bind(id).first();
  return c.json(row, 201);
});

services.patch('/bookings/:id', zValidator('json', z.object({ status: z.string() })), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { status } = c.req.valid('json');
  await db.prepare("UPDATE service_bookings SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .bind(status, c.req.param('id'), user.id).run();
  return c.json({ success: true });
});

export { services as serviceRoutes };
