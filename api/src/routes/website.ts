import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { Bindings, Variables } from '../types';

const website = new Hono<{ Bindings: Bindings; Variables: Variables }>();
website.use('*', authMiddleware);

const DEFAULT_PROMPT = `Generate a complete, modern, professional single-page company website in HTML/CSS for "{name}".

Company details:
- Name: {name}
- Tagline: {tagline}
- Address: {address}
- Phone: {phone}
- Email: {email}
- Website: {website}
- Bank: {bank}

Requirements:
- Single HTML file with embedded CSS (no external dependencies)
- Modern design with hero section, about, services (3 placeholder services), contact form, footer
- Responsive design (mobile-friendly)
- Use a professional color scheme (blue/white theme)
- Include Font Awesome icons via CDN link
- The HTML must be complete and self-contained
- Use semantic HTML5 tags (header, section, footer)
- Add smooth scroll navigation
- Language: Traditional Chinese (繁體中文) for all visible text, but keep HTML tags in English
- DO NOT wrap in markdown code blocks — output raw HTML directly starting with <!DOCTYPE html>

Output ONLY the HTML code, nothing else.`;

function buildPrompt(template: string, company: Record<string, string>): string {
  return template
    .replace(/\{name\}/g, company.name)
    .replace(/\{tagline\}/g, company.tagline || 'Professional Services')
    .replace(/\{address\}/g, company.address)
    .replace(/\{phone\}/g, company.phone || 'N/A')
    .replace(/\{email\}/g, company.email)
    .replace(/\{website\}/g, company.website || 'N/A')
    .replace(/\{bank\}/g, company.bank_name || 'N/A');
}

website.post('/', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({})) as { customPrompt?: string };

  const row = await db.prepare('SELECT * FROM company_settings WHERE user_id = ?').bind(tenantId).first<Record<string, string>>();
  const company = {
    name: row?.name || 'My Company',
    tagline: row?.tagline || '',
    address: row?.address || 'Hong Kong',
    phone: row?.phone || '',
    email: row?.email || user.email || '',
    website: row?.website || '',
    bank_name: row?.bank_name || '',
    bank_account: row?.bank_account || '',
  };

  const apiKey = c.env.DEEPSEEK_API_KEY;
  if (!apiKey) return c.json({ error: 'DeepSeek API key not configured' }, 503);

  const promptTemplate = body.customPrompt?.trim() || DEFAULT_PROMPT;
  const prompt = buildPrompt(promptTemplate, company);

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8000,
        temperature: 0.7,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`DeepSeek API error: ${resp.status} ${err}`);
    }

    const result = await resp.json() as { choices?: { message?: { content?: string } }[] };
    let html = result.choices?.[0]?.message?.content || '';

    html = html.replace(/^```html?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    if (!html.trim().startsWith('<!DOCTYPE') && !html.trim().startsWith('<html')) {
      html = '<!DOCTYPE html>\n<html lang="zh-HK">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>' + company.name + '</title></head>\n<body>\n' + html + '\n</body>\n</html>';
    }

    // Auto-save version
    const maxVer = await db.prepare('SELECT MAX(version_number) as v FROM website_versions WHERE user_id = ?').bind(tenantId).first<{ v: number | null }>();
    const version_number = (maxVer?.v || 0) + 1;
    const id = `wv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await db.prepare(
      'INSERT INTO website_versions (id, user_id, version_number, html, prompt, company_name) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, user.id, version_number, html, promptTemplate, company.name).run();

    return c.json({ html, company_name: company.name, version: { id, version_number } });
  } catch (e: any) {
    return c.json({ error: e.message || 'Generation failed' }, 500);
  }
});

// List versions
website.get('/versions', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const { results } = await db.prepare(
    'SELECT id, version_number, company_name, prompt, created_at FROM website_versions WHERE user_id = ? ORDER BY version_number DESC'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// Get single version
website.get('/versions/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const row = await db.prepare(
    'SELECT * FROM website_versions WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), tenantId).first();
  if (!row) return c.json({ error: 'Version not found' }, 404);
  return c.json({ data: row });
});

// Delete version
website.delete('/versions/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM website_versions WHERE id = ? AND user_id = ?').bind(c.req.param('id'), tenantId).first();
  if (!existing) return c.json({ error: 'Version not found' }, 404);
  await db.prepare('DELETE FROM website_versions WHERE id = ? AND user_id = ?').bind(c.req.param('id'), tenantId).run();
  return c.json({ ok: true });
});

website.post('/preview', async (c) => {
  const body = await c.req.json();
  const html = body.html || '';
  return c.html(html.startsWith('<!DOCTYPE') ? html : '<!DOCTYPE html><html><body>' + html + '</body></html>');
});

// Get default prompt template
website.get('/default-prompt', async (c) => {
  return c.json({ prompt: DEFAULT_PROMPT });
});

export { website as websiteRoutes };
