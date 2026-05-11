import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { Bindings, Variables } from '../types';

const website = new Hono<{ Bindings: Bindings; Variables: Variables }>();
website.use('*', authMiddleware);

website.post('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const row = await db.prepare('SELECT * FROM company_settings WHERE user_id = ?').bind(user.id).first<Record<string,string>>();
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

  const prompt = `Generate a complete, modern, professional single-page company website in HTML/CSS for "${company.name}".

Company details:
- Name: ${company.name}
- Tagline: ${company.tagline || 'Professional Services'}
- Address: ${company.address}
- Phone: ${company.phone || 'N/A'}
- Email: ${company.email}
- Website: ${company.website || 'N/A'}
- Bank: ${company.bank_name || 'N/A'}

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

    return c.json({ html, company_name: company.name });
  } catch (e: any) {
    return c.json({ error: e.message || 'Generation failed' }, 500);
  }
});

website.post('/preview', async (c) => {
  const body = await c.req.json();
  const html = body.html || '';
  return c.html(html.startsWith('<!DOCTYPE') ? html : '<!DOCTYPE html><html><body>' + html + '</body></html>');
});

export { website as websiteRoutes };
