import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { Bindings, Variables } from '../types';

const emailDash = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── GET /api/email-dash/status — check Cloudflare Email Routing status ──
emailDash.get('/status', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const company = await db.prepare(
    'SELECT website, email FROM company_settings WHERE user_id = ?'
  ).bind(user.id).first<{ website?: string; email?: string }>();

  const domain = company?.website
    ? new URL(company.website.startsWith('http') ? company.website : `https://${company.website}`).hostname
    : null;

  return c.json({
    configured: !!domain,
    domain: domain || null,
    email: company?.email || null,
    message: domain
      ? `Email Dash ready for ${domain}`
      : '設定公司網站域名後即可啟用 Email Dash',
    available_features: {
      email_routing: !!domain,
      email_worker: !!domain,
      catch_all: !!domain,
    },
  });
});

// ── GET /api/email-dash/routes — list email routing rules ──
emailDash.get('/routes', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const rows = await db.prepare(
    "SELECT id, user_id, channel_type, name, phone_number, webhook_url, is_active, metadata, created_at FROM channels WHERE user_id = ? AND channel_type = 'email' ORDER BY created_at"
  ).bind(user.id).all();

  const routes = (rows.results || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    email_address: r.webhook_url || r.phone_number,
    is_active: !!r.is_active,
    metadata: r.metadata ? JSON.parse(r.metadata) : {},
    created_at: r.created_at,
  }));

  return c.json({ routes });
});

// ── POST /api/email-dash/routes — create email routing rule ──
const routeSchema = z.object({
  name: z.string().min(1),
  email_address: z.string().email(),
  forward_to: z.string().email(),
});

emailDash.post('/routes', authMiddleware, zValidator('json', routeSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { name, email_address, forward_to } = c.req.valid('json');

  const id = crypto.randomUUID();
  const metadata = JSON.stringify({
    type: 'email_route',
    forward_to,
    source: 'opcc-email-dash',
  });

  await db.prepare(
    `INSERT INTO channels (id, user_id, channel_type, name, webhook_url, phone_number, is_active, metadata)
     VALUES (?, ?, 'email', ?, ?, ?, 1, ?)`
  ).bind(id, user.id, name, email_address, forward_to, metadata).run();

  return c.json({
    success: true,
    route: { id, name, email_address, forward_to },
    message: `Email route created: ${email_address} → ${forward_to}`,
  }, 201);
});

// ── DELETE /api/email-dash/routes/:id — delete email routing rule ──
emailDash.delete('/routes/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  await db.prepare(
    'DELETE FROM channels WHERE id = ? AND user_id = ? AND channel_type = ?'
  ).bind(c.req.param('id'), user.id, 'email').run();

  return c.json({ success: true });
});

// ── POST /api/email-dash/worker — simulate email worker config ──
const workerSchema = z.object({
  action: z.enum(['expense', 'todo', 'forward', 'archive']),
  match_pattern: z.string().optional(),
});

emailDash.post('/worker', authMiddleware, zValidator('json', workerSchema), async (c) => {
  const user = c.get('user');
  const { action, match_pattern } = c.req.valid('json');

  // Store email worker configuration in company_settings features
  const db = c.env.DB;
  const existing = await db.prepare(
    'SELECT features FROM company_settings WHERE user_id = ?'
  ).bind(user.id).first<{ features: string }>();

  const features = existing?.features ? JSON.parse(existing.features) : {};
  features.email_worker = { action, match_pattern: match_pattern || '*', enabled: true };

  await db.prepare(
    "UPDATE company_settings SET features = ?, updated_at = datetime('now') WHERE user_id = ?"
  ).bind(JSON.stringify(features), user.id).run();

  const actionLabels: Record<string, string> = {
    expense: '自動建立消費單據',
    todo: '自動建立待辦事項',
    forward: '轉寄到指定郵箱',
    archive: '歸檔儲存',
  };

  return c.json({
    success: true,
    config: { action, match_pattern: match_pattern || '*', enabled: true },
    message: `Email Worker 已設定：${actionLabels[action] || action}`,
  });
});

export { emailDash as emailDashRoutes };
