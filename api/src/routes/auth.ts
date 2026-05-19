import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sign } from 'jsonwebtoken';
import { hash, compare } from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables, AuthUser } from '../types';
import { authMiddleware } from '../middleware/auth';

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  company_name: z.string().optional(),
});

auth.post('/register', zValidator('json', registerSchema), async (c) => {
  const { email, password, name, company_name } = c.req.valid('json');
  const db = c.env.DB;
  const jwtSecret = c.env.JWT_SECRET || 'dev-secret-change-me';

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Email already registered' }, 409);

  const id = `u-${uuidv4().slice(0, 8)}`;
  const passwordHash = await hash(password, 10);

  // First user ever → admin; subsequent registrations → user
  const countRow = await db.prepare('SELECT COUNT(*) as cnt FROM users').first<{cnt:number}>();
  const role = (countRow?.cnt || 0) === 0 ? 'admin' : 'user';

  await db.prepare(
    'INSERT INTO users (id, email, password_hash, name, company_name, role) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, email, passwordHash, name, company_name || null, role).run();

  const user: AuthUser = { id, email, name, role, company_name };
  const token = sign(user, jwtSecret, { expiresIn: '24h' });
  return c.json({ user, token }, 201);
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

auth.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');
  const db = c.env.DB;
  const jwtSecret = c.env.JWT_SECRET || 'dev-secret-change-me';

  const row = await db.prepare(
    'SELECT id, email, password_hash, name, role, company_name FROM users WHERE email = ?'
  ).bind(email).first<{ id: string; email: string; password_hash: string; name: string; role: string; company_name: string | null }>();

  if (!row) return c.json({ error: 'Invalid email or password' }, 401);

  const valid = await compare(password, row.password_hash);
  if (!valid) return c.json({ error: 'Invalid email or password' }, 401);

  const user: AuthUser = {
    id: row.id, email: row.email, name: row.name, role: row.role,
    company_name: row.company_name || undefined,
  };

  // Check firm membership
  const firmMember = await db.prepare(
    `SELECT fm.firm_id, fm.role as firm_role, f.name as firm_name
     FROM firm_members fm JOIN firms f ON f.id = fm.firm_id
     WHERE fm.user_id = ? AND fm.is_active = 1`
  ).bind(row.id).first<{ firm_id: string; firm_role: string; firm_name: string }>();
  if (firmMember) {
    user.firm_id = firmMember.firm_id;
    user.firm_role = firmMember.firm_role;
  }

  const token = sign(user, jwtSecret, { expiresIn: '24h' });
  return c.json({ user, token });
});

auth.get('/me', authMiddleware, (c) => {
  return c.json({ user: c.get('user') });
});

export { auth as authRoutes };
