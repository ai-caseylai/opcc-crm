import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { Bindings, Variables } from '../types';

const mail = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Get mail config ──
async function getMailConfig(db: D1Database, userId: string) {
  const row = await db.prepare('SELECT base_url, jwt, site_password, address FROM mail_config WHERE user_id = ?')
    .bind(userId).first<{ base_url: string; jwt: string; site_password: string; address: string }>();
  if (!row) return null;
  return { base: row.base_url, jwt: row.jwt, sp: row.site_password, address: row.address };
}

// ── Helper: call temp-mail API ──
async function mailFetch(cfg: { base: string; jwt: string; sp: string }, path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${cfg.jwt}`,
    ...(init.headers as Record<string, string> || {}),
  };
  if (cfg.sp) headers['x-custom-auth'] = cfg.sp;
  const res = await fetch(`${cfg.base}${path}`, { ...init, headers });
  return res;
}

// ── Config management ──
mail.get('/config', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const row = await c.env.DB.prepare('SELECT base_url, jwt, address, updated_at FROM mail_config WHERE user_id = ?')
    .bind(tenantId).first();
  if (!row) return c.json({ configured: false });
  // Validate JWT
  try {
    const cfg = await getMailConfig(c.env.DB, tenantId);
    if (!cfg) return c.json({ configured: false });
    const res = await mailFetch(cfg, '/api/settings');
    if (res.ok) {
      const info: any = await res.json();
      return c.json({ configured: true, address: info.address, base_url: cfg.base });
    }
    return c.json({ configured: true, error: 'JWT invalid or expired', address: cfg.address, base_url: cfg.base });
  } catch {
    return c.json({ configured: true, error: 'Cannot reach server', base_url: (row as any).base_url });
  }
});

mail.put('/config', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();
  const { base_url, jwt, site_password } = body;
  if (!base_url || !jwt) return c.json({ error: 'base_url and jwt required' }, 400);

  const existing = await db.prepare('SELECT user_id FROM mail_config WHERE user_id = ?').bind(tenantId).first();
  if (existing) {
    await db.prepare("UPDATE mail_config SET base_url=?, jwt=?, site_password=?, updated_at=datetime('now') WHERE user_id=?")
      .bind(base_url, jwt, site_password || null, tenantId).run();
  } else {
    await db.prepare('INSERT INTO mail_config (user_id, base_url, jwt, site_password) VALUES (?,?,?,?)')
      .bind(tenantId, base_url, jwt, site_password || null).run();
  }

  // Fetch address info
  try {
    const res = await mailFetch({ base: base_url, jwt, sp: site_password || '' }, '/api/settings');
    if (res.ok) {
      const info: any = await res.json();
      await db.prepare("UPDATE mail_config SET address=?, updated_at=datetime('now') WHERE user_id=?")
        .bind(info.address, tenantId).run();
      return c.json({ configured: true, address: info.address });
    }
  } catch { /* will retry later */ }

  return c.json({ configured: true });
});

mail.delete('/config', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  await c.env.DB.prepare('DELETE FROM mail_config WHERE user_id = ?').bind(tenantId).run();
  return c.json({ success: true });
});

// ── Inbox ──
mail.get('/inbox', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const cfg = await getMailConfig(c.env.DB, tenantId);
  if (!cfg) return c.json({ error: 'Mail not configured' }, 400);

  const limit = c.req.query('limit') || '20';
  const offset = c.req.query('offset') || '0';
  try {
    const res = await mailFetch(cfg, `/api/parsed_mails?limit=${limit}&offset=${offset}`);
    if (!res.ok) return c.json({ error: `Upstream error: ${res.status}` }, 502);
    return c.json(await res.json());
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

mail.get('/inbox/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const cfg = await getMailConfig(c.env.DB, tenantId);
  if (!cfg) return c.json({ error: 'Mail not configured' }, 400);

  try {
    const res = await mailFetch(cfg, `/api/parsed_mail/${c.req.param('id')}`);
    if (!res.ok) return c.json({ error: `Upstream error: ${res.status}` }, 502);
    return c.json(await res.json());
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

// ── Send ──
mail.post('/send', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const cfg = await getMailConfig(c.env.DB, tenantId);
  if (!cfg) return c.json({ error: 'Mail not configured' }, 400);

  const body = await c.req.json();
  try {
    const res = await mailFetch(cfg, '/api/send_mail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return c.json({ error: err.message || `Send failed: ${res.status}` }, 502);
    }
    return c.json(await res.json());
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

// ── Address info ──
mail.get('/settings', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const cfg = await getMailConfig(c.env.DB, tenantId);
  if (!cfg) return c.json({ error: 'Mail not configured' }, 400);

  try {
    const res = await mailFetch(cfg, '/api/settings');
    if (!res.ok) return c.json({ error: `Upstream error: ${res.status}` }, 502);
    return c.json(await res.json());
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

export { mail as mailRoutes };
