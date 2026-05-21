import { getJwtSecret } from '../middleware/auth';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sign } from 'jsonwebtoken';
import { hash, compare } from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables, AuthUser } from '../types';
import { authMiddleware } from '../middleware/auth';

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Rate limiter for auth endpoints (5 attempts per minute per IP)
const authRateLimitMap = new Map<string, { count: number; resetAt: number }>();
function authRateLimiter(c: any, next: any) {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const now = Date.now();
  let entry = authRateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60000 };
    authRateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > 5) {
    return c.json({ error: 'Too many login attempts. Please try again later.' }, 429);
  }
  return next();
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain uppercase, lowercase, and number'),
  name: z.string().min(1),
  company_name: z.string().optional(),
});

auth.post('/register', authRateLimiter, zValidator('json', registerSchema), async (c) => {
  const { email, password, name, company_name } = c.req.valid('json');
  const db = c.env.DB;
  const jwtSecret = getJwtSecret(c.env);

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Email already registered' }, 409);

  const id = `u-${uuidv4().slice(0, 8)}`;
  const passwordHash = await hash(password, 12);

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

auth.post('/login', authRateLimiter, zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');
  const db = c.env.DB;
  const jwtSecret = getJwtSecret(c.env);

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

  // Set httpOnly cookie (not accessible to JavaScript, prevents XSS theft)
  // Secure only in production (HTTPS); Lax allows file downloads in new tabs
  const isProd = c.env.ENVIRONMENT === 'production';
  const secureFlag = isProd ? 'Secure; ' : '';
  c.header('Set-Cookie', `token=${token}; HttpOnly; ${secureFlag}SameSite=Lax; Path=/; Max-Age=86400`);

  return c.json({ user, token }); // token also in body for API clients
});

auth.post('/logout', async (c) => {
  // Clear the auth cookie
  const isProd = c.env.ENVIRONMENT === 'production';
  const secureFlag = isProd ? 'Secure; ' : '';
  c.header('Set-Cookie', `token=; HttpOnly; ${secureFlag}SameSite=Lax; Path=/; Max-Age=0`);
  return c.json({ success: true });
});

auth.get('/me', authMiddleware, (c) => {
  return c.json({ user: c.get('user') });
});

// Self-service account deletion (GDPR right to erasure)
auth.delete('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  // Delete user data across all tenant-scoped tables
  const tables = [
    'journal_lines', 'journal_entries', 'accounts', 'bank_transactions', 'bank_statements',
    'expense_receipts', 'file_records', 'invoices', 'invoice_items', 'customers', 'suppliers',
    'products', 'quotations', 'quotation_items', 'purchase_orders', 'purchase_order_items',
    'service_orders', 'service_order_items', 'chat_messages', 'chat_sessions',
    'calendar_events', 'messages', 'conversations', 'firm_client_assignments',
    'firm_clients', 'firm_members', 'api_tokens', 'compliance_log', 'member_compliance',
    'compliance_dates', 'company_settings', 'subscriptions', 'audit_log', 'fixed_assets',
    'closed_periods', 'bank_reconciliations', 'website_versions',
  ];
  for (const table of tables) {
    await db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(user.id).run();
  }

  // Delete the user record itself
  await db.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();

  // Clear auth cookie
  c.header('Set-Cookie', 'token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return c.json({ success: true });
});

// Full data export (GDPR right to data portability)
auth.get('/export-my-data', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const exportData: Record<string, any> = { user };

  // Export all user data from each table
  const tables = [
    'accounts', 'journal_entries', 'journal_lines', 'bank_statements', 'bank_transactions',
    'expense_receipts', 'file_records', 'invoices', 'invoice_items', 'customers', 'suppliers',
    'products', 'quotations', 'quotation_items', 'chat_sessions', 'chat_messages',
    'calendar_events', 'fixed_assets', 'company_settings',
  ];
  for (const table of tables) {
    try {
      const rows = await db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).bind(user.id).all();
      exportData[table] = rows.results;
    } catch { exportData[table] = []; }
  }

  c.header('Content-Type', 'application/json');
  c.header('Content-Disposition', 'attachment; filename=opcc-data-export.json');
  return c.json(exportData);
});

export { auth as authRoutes };
