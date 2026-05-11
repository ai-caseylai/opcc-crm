import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { Bindings, Variables, AppContext, AppNext } from '../types';
import { authMiddleware } from '../middleware/auth';
import { hash } from 'bcryptjs';
import { verify as jwtVerify } from 'jsonwebtoken';

const workbuddy = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function tokenAuth(c: AppContext, next: AppNext) {
  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) return c.json({ error: 'API token required' }, 401);
  const token = header.slice(7);
  const hash = createHash('sha256').update(token).digest('hex');
  const row = await c.env.DB.prepare(
    'SELECT t.*, u.id as user_id, u.email, u.name, u.role FROM api_tokens t JOIN users u ON t.user_id = u.id WHERE t.token_hash = ? AND t.is_active = 1'
  ).bind(hash).first<{ user_id: string; email: string; name: string; role: string; scopes: string }>();
  if (!row) return c.json({ error: 'Invalid or expired token' }, 401);
  await c.env.DB.prepare('UPDATE api_tokens SET last_used_at = datetime(\'now\') WHERE token_hash = ?').bind(hash).run();
  c.set('user', { id: row.user_id, email: row.email, name: row.name, role: row.role, scopes: row.scopes });
  await next();
}

workbuddy.get('/manifest', (c) => {
  return c.json({
    name: 'opcc-crm', version: '1.0.0',
    description: 'OPCC CRM — Customer Relationship Management with Invoicing & Bookkeeping',
    base_url: 'https://opcc-crm.techforliving.net/api/workbuddy',
    skills: [
      { name: 'list_customers', description: 'List/search customers', endpoint: '/customers', method: 'GET', parameters: { q: 'search query', page: 'page number' } },
      { name: 'create_customer', description: 'Create customer', endpoint: '/customers', method: 'POST', parameters: { name: 'Name *', email: 'Email', phone: 'Phone', address: 'Address', company_name: 'Company' } },
      { name: 'list_suppliers', description: 'List suppliers', endpoint: '/suppliers', method: 'GET', parameters: { q: 'search query' } },
      { name: 'create_supplier', description: 'Create supplier', endpoint: '/suppliers', method: 'POST', parameters: { name: 'Name *', email: 'Email', phone: 'Phone' } },
      { name: 'list_products', description: 'List products/services', endpoint: '/products', method: 'GET', parameters: { q: 'search query' } },
      { name: 'create_product', description: 'Create product', endpoint: '/products', method: 'POST', parameters: { name: 'Name *', unit_price: 'Price *', currency: 'HKD/USD/CNY' } },
      { name: 'list_invoices', description: 'List invoices with status filter', endpoint: '/invoices', method: 'GET', parameters: { status: 'draft/sent/paid/overdue', q: 'search' } },
      { name: 'create_invoice', description: 'Create invoice with line items', endpoint: '/invoices', method: 'POST', parameters: { invoice_number: '# *', customer_id: 'ID *', items: '[{description,quantity,unit_price,amount}]', due_date: 'Due date' } },
      { name: 'update_invoice_status', description: 'Update invoice status', endpoint: '/invoices/:id/status', method: 'PATCH', parameters: { status: 'draft/sent/paid/overdue' } },
      { name: 'list_quotations', description: 'List quotations', endpoint: '/quotations', method: 'GET', parameters: { status: 'draft/sent/accepted/rejected' } },
      { name: 'create_quotation', description: 'Create quotation', endpoint: '/quotations', method: 'POST', parameters: { quotation_number: '# *', customer_id: 'ID *', items: '[{description,quantity,unit_price,amount}]', valid_until: 'Date' } },
      { name: 'convert_quotation', description: 'Convert quotation to invoice', endpoint: '/quotations/:id/convert', method: 'POST' },
      { name: 'generate_pdf', description: 'Download invoice/quotation PDF (public)', endpoint: '/pdf/:type/:id', method: 'GET', parameters: { type: 'invoice or quotation', id: 'Document ID' } },
      { name: 'list_todos', description: 'List todo items', endpoint: '/todos', method: 'GET', parameters: { status: 'pending/completed' } },
      { name: 'create_todo', description: 'Create todo item', endpoint: '/todos', method: 'POST', parameters: { title: 'Title *', priority: 'high/medium/low', due_date: 'YYYY-MM-DD' } },
      { name: 'update_todo', description: 'Update todo (complete, edit)', endpoint: '/todos/:id', method: 'PATCH', parameters: { status: 'completed', title: 'New title' } },
      { name: 'list_bank_statements', description: 'List bank statements', endpoint: '/bank-statements', method: 'GET', parameters: { year: 'YYYY' } },
      { name: 'upload_bank_statement', description: 'Upload bank statement (base64)', endpoint: '/bank-statements/upload', method: 'POST', parameters: { file_data: 'Base64 *', bank_name: 'Bank', statement_year: 'YYYY', statement_month: 'MM' } },
      { name: 'list_expense_receipts', description: 'List expense receipts', endpoint: '/expense-receipts', method: 'GET', parameters: { year: 'YYYY', category: '餐飲/交通/...' } },
      { name: 'upload_expense_receipt', description: 'Upload expense receipt (base64)', endpoint: '/expense-receipts/upload', method: 'POST', parameters: { file_data: 'Base64 *', vendor_name: 'Vendor', amount: 'Amount', expense_date: 'YYYY-MM-DD', category: 'Category' } },
      { name: 'list_documents', description: 'List BR/CI documents', endpoint: '/documents', method: 'GET', parameters: { type: 'br or ci' } },
      { name: 'upload_document', description: 'Upload BR/CI document (base64)', endpoint: '/documents/upload', method: 'POST', parameters: { doc_type: 'br or ci *', doc_year: 'YYYY', file_data: 'Base64 *' } },
      { name: 'import_invoices_csv', description: 'Import invoices from CSV', endpoint: '/import/invoices', method: 'POST', parameters: { data: 'Array of invoice rows' } },
      { name: 'import_quotations_csv', description: 'Import quotations from CSV', endpoint: '/import/quotations', method: 'POST', parameters: { data: 'Array of quotation rows' } },
      { name: 'import_customers_csv', description: 'Import customers from CSV', endpoint: '/import/customers', method: 'POST', parameters: { data: 'Array of customer rows' } },
      { name: 'import_products_csv', description: 'Import products from CSV', endpoint: '/import/products', method: 'POST', parameters: { data: 'Array of product rows' } },
      { name: 'trial_balance', description: 'Get trial balance', endpoint: '/bookkeeping/trial-balance', method: 'GET', parameters: { as_of: 'YYYY-MM-DD' } },
      { name: 'income_statement', description: 'Get P&L statement', endpoint: '/bookkeeping/income-statement', method: 'GET', parameters: { start_date: 'Start', end_date: 'End' } },
      { name: 'export_bookkeeping', description: 'Export bookkeeping (CSV for auditor)', endpoint: '/bookkeeping/export', method: 'GET', parameters: { format: 'csv', start_date: 'Start', end_date: 'End' } },
      { name: 'list_calendar', description: 'List calendar events', endpoint: '/calendar/events', method: 'GET', parameters: { start: 'Start date', end: 'End date' } },
      { name: 'create_event', description: 'Create calendar event', endpoint: '/calendar/events', method: 'POST', parameters: { title: 'Title *', start_time: 'ISO datetime *', customer_id: 'Optional' } },
      { name: 'list_services', description: 'List services', endpoint: '/services', method: 'GET' },
      { name: 'create_service', description: 'Create service', endpoint: '/services', method: 'POST', parameters: { name: 'Name *', price: 'Price', duration_minutes: 'Duration', category: 'Category' } },
      { name: 'list_bookings', description: 'List service bookings', endpoint: '/services/bookings', method: 'GET', parameters: { date: 'YYYY-MM-DD' } },
      { name: 'create_booking', description: 'Create service booking', endpoint: '/services/bookings', method: 'POST', parameters: { service_id: '*', customer_id: '*', booking_date: '*', start_time: '*' } },
      { name: 'list_conversations', description: 'List message conversations', endpoint: '/messaging/conversations', method: 'GET', parameters: { channel: 'telegram/whatsapp' } },
      { name: 'send_message', description: 'Send reply in conversation', endpoint: '/messaging/send', method: 'POST', parameters: { conversation_id: 'ID *', content: 'Text *' } },
      { name: 'ai_chat', description: 'AI chatbot — ask about CRM data (Llama 3.1 with D1 function calling)', endpoint: '/chat', method: 'POST', parameters: { message: 'Question *', history: 'Chat history array' } },
      { name: 'company_profile', description: 'Get/update company profile', endpoint: '/company', method: 'GET/PUT', parameters: { name: 'Company name', features: 'JSON module toggles' } },
      { name: 'admin_onboard', description: 'One-click onboard new tenant (user + domain + DNS + Pages)', endpoint: '/admin/onboard', method: 'POST', parameters: { domain: 'Domain *', company_name: 'Company *', email: 'Admin email *', password: 'Password *' } },
      { name: 'admin_list_tenants', description: 'List all tenants with stats', endpoint: '/admin/users', method: 'GET' },
      { name: 'tenant_export', description: 'Export all tenant data as JSON/CSV', endpoint: '/admin/tenants/:id/export', method: 'GET', parameters: { format: 'json or csv', table: 'optional table name' } },
      { name: 'tenant_summary', description: 'Get tenant data counts', endpoint: '/admin/tenants/:id/summary', method: 'GET' },
    ],
  });
});

workbuddy.get('/tokens', authMiddleware, async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT id, name, scopes, last_used_at, expires_at, is_active, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  return c.json({ data: rows.results });
});

workbuddy.post('/tokens', authMiddleware, zValidator('json', z.object({ name: z.string().min(1), scopes: z.string().optional() })), async (c) => {
  const user = c.get('user');
  const { name, scopes } = c.req.valid('json');
  const db = c.env.DB;
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const id = `tk-${uuidv4().slice(0, 8)}`;
  await db.prepare('INSERT INTO api_tokens (id, user_id, name, token_hash, scopes) VALUES (?, ?, ?, ?, ?)').bind(id, user.id, name, tokenHash, scopes || 'read').run();
  return c.json({ id, name, token, scopes: scopes || 'read', message: 'Save this token — it won\'t be shown again' }, 201);
});

workbuddy.delete('/tokens/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('UPDATE api_tokens SET is_active = 0 WHERE id = ? AND user_id = ?').bind(c.req.param('id'), user.id).run();
  return c.json({ success: true });
});

workbuddy.get('/customers', tokenAuth, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const search = c.req.query('q') || '';
  let query = 'SELECT * FROM customers WHERE user_id = ?';
  const params: any[] = [user.id];
  if (search) { query += ' AND (name LIKE ? OR company_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY name ASC LIMIT 50';
  const rows = await db.prepare(query).bind(...params).all();
  return c.json({ data: rows.results });
});

workbuddy.post('/customers', tokenAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const id = `c-${uuidv4().slice(0, 8)}`;
  await c.env.DB.prepare('INSERT INTO customers (id, user_id, name, company_name, email, phone) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, body.name, body.company_name || null, body.email || null, body.phone || null).run();
  const row = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

workbuddy.get('/suppliers', tokenAuth, async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare('SELECT * FROM suppliers WHERE user_id = ? AND is_active = 1 ORDER BY name ASC LIMIT 50').bind(user.id).all();
  return c.json({ data: rows.results });
});

workbuddy.get('/products', tokenAuth, async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare('SELECT * FROM products WHERE user_id = ? AND is_active = 1 ORDER BY name ASC LIMIT 100').bind(user.id).all();
  return c.json({ data: rows.results });
});

workbuddy.get('/invoices', tokenAuth, async (c) => {
  const user = c.get('user');
  const status = c.req.query('status');
  let query = 'SELECT * FROM invoices WHERE user_id = ?';
  const params: any[] = [user.id];
  if (status) { query += ' AND status = ?'; params.push(status); }
  query += ' ORDER BY created_at DESC LIMIT 50';
  const rows = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: rows.results });
});

workbuddy.post('/invoices', tokenAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const id = `i-${uuidv4().slice(0, 8)}`;
  const items = body.items || [];
  const subtotal = items.reduce((s: number, i: any) => s + (i.amount || 0), 0);
  await c.env.DB.prepare(
    'INSERT INTO invoices (id, user_id, invoice_number, customer_id, issue_date, due_date, subtotal, total, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, body.invoice_number, body.customer_id, body.issue_date || new Date().toISOString().split('T')[0], body.due_date, subtotal, subtotal, body.currency || 'HKD').run();
  for (const item of items) {
    await c.env.DB.prepare(
      'INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(`ii-${uuidv4().slice(0, 8)}`, id, item.description, item.quantity || 1, item.unit_price || 0, item.amount || 0, 0).run();
  }
  const row = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

// ── One-click onboard — dual auth: JWT or API token ──
workbuddy.post('/admin/onboard', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return c.json({ error: 'Bearer token required' }, 401);
  const token = authHeader.slice(7);

  let role = '';
  // Try JWT first
  try {
    const payload = jwtVerify(token, c.env.JWT_SECRET || 'dev-secret-change-me') as { role: string };
    role = payload.role;
  } catch {
    // Fall back to API token (SHA256 hash)
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const tokenRow = await c.env.DB.prepare(
      'SELECT u.role FROM api_tokens t JOIN users u ON t.user_id = u.id WHERE t.token_hash = ? AND t.is_active = 1'
    ).bind(tokenHash).first<{ role: string }>();
    if (tokenRow) role = tokenRow.role;
  }
  // Third fallback: workbuddy_config API key (plain-text)
  if (!role) {
    const wbRow = await c.env.DB.prepare(
      'SELECT u.role FROM workbuddy_config wc JOIN users u ON wc.user_id = u.id WHERE wc.api_key = ? AND wc.enabled = 1'
    ).bind(token).first<{ role: string }>();
    if (wbRow) role = wbRow.role;
  }

  if (!role) return c.json({ error: 'Invalid or expired token' }, 401);
  if (role !== 'admin') return c.json({ error: 'Admin access required' }, 403);

  const body = await c.req.json();
  const { domain, company_name, email, password, name } = body;
  if (!domain || !company_name || !email || !password) {
    return c.json({ error: 'domain, company_name, email, password required' }, 400);
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

  // 3. Domain mapping
  const dmId = `dm-${uuidv4().slice(0, 8)}`;
  await db.prepare(
    'INSERT INTO domains (id, user_id, domain, is_primary) VALUES (?,?,?,1)'
  ).bind(dmId, userId, domain).run();
  steps.push('✅ 域名已映射');

  // 4. Cloudflare DNS + Pages
  const cfToken = c.env.CF_API_TOKEN || '';
  const accountId = '3498e268169ccb1bd1ad614210804529';
  const zoneId = 'b73df921b8b38bc1382883ca5a76b83e';

  if (cfToken) {
    try {
      const dnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'CNAME', name: domain.split('.')[0], content: 'oppc-crm.pages.dev', ttl: 1, proxied: true }),
      });
      const dnsJson: any = await dnsRes.json();
      if (dnsJson.success) steps.push('✅ DNS CNAME 已創建');
      else steps.push(`⚠️ DNS: ${dnsJson.errors?.[0]?.message || 'unknown'}`);
    } catch (e: any) { steps.push(`⚠️ DNS: ${e.message}`); }

    try {
      const pagesRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/oppc-crm/domains`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: domain }),
      });
      const pagesJson: any = await pagesRes.json();
      if (pagesJson.success) steps.push('✅ Pages 域名已添加');
      else steps.push(`⚠️ Pages: ${pagesJson.errors?.[0]?.message || 'unknown'}`);
    } catch (e: any) { steps.push(`⚠️ Pages: ${e.message}`); }
  } else {
    steps.push('ℹ️ CF_API_TOKEN 未設定，DNS/Pages 需手動');
  }

  return c.json({
    success: true,
    user: { id: userId, email, name: name || company_name, company: company_name },
    domain: `https://${domain}`,
    password,
    steps,
  }, 201);
});

export { workbuddy as workbuddyRoutes };
