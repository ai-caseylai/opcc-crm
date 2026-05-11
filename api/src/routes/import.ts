import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const imports = new Hono<{ Bindings: Bindings; Variables: Variables }>();
imports.use('*', authMiddleware);

const importCustomersSchema = z.object({
  data: z.array(z.object({
    name: z.string().min(1), company_name: z.string().optional(), email: z.string().optional(),
    phone: z.string().optional(), address: z.string().optional(), city: z.string().optional(),
    state: z.string().optional(), postal_code: z.string().optional(), country: z.string().optional(),
    notes: z.string().optional(), tax_id: z.string().optional(),
  })),
});

imports.post('/customers', zValidator('json', importCustomersSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { data } = c.req.valid('json');
  let imported = 0, skipped = 0;

  for (const record of data) {
    try {
      const id = `c-${uuidv4().slice(0, 8)}`;
      await db.prepare(
        `INSERT INTO customers (id, user_id, name, company_name, email, phone, address, city, state, postal_code, country, notes, tax_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, user.id, record.name, record.company_name || null, record.email || null, record.phone || null,
        record.address || null, record.city || null, record.state || null, record.postal_code || null,
        record.country || 'Hong Kong', record.notes || null, record.tax_id || null).run();
      imported++;
    } catch { skipped++; }
  }
  return c.json({ imported, skipped, total: data.length });
});

imports.post('/suppliers', zValidator('json', z.object({
  data: z.array(z.object({
    name: z.string().min(1), company_name: z.string().optional(), email: z.string().optional(),
    phone: z.string().optional(), address: z.string().optional(), notes: z.string().optional(),
    tax_id: z.string().optional(), payment_terms: z.string().optional(),
  })),
})), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { data } = c.req.valid('json');
  let imported = 0;
  for (const record of data) {
    const id = `s-${uuidv4().slice(0, 8)}`;
    await db.prepare(
      'INSERT INTO suppliers (id, user_id, name, company_name, email, phone, address, notes, tax_id, payment_terms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, user.id, record.name, record.company_name || null, record.email || null, record.phone || null, record.address || null, record.notes || null, record.tax_id || null, record.payment_terms || null).run();
    imported++;
  }
  return c.json({ imported, total: data.length });
});

imports.post('/products', zValidator('json', z.object({
  data: z.array(z.object({
    name: z.string().min(1), description: z.string().optional(), unit_price: z.number().min(0),
    currency: z.string().optional(), unit: z.string().optional(), category: z.string().optional(), sku: z.string().optional(),
  })),
})), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { data } = c.req.valid('json');
  let imported = 0;
  for (const record of data) {
    const id = `p-${uuidv4().slice(0, 8)}`;
    await db.prepare(
      'INSERT INTO products (id, user_id, name, description, unit_price, currency, unit, category, sku) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, user.id, record.name, record.description || null, record.unit_price, record.currency || 'HKD', record.unit || 'pcs', record.category || null, record.sku || null).run();
    imported++;
  }
  return c.json({ imported, total: data.length });
});

imports.post('/parse-csv', zValidator('json', z.object({ csv: z.string(), type: z.enum(['customers', 'suppliers', 'products', 'invoices', 'quotations', 'purchase-orders', 'service-orders']) })), async (c) => {
  const { csv } = c.req.valid('json');
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return c.json({ error: 'CSV must have header and at least one data row' }, 400);
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, any> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return c.json({ headers, rows, count: rows.length });
});

// ── Invoice Import ──
// Each CSV row = one line item. Rows with same invoice_number are grouped.
// Auto-matches customer by name (fuzzy) or email. Falls back to creating customer.
imports.post('/invoices', zValidator('json', z.object({
  data: z.array(z.object({
    invoice_number: z.string().min(1),
    customer_name: z.string().optional(),
    customer_email: z.string().optional(),
    issue_date: z.string().optional(),
    due_date: z.string().optional(),
    status: z.string().optional(),
    currency: z.string().optional(),
    tax_rate: z.string().optional(),
    description: z.string().min(1),
    quantity: z.string().optional(),
    unit_price: z.string().optional(),
    amount: z.string().optional(),
    notes: z.string().optional(),
    receipt_number: z.string().optional(),
    paid_date: z.string().optional(),
  })),
})), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { data } = c.req.valid('json');
  let created = 0, skipped = 0;

  // Group rows by invoice_number
  const groups = new Map<string, any[]>();
  for (const row of data) {
    const key = row.invoice_number.trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  for (const [invNum, rows] of groups) {
    try {
      const first = rows[0];

      // Auto-match customer
      let customerId: string | null = null;
      if (first.customer_email) {
        const c = await db.prepare('SELECT id FROM customers WHERE user_id = ? AND email = ?')
          .bind(user.id, first.customer_email.trim()).first<{ id: string }>();
        if (c) customerId = c.id;
      }
      if (!customerId && first.customer_name) {
        const c = await db.prepare('SELECT id FROM customers WHERE user_id = ? AND name LIKE ?')
          .bind(user.id, `%${first.customer_name.trim()}%`).first<{ id: string }>();
        if (c) customerId = c.id;
      }
      // Create customer if not found
      if (!customerId && first.customer_name) {
        customerId = `c-${uuidv4().slice(0, 8)}`;
        await db.prepare(
          'INSERT INTO customers (id, user_id, name, email) VALUES (?, ?, ?, ?)'
        ).bind(customerId, user.id, first.customer_name.trim(), (first.customer_email || '').trim() || null).run();
      }
      if (!customerId) { skipped += rows.length; continue; }

      // Calculate totals
      const items = rows.map((r, i) => ({
        description: r.description,
        quantity: parseFloat(r.quantity || '1') || 1,
        unit_price: parseFloat(r.unit_price || '0') || 0,
        amount: parseFloat(r.amount || '0') || parseFloat(r.quantity || '1') * parseFloat(r.unit_price || '0'),
        sort_order: i,
      }));
      const subtotal = items.reduce((s, it) => s + it.amount, 0);
      const taxRate = parseFloat(first.tax_rate || '0') || 0;
      const taxAmount = subtotal * (taxRate / 100);
      const total = subtotal + taxAmount;

      const invId = `i-${uuidv4().slice(0, 8)}`;
      const issueDate = first.issue_date || new Date().toISOString().split('T')[0];
      const dueDate = first.due_date || new Date(Date.now() + 30*86400000).toISOString().split('T')[0];

      await db.prepare(
        `INSERT INTO invoices (id, user_id, invoice_number, customer_id, status, issue_date, due_date, subtotal, tax_rate, tax_amount, total, currency, notes, receipt_number, paid_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(invId, user.id, invNum, customerId, first.status || 'draft', issueDate, dueDate,
        subtotal, taxRate, taxAmount, total, first.currency || 'HKD', first.notes || null, first.receipt_number || null, first.paid_date || null).run();

      for (const item of items) {
        await db.prepare(
          'INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(`ii-${uuidv4().slice(0, 8)}`, invId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order).run();
      }

      created++;
    } catch { skipped += rows.length; }
  }

  return c.json({ imported: created, skipped, total_groups: groups.size });
});

// ── Quotation Import ──
imports.post('/quotations', zValidator('json', z.object({
  data: z.array(z.object({
    quotation_number: z.string().min(1),
    customer_name: z.string().optional(),
    customer_email: z.string().optional(),
    issue_date: z.string().optional(),
    valid_until: z.string().optional(),
    status: z.string().optional(),
    currency: z.string().optional(),
    tax_rate: z.string().optional(),
    description: z.string().min(1),
    quantity: z.string().optional(),
    unit_price: z.string().optional(),
    amount: z.string().optional(),
    notes: z.string().optional(),
  })),
})), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { data } = c.req.valid('json');
  let created = 0, skipped = 0;

  const groups = new Map<string, any[]>();
  for (const row of data) {
    const key = row.quotation_number.trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  for (const [qNum, rows] of groups) {
    try {
      const first = rows[0];

      let customerId: string | null = null;
      if (first.customer_email) {
        const c = await db.prepare('SELECT id FROM customers WHERE user_id = ? AND email = ?')
          .bind(user.id, first.customer_email.trim()).first<{ id: string }>();
        if (c) customerId = c.id;
      }
      if (!customerId && first.customer_name) {
        const c = await db.prepare('SELECT id FROM customers WHERE user_id = ? AND name LIKE ?')
          .bind(user.id, `%${first.customer_name.trim()}%`).first<{ id: string }>();
        if (c) customerId = c.id;
      }
      if (!customerId && first.customer_name) {
        customerId = `c-${uuidv4().slice(0, 8)}`;
        await db.prepare('INSERT INTO customers (id, user_id, name, email) VALUES (?, ?, ?, ?)')
          .bind(customerId, user.id, first.customer_name.trim(), (first.customer_email || '').trim() || null).run();
      }
      if (!customerId) { skipped += rows.length; continue; }

      const items = rows.map((r, i) => ({
        description: r.description,
        quantity: parseFloat(r.quantity || '1') || 1,
        unit_price: parseFloat(r.unit_price || '0') || 0,
        amount: parseFloat(r.amount || '0') || parseFloat(r.quantity || '1') * parseFloat(r.unit_price || '0'),
        sort_order: i,
      }));
      const subtotal = items.reduce((s, it) => s + it.amount, 0);
      const taxRate = parseFloat(first.tax_rate || '0') || 0;
      const taxAmount = subtotal * (taxRate / 100);
      const total = subtotal + taxAmount;

      const qId = `q-${uuidv4().slice(0, 8)}`;
      const issueDate = first.issue_date || new Date().toISOString().split('T')[0];
      const validUntil = first.valid_until || new Date(Date.now() + 30*86400000).toISOString().split('T')[0];

      await db.prepare(
        `INSERT INTO quotations (id, user_id, quotation_number, customer_id, status, issue_date, valid_until, subtotal, tax_rate, tax_amount, total, currency, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(qId, user.id, qNum, customerId, first.status || 'draft', issueDate, validUntil,
        subtotal, taxRate, taxAmount, total, first.currency || 'HKD', first.notes || null).run();

      for (const item of items) {
        await db.prepare(
          'INSERT INTO quotation_items (id, quotation_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(`qi-${uuidv4().slice(0, 8)}`, qId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order).run();
      }

      created++;
    } catch { skipped += rows.length; }
  }

  return c.json({ imported: created, skipped, total_groups: groups.size });
});

// ── Purchase Order Import ──
imports.post('/purchase-orders', zValidator('json', z.object({
  data: z.array(z.object({
    po_number: z.string().min(1),
    supplier_name: z.string().optional(),
    issue_date: z.string().optional(),
    due_date: z.string().optional(),
    status: z.string().optional(),
    currency: z.string().optional(),
    tax_rate: z.string().optional(),
    description: z.string().min(1),
    quantity: z.string().optional(),
    unit_price: z.string().optional(),
    amount: z.string().optional(),
    notes: z.string().optional(),
    receipt_number: z.string().optional(),
    paid_date: z.string().optional(),
  })),
})), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { data } = c.req.valid('json');
  let created = 0, skipped = 0;

  const groups = new Map<string, any[]>();
  for (const row of data) {
    const key = row.po_number.trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  for (const [poNum, rows] of groups) {
    try {
      const first = rows[0];

      let supplierId: string | null = null;
      if (first.supplier_name) {
        const s = await db.prepare('SELECT id FROM suppliers WHERE user_id = ? AND name LIKE ?')
          .bind(user.id, `%${first.supplier_name.trim()}%`).first<{ id: string }>();
        if (s) supplierId = s.id;
      }
      if (!supplierId && first.supplier_name) {
        supplierId = `s-${uuidv4().slice(0, 8)}`;
        await db.prepare('INSERT INTO suppliers (id, user_id, name) VALUES (?, ?, ?)')
          .bind(supplierId, user.id, first.supplier_name.trim()).run();
      }

      const items = rows.map((r, i) => ({
        description: r.description, quantity: parseFloat(r.quantity || '1') || 1,
        unit_price: parseFloat(r.unit_price || '0') || 0,
        amount: parseFloat(r.amount || '0') || parseFloat(r.quantity || '1') * parseFloat(r.unit_price || '0'),
        sort_order: i,
      }));
      const subtotal = items.reduce((s, it) => s + it.amount, 0);
      const taxRate = parseFloat(first.tax_rate || '0') || 0;
      const taxAmount = subtotal * (taxRate / 100);
      const total = subtotal + taxAmount;

      const poId = `po-${uuidv4().slice(0, 8)}`;
      const issueDate = first.issue_date || new Date().toISOString().split('T')[0];

      await db.prepare(
        `INSERT INTO purchase_orders (id, user_id, po_number, supplier_id, status, issue_date, due_date, subtotal, tax_rate, tax_amount, total, currency, notes, receipt_number, paid_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(poId, user.id, poNum, supplierId, first.status || 'draft', issueDate, first.due_date || null,
        subtotal, taxRate, taxAmount, total, first.currency || 'HKD', first.notes || null, first.receipt_number || null, first.paid_date || null).run();

      for (const item of items) {
        await db.prepare(
          'INSERT INTO purchase_order_items (id, po_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(`poi-${uuidv4().slice(0, 8)}`, poId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order).run();
      }
      created++;
    } catch { skipped += rows.length; }
  }
  return c.json({ imported: created, skipped, total_groups: groups.size });
});

// ── Service Order Import ──
imports.post('/service-orders', zValidator('json', z.object({
  data: z.array(z.object({
    so_number: z.string().min(1),
    customer_name: z.string().optional(),
    customer_email: z.string().optional(),
    issue_date: z.string().optional(),
    valid_from: z.string().optional(),
    valid_until: z.string().optional(),
    status: z.string().optional(),
    currency: z.string().optional(),
    tax_rate: z.string().optional(),
    description: z.string().min(1),
    quantity: z.string().optional(),
    unit_price: z.string().optional(),
    amount: z.string().optional(),
    notes: z.string().optional(),
  })),
})), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { data } = c.req.valid('json');
  let created = 0, skipped = 0;

  const groups = new Map<string, any[]>();
  for (const row of data) {
    const key = row.so_number.trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  for (const [soNum, rows] of groups) {
    try {
      const first = rows[0];

      let customerId: string | null = null;
      if (first.customer_email) {
        const c = await db.prepare('SELECT id FROM customers WHERE user_id = ? AND email = ?')
          .bind(user.id, first.customer_email.trim()).first<{ id: string }>();
        if (c) customerId = c.id;
      }
      if (!customerId && first.customer_name) {
        const c = await db.prepare('SELECT id FROM customers WHERE user_id = ? AND name LIKE ?')
          .bind(user.id, `%${first.customer_name.trim()}%`).first<{ id: string }>();
        if (c) customerId = c.id;
      }
      if (!customerId && first.customer_name) {
        customerId = `c-${uuidv4().slice(0, 8)}`;
        await db.prepare('INSERT INTO customers (id, user_id, name, email) VALUES (?, ?, ?, ?)')
          .bind(customerId, user.id, first.customer_name.trim(), (first.customer_email || '').trim() || null).run();
      }
      if (!customerId) { skipped += rows.length; continue; }

      const items = rows.map((r, i) => ({
        description: r.description, quantity: parseFloat(r.quantity || '1') || 1,
        unit_price: parseFloat(r.unit_price || '0') || 0,
        amount: parseFloat(r.amount || '0') || parseFloat(r.quantity || '1') * parseFloat(r.unit_price || '0'),
        sort_order: i,
      }));
      const subtotal = items.reduce((s, it) => s + it.amount, 0);
      const taxRate = parseFloat(first.tax_rate || '0') || 0;
      const taxAmount = subtotal * (taxRate / 100);
      const total = subtotal + taxAmount;

      const soId = `so-${uuidv4().slice(0, 8)}`;
      const issueDate = first.issue_date || new Date().toISOString().split('T')[0];

      await db.prepare(
        `INSERT INTO service_orders (id, user_id, so_number, customer_id, status, issue_date, valid_from, valid_until, subtotal, tax_rate, tax_amount, total, currency, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(soId, user.id, soNum, customerId, first.status || 'draft', issueDate, first.valid_from || null, first.valid_until || null,
        subtotal, taxRate, taxAmount, total, first.currency || 'HKD', first.notes || null).run();

      for (const item of items) {
        await db.prepare(
          'INSERT INTO service_order_items (id, so_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(`soi-${uuidv4().slice(0, 8)}`, soId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order).run();
      }
      created++;
    } catch { skipped += rows.length; }
  }
  return c.json({ imported: created, skipped, total_groups: groups.size });
});

export { imports as importRoutes };
