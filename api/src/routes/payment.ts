import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { Bindings, Variables } from '../types';

const payment = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── GET payment config ──
payment.get('/config', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const row = await c.env.DB.prepare(
    'SELECT methods, qr_fps, qr_wechat, qr_alipay, qr_octopus, stripe_publishable FROM payment_config WHERE user_id = ?'
  ).bind(tenantId).first();
  if (!row) return c.json({ methods: [], stripe_publishable: '' });
  try { (row as any).methods = JSON.parse((row as any).methods || '[]'); } catch { (row as any).methods = []; }
  return c.json(row);
});

// ── PUT payment config ──
payment.put('/config', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();

  const existing = await db.prepare('SELECT user_id FROM payment_config WHERE user_id = ?').bind(tenantId).first();
  if (existing) {
    const sets: string[] = []; const params: any[] = [];
    for (const k of ['methods','qr_fps','qr_wechat','qr_alipay','qr_octopus','stripe_secret','stripe_publishable','stripe_webhook_secret']) {
      if (body[k] !== undefined) { sets.push(`${k} = ?`); params.push(typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k]); }
    }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push("updated_at = datetime('now')");
    params.push(tenantId);
    await db.prepare(`UPDATE payment_config SET ${sets.join(', ')} WHERE user_id = ?`).bind(...params).run();
  } else {
    await db.prepare(
      `INSERT INTO payment_config (user_id, methods, qr_fps, qr_wechat, qr_alipay, qr_octopus, stripe_secret, stripe_publishable, stripe_webhook_secret)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(tenantId, JSON.stringify(body.methods || []), body.qr_fps || null, body.qr_wechat || null,
      body.qr_alipay || null, body.qr_octopus || null, body.stripe_secret || null,
      body.stripe_publishable || null, body.stripe_webhook_secret || null).run();
  }
  return c.json({ success: true });
});

// ── Public: Invoice payment page ──
payment.get('/pay/:invoiceId', async (c) => {
  const db = c.env.DB;
  const invoiceId = c.req.param('invoiceId');

  const inv = await db.prepare(
    `SELECT i.*, c.name as customer_name FROM invoices i JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`
  ).bind(invoiceId).first<Record<string,any>>();
  if (!inv) return c.json({ error: 'Invoice not found' }, 404);

  const payCfg = await db.prepare('SELECT * FROM payment_config WHERE user_id = ?').bind(inv.user_id).first<Record<string,any>>();
  const methods: string[] = payCfg ? (() => { try { return JSON.parse(payCfg.methods || '[]'); } catch { return []; } })() : [];

  const qrCodes: Record<string, string> = {};
  if (payCfg) {
    if (payCfg.qr_fps) qrCodes['fps'] = payCfg.qr_fps;
    if (payCfg.qr_wechat) qrCodes['wechat'] = payCfg.qr_wechat;
    if (payCfg.qr_alipay) qrCodes['alipay'] = payCfg.qr_alipay;
    if (payCfg.qr_octopus) qrCodes['octopus'] = payCfg.qr_octopus;
  }

  // Create Stripe Payment Link if configured
  let stripeUrl = '';
  if (methods.includes('card') && payCfg?.stripe_secret) {
    try {
      const stripeRes = await fetch('https://api.stripe.com/v1/payment_links', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${payCfg.stripe_secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          'line_items[0][price_data][currency]': inv.currency || 'hkd',
          'line_items[0][price_data][product_data][name]': `Invoice ${inv.invoice_number}`,
          'line_items[0][price_data][unit_amount]': String(Math.round((inv.total || 0) * 100)),
          'line_items[0][quantity]': '1',
          'after_completion[type]': 'redirect',
          'after_completion[redirect][url]': `${c.req.url}?paid=1`,
        }).toString(),
      });
      const stripeJson: any = await stripeRes.json();
      stripeUrl = stripeJson?.url || '';
    } catch { /* Stripe unavailable */ }
  }

  return c.json({
    invoice: { id: inv.id, number: inv.invoice_number, total: inv.total, currency: inv.currency || 'HKD', customer: inv.customer_name, status: inv.status },
    methods,
    qr_codes: qrCodes,
    stripe_url: stripeUrl,
  });
});

// ── Stripe webhook ──
payment.post('/stripe-webhook', async (c) => {
  const db = c.env.DB;
  const sig = c.req.header('stripe-signature');
  const body = await c.req.text();

  // Find matching payment_config by webhook secret
  const configs = await db.prepare('SELECT user_id, stripe_webhook_secret FROM payment_config WHERE stripe_webhook_secret IS NOT NULL').all();
  let matchedUserId = '';
  for (const cfg of configs.results as any[]) {
    if (cfg.stripe_webhook_secret && sig) {
      matchedUserId = cfg.user_id;
      break;
    }
  }

  if (!matchedUserId) return c.json({ received: true });

  try {
    const event = JSON.parse(body);
    if (event.type === 'checkout.session.completed') {
      const invNumber = event.data?.object?.metadata?.invoice_number;
      if (invNumber) {
        await db.prepare("UPDATE invoices SET status = 'paid', updated_at = datetime('now') WHERE invoice_number = ? AND user_id = ?")
          .bind(invNumber, matchedUserId).run();
      }
    }
  } catch { /* ignore parse errors */ }

  return c.json({ received: true });
});

// ── Public: Invoice payment HTML page ──
payment.get('/pay/:invoiceId/page', async (c) => {
  const db = c.env.DB;
  const invoiceId = c.req.param('invoiceId');

  const inv = await db.prepare(
    `SELECT i.*, c.name as customer_name FROM invoices i JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`
  ).bind(invoiceId).first<Record<string,any>>();
  if (!inv) return c.html('<h1>Invoice not found</h1>', 404);

  const payCfg = await db.prepare('SELECT * FROM payment_config WHERE user_id = ?').bind(inv.user_id).first<Record<string,any>>();
  const methods: string[] = payCfg ? (() => { try { return JSON.parse(payCfg.methods || '[]'); } catch { return []; } })() : [];

  const qrRows = [
    { key: 'fps', label: '轉數快 FPS', icon: '💳' },
    { key: 'wechat', label: 'WeChat Pay HK', icon: '💚' },
    { key: 'alipay', label: 'AlipayHK', icon: '💙' },
    { key: 'octopus', label: '八達通 Octopus', icon: '🧡' },
  ].filter(q => methods.includes(q.key) && payCfg?.[`qr_${q.key}`]);

  const qrHtml = qrRows.map(q => `
    <div style="text-align:center;margin:12px 0">
      <div style="font-weight:600;margin:8px 0">${q.icon} ${q.label}</div>
      <img src="${payCfg?.[`qr_${q.key}`]}" style="max-width:200px;border-radius:8px" />
    </div>
  `).join('');

  const stripeBtn = methods.includes('card') && payCfg?.stripe_publishable
    ? `<a href="/api/payment/pay/${invoiceId}?action=stripe" style="display:inline-block;background:#635BFF;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:8px">💳 Pay with Card</a>`
    : '';

  return c.html(`<!DOCTYPE html>
<html lang="zh-HK">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>付款 - ${inv.invoice_number}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f8fafc;color:#1a1a1a}
.card{background:white;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.06);margin-bottom:16px}
h1{font-size:20px;margin:0 0 4px}.amt{font-size:36px;font-weight:700;color:#2563eb}.qrs{text-align:center}
</style></head>
<body>
<div class="card">
  <div style="color:#888;font-size:13px">${inv.customer_name || 'Customer'}</div>
  <h1>${inv.invoice_number}</h1>
  <div class="amt">${(inv.currency||'HKD')} ${(inv.total||0).toLocaleString()}</div>
  <div style="color:#888;font-size:13px;margin-top:4px">Status: ${inv.status}</div>
</div>
${qrHtml ? `<div class="card qrs"><h3 style="margin:0 0 8px">請掃碼付款</h3>${qrHtml}</div>` : ''}
${stripeBtn ? `<div class="card" style="text-align:center">${stripeBtn}</div>` : ''}
${!qrHtml && !stripeBtn ? '<div class="card" style="text-align:center;color:#888">暫未設定付款方式</div>' : ''}
</body></html>`);
});

export { payment as paymentRoutes };
