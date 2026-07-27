import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { Bindings, Variables } from '../types';

const compliance = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── GET /api/compliance — full dashboard ──
compliance.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const company = await db.prepare(
    `SELECT industry, br_number, br_expiry_date, ci_number, employee_count,
            fiscal_year_end, secretary_name, auditor_name
     FROM company_settings WHERE user_id = ?`
  ).bind(user.id).first<Record<string, string>>();

  const industry = company?.industry || 'general';

  const templates = await db.prepare(
    `SELECT * FROM compliance_templates
     WHERE industry = ?1 OR industry = 'general'
     ORDER BY sort_order`
  ).bind(industry).all();

  const statuses = await db.prepare(
    'SELECT * FROM member_compliance WHERE user_id = ?'
  ).bind(user.id).all();

  const statusMap = new Map((statuses.results || []).map((s: any) => [s.template_id, s]));

  const checklist = (templates.results || []).map((tpl: any) => ({
    ...tpl,
    is_required: !!tpl.is_required,
    has_deadline: !!tpl.has_deadline,
    member_status: statusMap.get(tpl.id)?.status || 'pending',
    notes: statusMap.get(tpl.id)?.notes || null,
    completed_at: statusMap.get(tpl.id)?.completed_at || null,
    reminder_enabled: statusMap.get(tpl.id)?.reminder_enabled !== 0,
  }));

  const compliant = checklist.filter((i: any) => i.member_status === 'compliant').length;
  const pending = checklist.filter((i: any) => i.member_status === 'pending').length;
  const overdue = checklist.filter((i: any) => i.member_status === 'overdue').length;
  const na = checklist.filter((i: any) => i.member_status === 'not_applicable').length;

  const upcoming = await db.prepare(
    `SELECT * FROM compliance_dates
     WHERE user_id = ? AND date(date_value) <= date('now', '+90 days') AND date(date_value) >= date('now')
     ORDER BY date_value LIMIT 10`
  ).bind(user.id).all();

  // Group checklist by category
  const categories: Record<string, any[]> = {};
  for (const item of checklist) {
    const cat = item.category || 'other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(item);
  }

  return c.json({
    stats: { compliant, pending, overdue, not_applicable: na, total: checklist.length },
    categories,
    checklist,
    company_info: company,
    upcoming_reminders: upcoming.results || [],
  });
});

// ── PUT /api/compliance/:id — update item status ──
const updateSchema = z.object({
  status: z.enum(['compliant', 'pending', 'overdue', 'not_applicable']),
  notes: z.string().optional(),
});

compliance.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const templateId = c.req.param('id');
  const { status, notes } = c.req.valid('json');

  const existing = await db.prepare(
    'SELECT id FROM member_compliance WHERE user_id = ? AND template_id = ?'
  ).bind(user.id, templateId).first();

  if (existing) {
    await db.prepare(
      `UPDATE member_compliance SET status = ?, notes = ?,
       completed_at = CASE WHEN ? = 'compliant' THEN datetime('now') ELSE completed_at END,
       updated_at = datetime('now')
       WHERE user_id = ? AND template_id = ?`
    ).bind(status, notes || null, status, user.id, templateId).run();
  } else {
    await db.prepare(
      `INSERT INTO member_compliance (id, user_id, template_id, status, notes,
       completed_at) VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'compliant' THEN datetime('now') ELSE NULL END)`
    ).bind(crypto.randomUUID(), user.id, templateId, status, notes || null, status).run();
  }

  // Log
  await db.prepare(
    `INSERT INTO compliance_log (id, user_id, action, template_id, details) VALUES (?, ?, 'update_status', ?, ?)`
  ).bind(crypto.randomUUID(), user.id, templateId, JSON.stringify({ status, notes })).run();

  return c.json({ success: true });
});

// ── GET /api/compliance/dates ──
compliance.get('/dates', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const dates = await db.prepare(
    'SELECT * FROM compliance_dates WHERE user_id = ? ORDER BY date_value'
  ).bind(user.id).all();
  return c.json({ dates: dates.results || [] });
});

// ── POST /api/compliance/dates ──
const dateSchema = z.object({
  date_type: z.enum([
    'br_expiry', 'ci_issue', 'tax_filing_deadline', 'annual_return',
    'audit_deadline', 'mpf_due', 'insurance_expiry', 'custom'
  ]),
  date_value: z.string(),
  reminder_days: z.string().optional(),
  notes: z.string().optional(),
});

compliance.post('/dates', authMiddleware, zValidator('json', dateSchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const data = c.req.valid('json');

  await db.prepare(
    `INSERT OR REPLACE INTO compliance_dates (id, user_id, date_type, date_value, reminder_days, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.id, data.date_type, data.date_value,
         data.reminder_days || '90,60,30,7', data.notes || null).run();

  return c.json({ success: true });
});

// ── DELETE /api/compliance/dates/:id ──
compliance.delete('/dates/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await db.prepare('DELETE FROM compliance_dates WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).run();
  return c.json({ success: true });
});

// ── POST /api/compliance/generate-checklist — AI generate ──
compliance.post('/generate-checklist', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { industry, business_description } = await c.req.json<{ industry: string; business_description?: string }>();

  const prompt = `你是熟悉香港法律法規的合規顧問。為以下香港一人公司生成合規清單。

行業：${industry}
業務描述：${business_description || '未提供'}

以JSON格式輸出，只列出真正適用於香港一人公司的項目：
[
  {
    "category": "company|tax|employment|privacy|industry",
    "title_zh": "項目名稱",
    "title_en": "Item Name",
    "description_zh": "簡短說明(50字內)",
    "is_required": true,
    "has_deadline": false,
    "action_url": "相關網站URL或null"
  }
]
排除不適用於一人公司的項目。`;

  try {
    const aiResp = await c.env.AI.run('@cf/deepseek-ai/deepseek-v4', {
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const text = (aiResp as any)?.choices?.[0]?.message?.content || (aiResp as any)?.response || '';
    let items = JSON.parse(text);
    if (!Array.isArray(items)) items = items.items || items.checklist || [];

    const results = [];
    for (const item of items) {
      const tplId = crypto.randomUUID();
      await db.prepare(
        `INSERT OR IGNORE INTO compliance_templates (id, category, industry, title_zh, title_en, description_zh, is_required, has_deadline, action_url, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 50)`
      ).bind(tplId, item.category || 'industry', industry, item.title_zh, item.title_en || '',
             item.description_zh || '', item.is_required ? 1 : 0, item.has_deadline ? 1 : 0,
             item.action_url || null).run();
      results.push({ id: tplId, ...item });
    }

    return c.json({ success: true, generated: results.length, items: results });
  } catch (err: any) {
    return c.json({ error: 'AI 生成失敗: ' + (err.message || 'unknown') }, 500);
  }
});

// ── GET /api/compliance/reminders — upcoming ──
compliance.get('/reminders', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const days = parseInt(c.req.query('days') || '90');

  const reminders = await db.prepare(
    `SELECT cd.* FROM compliance_dates cd
     WHERE cd.user_id = ? AND date(cd.date_value) <= date('now', '+${Math.min(days, 365)} days')
       AND date(cd.date_value) >= date('now')
     ORDER BY cd.date_value`
  ).bind(user.id).all();

  return c.json({ reminders: reminders.results || [] });
});

export { compliance as complianceRoutes };
