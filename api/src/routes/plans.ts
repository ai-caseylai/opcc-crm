import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { Bindings, Variables } from '../types';

const plans = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── GET /api/plans — public: list all active plans ──
plans.get('/', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    'SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order'
  ).all();
  const result = (rows.results || []).map((p: any) => ({
    ...p,
    skill_allowlist: JSON.parse(p.skill_allowlist || '[]'),
    limits: JSON.parse(p.limits || '{}'),
    features: JSON.parse(p.features || '[]'),
  }));
  return c.json({ plans: result });
});

// ── GET /api/plans/:key — public: single plan detail ──
plans.get('/:key', async (c) => {
  const db = c.env.DB;
  const row = await db.prepare(
    'SELECT * FROM plans WHERE plan_key = ? AND is_active = 1'
  ).bind(c.req.param('key')).first<any>();
  if (!row) return c.json({ error: 'Plan not found' }, 404);
  return c.json({
    ...row,
    skill_allowlist: JSON.parse(row.skill_allowlist || '[]'),
    limits: JSON.parse(row.limits || '{}'),
    features: JSON.parse(row.features || '[]'),
  });
});

// ── GET /api/subscription — authenticated: current subscription + plan ──
plans.get('/subscription', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const sub = await db.prepare(
    `SELECT s.*, p.plan_key, p.name_zh, p.name_en, p.monthly_price, p.skill_allowlist, p.limits, p.features
     FROM subscriptions s JOIN plans p ON s.plan_id = p.id
     WHERE s.user_id = ? AND s.status = 'active'
     ORDER BY s.created_at DESC LIMIT 1`
  ).bind(user.id).first<any>();

  if (!sub) {
    // Default: auto-assign starter plan
    const starter = await db.prepare(
      "SELECT * FROM plans WHERE plan_key = 'starter' AND is_active = 1"
    ).first<any>();
    if (starter) {
      const subId = crypto.randomUUID();
      await db.prepare(
        "INSERT INTO subscriptions (id, user_id, plan_id, status) VALUES (?, ?, ?, 'active')"
      ).bind(subId, user.id, starter.id).run();
      return c.json({
        subscription: {
          id: subId, user_id: user.id, plan_id: starter.id, status: 'active',
          started_at: new Date().toISOString(),
          plan_key: starter.plan_key, name_zh: starter.name_zh, name_en: starter.name_en,
          monthly_price: starter.monthly_price,
          skill_allowlist: JSON.parse(starter.skill_allowlist || '[]'),
          limits: JSON.parse(starter.limits || '{}'),
          features: JSON.parse(starter.features || '[]'),
        },
      });
    }
    return c.json({ subscription: null, message: 'No plans available' });
  }

  return c.json({
    subscription: {
      ...sub,
      skill_allowlist: JSON.parse(sub.skill_allowlist || '[]'),
      limits: JSON.parse(sub.limits || '{}'),
      features: JSON.parse(sub.features || '[]'),
    },
  });
});

// ── POST /api/subscription — authenticated: change plan ──
const changeSchema = z.object({
  plan_key: z.enum(['starter', 'growth', 'business', 'enterprise']),
});

plans.post('/subscription', authMiddleware, zValidator('json', changeSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { plan_key } = c.req.valid('json');

  const plan = await db.prepare(
    'SELECT id FROM plans WHERE plan_key = ? AND is_active = 1'
  ).bind(plan_key).first<any>();
  if (!plan) return c.json({ error: 'Invalid plan' }, 400);

  // Cancel existing active subscription
  await db.prepare(
    "UPDATE subscriptions SET status = 'cancelled', updated_at = datetime('now') WHERE user_id = ? AND status = 'active'"
  ).bind(user.id).run();

  // Create new subscription
  const subId = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO subscriptions (id, user_id, plan_id, status) VALUES (?, ?, ?, 'active')"
  ).bind(subId, user.id, plan.id).run();

  return c.json({ success: true, plan_key, subscription_id: subId });
});

// ── GET /api/subscription/skills — available skills for current plan ──
plans.get('/subscription/skills', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const sub = await db.prepare(
    `SELECT p.skill_allowlist FROM subscriptions s
     JOIN plans p ON s.plan_id = p.id
     WHERE s.user_id = ? AND s.status = 'active'
     ORDER BY s.created_at DESC LIMIT 1`
  ).bind(user.id).first<any>();

  const skills = sub ? JSON.parse(sub.skill_allowlist || '[]') : [];
  return c.json({ skills });
});

// ── GET /api/subscription/usage — current usage vs limits ──
plans.get('/subscription/usage', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const sub = await db.prepare(
    `SELECT p.limits, p.plan_key FROM subscriptions s
     JOIN plans p ON s.plan_id = p.id
     WHERE s.user_id = ? AND s.status = 'active'
     ORDER BY s.created_at DESC LIMIT 1`
  ).bind(user.id).first<any>();

  const limits = sub ? JSON.parse(sub.limits || '{}') : {};

  // Count current month invoices
  const invoiceCount = await db.prepare(
    "SELECT COUNT(*) as cnt FROM invoices WHERE user_id = ? AND created_at >= date('now','start of month')"
  ).bind(user.id).first<{ cnt: number }>();

  // Count current month quotations
  const quotationCount = await db.prepare(
    "SELECT COUNT(*) as cnt FROM quotations WHERE user_id = ? AND created_at >= date('now','start of month')"
  ).bind(user.id).first<{ cnt: number }>();

  // Count API tokens
  const tokenCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM api_tokens WHERE user_id = ? AND is_active = 1'
  ).bind(user.id).first<{ cnt: number }>();

  // Estimate storage (sum of file sizes)
  const storage = await db.prepare(
    'SELECT COALESCE(SUM(file_size), 0) as total FROM file_records WHERE user_id = ?'
  ).bind(user.id).first<{ total: number }>();

  return c.json({
    usage: {
      invoices_this_month: invoiceCount?.cnt || 0,
      invoices_limit: limits.invoices_per_month,
      quotations_this_month: quotationCount?.cnt || 0,
      quotations_limit: limits.quotations_per_month,
      storage_bytes: storage?.total || 0,
      storage_gb_limit: limits.storage_gb,
      api_tokens: tokenCount?.cnt || 0,
      api_tokens_limit: limits.api_tokens,
      users_limit: limits.users,
    },
    plan_key: sub?.plan_key || 'starter',
  });
});

export { plans as plansRoutes };
