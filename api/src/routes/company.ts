import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { verify as jwtVerify } from 'jsonwebtoken';
import { Bindings, Variables } from '../types';

// Default company config — used as fallback when no DB row exists
const DEFAULT_COMPANY = {
  name: 'OPCC',
  legal_name: 'OPCC Company Limited',
  short_name: 'OPCC',
  tagline: 'One Person Company Club',
  address: 'Hong Kong',
  phone: '',
  email: 'hello@opcc-crm.techforliving.net',
  website: 'https://opcc-crm.techforliving.net',
  tax_id: '',
  logo_url: '',
  bank_name: 'HSBC Hong Kong',
  bank_account: '',
  bank_swift: 'HSBCHKHHHKH',
  bank_address: "1 Queen's Road Central, Hong Kong",
  signatory_name: '',
  features: '{"customers":true,"suppliers":true,"products":true,"services":true,"invoices":true,"quotations":true,"bookkeeping":true,"bankStatements":true,"expenseReceipts":true,"calendar":true,"messages":true,"documents":true,"fileStorage":true,"purchaseOrders":true,"serviceOrders":true,"compliance":true}',
  br_number: '',
  br_expiry_date: '',
  ci_number: '',
  industry: 'general',
  employee_count: '0',
  fiscal_year_end: '03-31',
  secretary_name: '',
  secretary_contact: '',
  auditor_name: '',
  auditor_contact: '',
};

// Available modules with their config keys
const FEATURE_MODULES: Record<string, string[]> = {
  products: ['products'],
  services: ['services'],
  invoices: ['invoices'],
  quotations: ['quotations'],
  bookkeeping: ['bookkeeping'],
  calendar: ['calendar'],
  messages: ['messages'],
  documents: ['documents'],
  compliance: ['compliance'],
};

const company = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── GET: read company profile (authenticated user first, then first row, then defaults) ──
company.get('/', async (c) => {
  const db = c.env.DB;
  let targetUserId: string | null = null;

  // Try JWT auth to get current user
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwtVerify(auth.slice(7), c.env.JWT_SECRET || 'dev-secret-change-me') as { id: string };
      targetUserId = payload.id;
    } catch { /* not authenticated — fall through */ }
  }

  const row = targetUserId
    ? await db.prepare('SELECT * FROM company_settings WHERE user_id = ?').bind(targetUserId).first<Record<string, string>>()
    : await db.prepare('SELECT * FROM company_settings LIMIT 1').first<Record<string, string>>();

  if (!row) return c.json(DEFAULT_COMPANY);

  // Merge DB values over defaults (DB wins when not null/empty)
  const merged: Record<string, string> = { ...DEFAULT_COMPANY };
  for (const [k, v] of Object.entries(row)) {
    if (v !== null && v !== undefined && v !== '') merged[k] = v;
  }
  // Parse features JSON string → object for frontend
  try { merged.features = JSON.parse(merged.features || DEFAULT_COMPANY.features); } catch { merged.features = DEFAULT_COMPANY.features; }
  return c.json(merged);
});

// ── PUT: update company profile (authenticated) ──
const updateSchema = z.object({
  name: z.string().optional(), address: z.string().optional(), address2: z.string().optional(),
  phone: z.string().optional(), email: z.string().optional(), website: z.string().optional(),
  bank_name: z.string().optional(), bank_account: z.string().optional(),
  bank_swift: z.string().optional(), bank_address: z.string().optional(),
  signatory_name: z.string().optional(), tax_id: z.string().optional(),
  legal_name: z.string().optional(), short_name: z.string().optional(), tagline: z.string().optional(),
  features: z.string().optional(), // JSON string: {"products":true,...}
  invoice_number_pattern: z.string().optional(),
  // Compliance fields
  br_number: z.string().optional(), br_expiry_date: z.string().optional(),
  ci_number: z.string().optional(), industry: z.string().optional(),
  employee_count: z.union([z.string(), z.number()]).optional(),
  fiscal_year_end: z.string().optional(),
  secretary_name: z.string().optional(), secretary_contact: z.string().optional(),
  auditor_name: z.string().optional(), auditor_contact: z.string().optional(),
});

company.put('/', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const data = c.req.valid('json');

  const existing = await db.prepare('SELECT user_id FROM company_settings WHERE user_id = ?').bind(user.id).first();
  if (existing) {
    const sets: string[] = []; const params: any[] = [];
    for (const [k, v] of Object.entries(data)) { sets.push(`${k} = ?`); params.push(v); }
    sets.push("updated_at = datetime('now')");
    params.push(user.id);
    await db.prepare(`UPDATE company_settings SET ${sets.join(', ')} WHERE user_id = ?`).bind(...params).run();
  } else {
    await db.prepare(
      `INSERT INTO company_settings (user_id, name, legal_name, short_name, tagline, address, address2, phone, email, website, bank_name, bank_account, bank_swift, bank_address, signatory_name, tax_id, invoice_number_pattern, br_number, br_expiry_date, ci_number, industry, employee_count, fiscal_year_end, secretary_name, secretary_contact, auditor_name, auditor_contact)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(user.id, data.name || 'OPCC', data.legal_name || null, data.short_name || null,
      data.tagline || null, data.address || 'Hong Kong', data.address2 || null,
      data.phone || null, data.email || null, data.website || null, data.bank_name || null,
      data.bank_account || null, data.bank_swift || null, data.bank_address || null,
      data.signatory_name || null, data.tax_id || null, data.invoice_number_pattern || null,
      data.br_number || null, data.br_expiry_date || null, data.ci_number || null,
      data.industry || 'general', String(data.employee_count || 0), data.fiscal_year_end || '03-31',
      data.secretary_name || null, data.secretary_contact || null,
      data.auditor_name || null, data.auditor_contact || null).run();
  }
  const row = await db.prepare('SELECT * FROM company_settings WHERE user_id = ?').bind(user.id).first();
  return c.json(row);
});

// ── POST: upload logo (base64) ──
company.post('/logo', authMiddleware, zValidator('json', z.object({ image: z.string().min(1) })), async (c) => {
  const { image } = c.req.valid('json');
  const db = c.env.DB;
  if (!image.startsWith('data:image/png') && !image.startsWith('iVBOR')) return c.json({ error: 'Must be base64 PNG' }, 400);
  const base64 = image.replace(/^data:image\/\w+;base64,/, '');
  const logoUrl = `data:image/png;base64,${base64}`;
  await db.prepare("UPDATE company_settings SET logo_url = ?, updated_at = datetime('now') WHERE user_id = ?")
    .bind(logoUrl, c.get('user').id).run();
  return c.json({ logo_url: logoUrl });
});

// ── POST: upload PDF images to R2 (logo, chop, stamp) ──
const pdfImageSchema = z.object({ image: z.string().min(1) });

company.post('/pdf-logo', authMiddleware, zValidator('json', pdfImageSchema), async (c) => {
  const { image } = c.req.valid('json');
  const user = c.get('user');
  const base64 = image.replace(/^data:image\/\w+;base64,/, '');
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  await c.env.FILE_BUCKET.put(`tenants/${user.id}/images/header-logo.png`, bytes);
  return c.json({ success: true, key: `tenants/${user.id}/images/header-logo.png` });
});

company.post('/pdf-chop', authMiddleware, zValidator('json', pdfImageSchema), async (c) => {
  const { image } = c.req.valid('json');
  const user = c.get('user');
  const base64 = image.replace(/^data:image\/\w+;base64,/, '');
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  await c.env.FILE_BUCKET.put(`tenants/${user.id}/images/company-chop.png`, bytes);
  return c.json({ success: true, key: `tenants/${user.id}/images/company-chop.png` });
});

company.post('/pdf-stamp', authMiddleware, zValidator('json', pdfImageSchema), async (c) => {
  const { image } = c.req.valid('json');
  const user = c.get('user');
  const base64 = image.replace(/^data:image\/\w+;base64,/, '');
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  await c.env.FILE_BUCKET.put(`tenants/${user.id}/images/signature-stamp.png`, bytes);
  return c.json({ success: true, key: `tenants/${user.id}/images/signature-stamp.png` });
});

// ── Domain resolution ──
company.get('/by-domain', async (c) => {
  const host = (c.req.query('host') || c.req.header('Host') || '').replace(/:\d+$/, '');
  const db = c.env.DB;
  const row = await db.prepare(
    `SELECT cs.*, d.domain FROM company_settings cs JOIN domains d ON d.user_id = cs.user_id WHERE d.domain = ? LIMIT 1`
  ).bind(host).first();
  if (!row) {
    const def = { ...DEFAULT_COMPANY };
    try { def.features = JSON.parse(DEFAULT_COMPANY.features); } catch { /* keep string */ }
    return c.json(def);
  }
  try { row.features = JSON.parse((row.features as string) || DEFAULT_COMPANY.features); } catch { row.features = DEFAULT_COMPANY.features; }
  return c.json(row);
});

export { company as companyRoutes };
