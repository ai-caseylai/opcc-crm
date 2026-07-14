import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { Bindings, Variables } from '../types';

const waitlist = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /api/waitlist — public, no auth
waitlist.post('/', zValidator('json', z.object({ email: z.string().email() })), async (c) => {
  const { email } = c.req.valid('json');
  const db = c.env.DB;

  const existing = await db.prepare('SELECT id FROM waitlist WHERE email = ?').bind(email).first();
  if (existing) {
    return c.json({ success: true, message: 'already_registered' });
  }

  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO waitlist (id, email, source) VALUES (?, ?, ?)')
    .bind(id, email, 'landing').run();

  return c.json({ success: true, message: 'registered' }, 201);
});

// GET /api/waitlist/count — public
waitlist.get('/count', async (c) => {
  const db = c.env.DB;
  const row = await db.prepare('SELECT COUNT(*) as count FROM waitlist').first<{ count: number }>();
  return c.json({ count: row?.count || 0 });
});

export { waitlist as waitlistRoutes };
