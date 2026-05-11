import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const todos = new Hono<{ Bindings: Bindings; Variables: Variables }>();
todos.use('*', authMiddleware);

// ── List ──
todos.get('/', async (c) => {
  const user = c.get('user');
  const status = c.req.query('status') || '';
  let q = 'SELECT * FROM todos WHERE user_id = ?';
  const p: any[] = [user.id];
  if (status) { q += ' AND status = ?'; p.push(status); }
  q += ' ORDER BY sort_order, created_at DESC';
  const rows = await c.env.DB.prepare(q).bind(...p).all();
  return c.json({ data: rows.results });
});

// ── Create ──
const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.string().optional(),
  due_date: z.string().optional(),
  customer_id: z.string().optional(),
});

todos.post('/', zValidator('json', createSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `td-${uuidv4().slice(0, 8)}`;

  const maxRow = await db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 as next FROM todos WHERE user_id = ?').bind(user.id).first<{next:number}>();
  const sort = maxRow?.next || 1;

  await db.prepare(
    'INSERT INTO todos (id, user_id, title, description, status, priority, due_date, customer_id, sort_order) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(id, user.id, data.title, data.description || null, 'pending', data.priority || 'medium', data.due_date || null, data.customer_id || null, sort).run();

  const row = await db.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

// ── Update ──
todos.patch('/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const sets: string[] = []; const params: any[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (['title','description','status','priority','due_date','customer_id','sort_order'].includes(k)) {
      sets.push(`${k} = ?`); params.push(v);
    }
  }
  if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(id, user.id);

  await db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  const row = await db.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first();
  return c.json(row);
});

// ── Delete ──
todos.delete('/:id', async (c) => {
  const user = c.get('user');
  const existing = await c.env.DB.prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).run();
  return c.json({ success: true });
});

export { todos as todoRoutes };
