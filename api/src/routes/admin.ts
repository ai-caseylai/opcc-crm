import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { hash } from 'bcryptjs';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>();
admin.use('*', authMiddleware);

// ── List all users with stats (admin only) ──
admin.get('/users', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);

  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT u.id, u.email, u.name, u.company_name, u.role, u.created_at,
            (SELECT COUNT(*) FROM customers WHERE user_id = u.id) as customer_count,
            (SELECT COUNT(*) FROM invoices WHERE user_id = u.id) as invoice_count,
            (SELECT COUNT(*) FROM quotations WHERE user_id = u.id) as quotation_count,
            (SELECT d.domain FROM domains d WHERE d.user_id = u.id AND d.is_primary = 1) as primary_domain
     FROM users u ORDER BY u.created_at DESC`
  ).all();
  return c.json({ data: rows.results });
});

// ── Domain management ──
admin.get('/domains', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);

  const rows = await c.env.DB.prepare(
    'SELECT d.*, u.name as user_name, u.email as user_email FROM domains d JOIN users u ON d.user_id = u.id ORDER BY d.domain'
  ).all();
  return c.json({ data: rows.results });
});

admin.post('/domains', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);

  const body = await c.req.json();
  const db = c.env.DB;
  const id = `dm-${crypto.randomUUID().slice(0, 8)}`;

  await db.prepare(
    'INSERT OR REPLACE INTO domains (id, user_id, domain, is_primary) VALUES (?, ?, ?, ?)'
  ).bind(id, body.user_id, body.domain, body.is_primary || 0).run();

  return c.json({ id, domain: body.domain, user_id: body.user_id }, 201);
});

admin.delete('/domains/:id', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);

  await c.env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

// ── One-click onboard: create user + domain + DNS + Pages ──
admin.post('/onboard', async (c) => {
  const adminUser = c.get('user');
  if (adminUser.role !== 'admin') return c.json({ error: 'Admin only' }, 403);

  const body = await c.req.json();
  const { domain, company_name, email, password, name } = body;
  if (!domain || !company_name || !email || !password) {
    return c.json({ error: 'Missing required fields: domain, company_name, email, password' }, 400);
  }
  const db = c.env.DB;
  const steps: string[] = [];

  // 1. Create user
  const userId = `u-${uuidv4().slice(0, 8)}`;
  const passwordHash = await hash(password, 10);
  await db.prepare(
    'INSERT INTO users (id, email, password_hash, name, company_name, role) VALUES (?,?,?,?,?,?)'
  ).bind(userId, email, passwordHash, name || company_name, company_name, 'admin').run();
  steps.push('✅ 用戶已創建');

  // 2. Create company_settings  
  await db.prepare(
    `INSERT OR REPLACE INTO company_settings (user_id, name, email, website, address)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(userId, company_name, email, `https://${domain}`, 'Hong Kong').run();
  steps.push('✅ 公司資料已設定');

  // 3. Insert domain mapping
  const dmId = `dm-${uuidv4().slice(0, 8)}`;
  await db.prepare(
    'INSERT INTO domains (id, user_id, domain, is_primary) VALUES (?,?,?,1)'
  ).bind(dmId, userId, domain).run();
  steps.push('✅ 域名已映射');

  // 4. Try Cloudflare API: DNS + Pages domain
  const cfToken = c.env.CF_API_TOKEN || '';
  const accountId = c.env.CF_ACCOUNT_ID || '';
  const zoneId = c.env.CF_ZONE_ID || '';

  if (cfToken) {
    // DNS CNAME
    try {
      const dnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'CNAME', name: domain.split('.')[0], content: 'oppc-crm.pages.dev', ttl: 1, proxied: true }),
      });
      const dnsJson: any = await dnsRes.json();
      if (dnsJson.success) steps.push('✅ DNS CNAME 已創建');
      else steps.push(`⚠️ DNS: ${dnsJson.errors?.[0]?.message || 'unknown error'}`);
    } catch (e: any) { steps.push(`⚠️ DNS failed: ${e.message}`); }

    // Pages domain
    try {
      const pagesRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/oppc-crm/domains`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: domain }),
      });
      const pagesJson: any = await pagesRes.json();
      if (pagesJson.success) steps.push('✅ Pages 域名已添加');
      else steps.push(`⚠️ Pages: ${pagesJson.errors?.[0]?.message || 'unknown error'}`);
    } catch (e: any) { steps.push(`⚠️ Pages failed: ${e.message}`); }
  } else {
    steps.push('ℹ️ 未設定 CF_API_TOKEN，DNS/Pages 需手動添加');
  }

  return c.json({
    success: true,
    user: { id: userId, email, name: name || company_name, company: company_name },
    domain: `https://${domain}`,
    password,
    steps,
  }, 201);
});

// ── Tenant data export (JSON package) ──
admin.get('/tenants/:userId/export', async (c) => {
  const adminUser = c.get('user');
  if (adminUser.role !== 'admin') return c.json({ error: 'Admin only' }, 403);

  const targetUserId = c.req.param('userId');
  const format = c.req.query('format') || 'json';
  const db = c.env.DB;

  // All user-scoped tables
  const tables = [
    'company_settings',
    'customers',
    'suppliers',
    'products',
    { name: 'invoices', children: 'invoice_items' },
    { name: 'quotations', children: 'quotation_items' },
    { name: 'journal_entries', children: 'journal_lines' },
    'accounts',
    'audit_log',
    'api_tokens',
    'workbuddy_config',
    'domains',
    'calendar_events',
    { name: 'services', children: 'service_bookings' },
    { name: 'conversations', children: 'messages' },
    'channels',
    'message_templates',
    'webhook_events',
    'wuzapi_sessions',
    'documents',
  ];

  const result: Record<string, any> = {
    exported_at: new Date().toISOString(),
    user_id: targetUserId,
  };

  // Get user info
  const userRow = await db.prepare(
    'SELECT id, email, name, company_name, role, created_at FROM users WHERE id = ?'
  ).bind(targetUserId).first();
  if (!userRow) return c.json({ error: 'User not found' }, 404);
  result.user = userRow;

  // Export each table
  for (const table of tables) {
    const tableName = typeof table === 'string' ? table : table.name;
    try {
      const rows = await db.prepare(
        `SELECT * FROM ${tableName} WHERE user_id = ?`
      ).bind(targetUserId).all();
      const data = rows.results as any[];

      // For tables with children, also export child rows
      if (typeof table !== 'string' && table.children && data.length > 0) {
        const childTable = table.children;
        const parentIds = data.map((r: any) => r.id);
        const parentIdCol = tableName === 'invoices' ? 'invoice_id'
          : tableName === 'quotations' ? 'quotation_id'
          : tableName === 'journal_entries' ? 'entry_id'
          : tableName === 'services' ? 'service_id'
          : 'conversation_id';

        try {
          const childRows = await db.prepare(
            `SELECT * FROM ${childTable} WHERE ${parentIdCol} IN (${parentIds.map(() => '?').join(',')})`
          ).bind(...parentIds).all();
          result[childTable] = childRows.results;
        } catch { /* child table may not exist yet */ }
      }

      result[tableName] = data;
    } catch { /* table may not exist yet for this schema version */ }
  }

  // CSV download for single table
  if (format === 'csv') {
    const targetTable = c.req.query('table');
    if (!targetTable || !result[targetTable]) {
      return c.json({ error: 'Specify ?table=xxx for CSV export' }, 400);
    }
    const rows = result[targetTable];
    if (!Array.isArray(rows) || rows.length === 0) {
      return c.text('No data', 200, { 'Content-Type': 'text/csv' });
    }
    const headers = Object.keys(rows[0]);
    let csv = headers.join(',') + '\n';
    for (const row of rows) {
      csv += headers.map(h => {
        const val = String(row[h] ?? '');
        return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(',') + '\n';
    }
    return c.text(csv, 200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${targetUserId}_${targetTable}.csv"`,
    });
  }

  // Full JSON download
  return c.json(result, 200, {
    'Content-Disposition': `attachment; filename="${targetUserId}_export.json"`,
  });
});

// ── Tenant data summary ──
admin.get('/tenants/:userId/summary', async (c) => {
  const adminUser = c.get('user');
  if (adminUser.role !== 'admin') return c.json({ error: 'Admin only' }, 403);

  const targetUserId = c.req.param('userId');
  const db = c.env.DB;

  const userRow = await db.prepare(
    'SELECT id, email, name, company_name, role, created_at FROM users WHERE id = ?'
  ).bind(targetUserId).first();
  if (!userRow) return c.json({ error: 'User not found' }, 404);

  const counts: Record<string, number> = {};
  const countTables = ['customers','suppliers','products','invoices','quotations',
    'journal_entries','calendar_events','services','service_bookings',
    'conversations','messages','domains','documents'];
  for (const t of countTables) {
    try {
      const r = await db.prepare(`SELECT COUNT(*) as cnt FROM ${t} WHERE user_id = ?`)
        .bind(targetUserId).first<{cnt:number}>();
      counts[t] = r?.cnt || 0;
    } catch { counts[t] = 0; }
  }

  return c.json({ user: userRow, counts });
});

export { admin as adminRoutes };
