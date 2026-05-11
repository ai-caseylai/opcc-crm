import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { Bindings, Variables } from '../types';

const chat = new Hono<{ Bindings: Bindings; Variables: Variables }>();
chat.use('*', authMiddleware);

const SYSTEM_PROMPT = `You are the OPCC CRM AI assistant with access to the user's real CRM data via function calling. You use the DeepSeek LLM.

Rules:
- ALWAYS call functions to get real numbers — never guess or provide example data
- If a user asks "how many", call get_counts
- If a user asks "list" or "search", call the appropriate function
- If a user asks to create something, call the appropriate create function
- Reply in the SAME language as the user (繁體中文, 简体中文, or English)
- Be concise and direct
- When presenting numbers, format them clearly
- When presenting lists, show key fields in a readable format`;

const TOOLS: any[] = [
  { type: 'function', function: { name: 'get_counts', description: 'Get counts of all CRM records for the current user', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'get_summary', description: 'Get dashboard summary: customer/supplier/invoice/quotation counts plus P&L (income, expense, net)', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'list_invoices', description: 'List recent invoices with optional status filter', parameters: { type: 'object', properties: { status: { type: 'string', description: 'draft, sent, paid, overdue' }, limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'get_invoice', description: 'Get full invoice details by ID including line items', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Invoice ID' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'list_quotations', description: 'List recent quotations with optional status filter', parameters: { type: 'object', properties: { status: { type: 'string', description: 'draft, sent, accepted, rejected, converted' }, limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'list_customers', description: 'List recent active customers', parameters: { type: 'object', properties: { limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'search_customers', description: 'Search customers by name, email, or company', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword' }, limit: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'get_customer', description: 'Get customer details by ID', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Customer ID' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'list_products', description: 'List all active products and services', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'search_products', description: 'Search products by name or category', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'list_suppliers', description: 'List recent active suppliers', parameters: { type: 'object', properties: { limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'list_purchase_orders', description: 'List recent purchase orders with optional status filter', parameters: { type: 'object', properties: { status: { type: 'string', description: 'draft, approved, received, paid, cancelled' }, limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'list_todos', description: 'List pending todos, sorted by priority', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'get_bookkeeping', description: 'Get P&L (income statement) for a date range', parameters: { type: 'object', properties: { start_date: { type: 'string', description: 'YYYY-MM-DD' }, end_date: { type: 'string', description: 'YYYY-MM-DD' } }, required: [] } } },
  { type: 'function', function: { name: 'get_recent_activity', description: 'Get recent audit log entries (recent changes)', parameters: { type: 'object', properties: { limit: { type: 'number' } }, required: [] } } },
];

async function executeTool(name: string, db: D1Database, userId: string, args: any = {}): Promise<string> {
  const limit = args?.limit || 10;
  switch (name) {
    case 'get_counts': {
      const tables = ['customers', 'suppliers', 'products', 'invoices', 'quotations', 'purchase_orders', 'service_orders', 'todos'];
      const result: Record<string, number> = {};
      for (const t of tables) {
        try {
          const r = await db.prepare(`SELECT COUNT(*) as cnt FROM ${t} WHERE user_id = ?`).bind(userId).first<{cnt:number}>();
          result[t] = r?.cnt || 0;
        } catch { result[t] = 0; }
      }
      return JSON.stringify(result);
    }
    case 'get_summary': {
      const counts: Record<string, number> = {};
      for (const t of ['customers','suppliers','products','invoices','quotations','purchase_orders','service_orders','todos']) {
        try {
          const r = await db.prepare(`SELECT COUNT(*) as cnt FROM ${t} WHERE user_id = ?`).bind(userId).first<{cnt:number}>();
          counts[t] = r?.cnt || 0;
        } catch { counts[t] = 0; }
      }
      try {
        const invTotal = await db.prepare("SELECT COALESCE(SUM(total),0) as total FROM invoices WHERE user_id = ? AND status = 'paid'").bind(userId).first<{total:number}>();
        const poTotal = await db.prepare("SELECT COALESCE(SUM(total),0) as total FROM purchase_orders WHERE user_id = ? AND status = 'paid'").bind(userId).first<{total:number}>();
        counts.income_paid = invTotal?.total || 0;
        counts.expense_paid = poTotal?.total || 0;
        counts.net = (invTotal?.total || 0) - (poTotal?.total || 0);
      } catch {}
      return JSON.stringify(counts);
    }
    case 'list_invoices': {
      let q = `SELECT i.id, i.invoice_number, i.status, i.total, i.currency, i.issue_date, i.due_date, i.paid_date, c.name as customer_name FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.user_id = ?`;
      const params: any[] = [userId];
      if (args?.status) { q += ' AND i.status = ?'; params.push(args.status); }
      q += ' ORDER BY i.created_at DESC LIMIT ?'; params.push(limit);
      const rows = await db.prepare(q).bind(...params).all();
      return JSON.stringify(rows.results);
    }
    case 'get_invoice': {
      const inv = await db.prepare(
        'SELECT i.*, c.name as customer_name FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ? AND i.user_id = ?'
      ).bind(args.id, userId).first();
      if (!inv) return JSON.stringify({ error: 'Invoice not found' });
      const items = await db.prepare('SELECT description, quantity, unit_price, amount FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(args.id).all();
      return JSON.stringify({ ...inv, items: items.results });
    }
    case 'list_quotations': {
      let q = `SELECT q.quotation_number, q.status, q.total, q.currency, q.issue_date, q.valid_until, c.name as customer_name FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id WHERE q.user_id = ?`;
      const params: any[] = [userId];
      if (args?.status) { q += ' AND q.status = ?'; params.push(args.status); }
      q += ' ORDER BY q.created_at DESC LIMIT ?'; params.push(limit);
      const rows = await db.prepare(q).bind(...params).all();
      return JSON.stringify(rows.results);
    }
    case 'list_customers': {
      const rows = await db.prepare('SELECT id, name, company_name, email, phone, created_at FROM customers WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT ?').bind(userId, limit).all();
      return JSON.stringify(rows.results);
    }
    case 'search_customers': {
      const q = args?.query || '';
      const rows = await db.prepare(
        'SELECT id, name, company_name, email, phone, address, created_at FROM customers WHERE user_id = ? AND is_active = 1 AND (name LIKE ? OR email LIKE ? OR company_name LIKE ?) ORDER BY created_at DESC LIMIT ?'
      ).bind(userId, `%${q}%`, `%${q}%`, `%${q}%`, limit).all();
      return JSON.stringify(rows.results);
    }
    case 'get_customer': {
      const row = await db.prepare(
        'SELECT * FROM customers WHERE id = ? AND user_id = ?'
      ).bind(args.id, userId).first();
      if (!row) return JSON.stringify({ error: 'Customer not found' });
      return JSON.stringify(row);
    }
    case 'list_products': {
      const rows = await db.prepare('SELECT id, name, category, unit_price, currency, unit FROM products WHERE user_id = ? AND is_active = 1 ORDER BY name').bind(userId).all();
      return JSON.stringify(rows.results);
    }
    case 'search_products': {
      const q = args?.query || '';
      const rows = await db.prepare(
        'SELECT id, name, category, unit_price, currency, unit FROM products WHERE user_id = ? AND is_active = 1 AND (name LIKE ? OR category LIKE ?) ORDER BY name LIMIT ?'
      ).bind(userId, `%${q}%`, `%${q}%`, limit).all();
      return JSON.stringify(rows.results);
    }
    case 'list_suppliers': {
      const rows = await db.prepare('SELECT id, name, company_name, email, phone, created_at FROM suppliers WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT ?').bind(userId, limit).all();
      return JSON.stringify(rows.results);
    }
    case 'list_purchase_orders': {
      let q = `SELECT p.id, p.po_number, p.status, p.total, p.currency, p.issue_date, p.paid_date, s.name as supplier_name FROM purchase_orders p LEFT JOIN suppliers s ON p.supplier_id = s.id WHERE p.user_id = ?`;
      const params: any[] = [userId];
      if (args?.status) { q += ' AND p.status = ?'; params.push(args.status); }
      q += ' ORDER BY p.created_at DESC LIMIT ?'; params.push(limit);
      const rows = await db.prepare(q).bind(...params).all();
      return JSON.stringify(rows.results);
    }
    case 'list_todos': {
      const rows = await db.prepare("SELECT id, title, priority, due_date FROM todos WHERE user_id = ? AND status = 'pending' ORDER BY sort_order LIMIT 10").bind(userId).all();
      return JSON.stringify(rows.results);
    }
    case 'get_bookkeeping': {
      const startDate = args?.start_date || '2020-01-01';
      const endDate = args?.end_date || '2099-12-31';
      const rows = await db.prepare(
        "SELECT a.code, a.name, a.type, SUM(COALESCE(jl.debit,0)) as total_debit, SUM(COALESCE(jl.credit,0)) as total_credit FROM journal_lines jl JOIN chart_of_accounts a ON jl.account_id = a.id JOIN journal_entries je ON jl.entry_id = je.id WHERE je.user_id = ? AND je.entry_date BETWEEN ? AND ? GROUP BY a.code, a.name, a.type ORDER BY a.code"
      ).bind(userId, startDate, endDate).all();
      return JSON.stringify(rows.results);
    }
    case 'get_recent_activity': {
      const rows = await db.prepare(
        "SELECT action, entity_type, entity_id, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
      ).bind(userId, limit).all();
      return JSON.stringify(rows.results);
    }
    default:
      return '{}';
  }
}

async function callDeepSeek(apiKey: string, messages: any[], tools?: any[]): Promise<any> {
  const body: any = {
    model: 'deepseek-v4-flash',
    messages,
    max_tokens: 800,
    temperature: 0.3,
  };
  if (tools && tools.length > 0) body.tools = tools;
  if (tools && tools.length > 0) body.tool_choice = 'auto';

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`DeepSeek API error: ${resp.status} ${err}`);
  }
  return resp.json();
}

chat.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { message, history, file } = body;

  if (!message && !file) return c.json({ reply: 'Message required' });

  const apiKey = c.env.DEEPSEEK_API_KEY;
  if (!apiKey) return c.json({ reply: 'DeepSeek API key not configured' });

  // Pre-process file attachments into the message
  let userMessage = message || '';
  if (file && file.name) {
    const ext = (file.name as string).toLowerCase();
    const isCSV = ext.endsWith('.csv') || ext.endsWith('.txt');
    const isExcel = ext.endsWith('.xlsx') || ext.endsWith('.xls');
    const isPDF = ext.endsWith('.pdf');

    if (isCSV && file.data) {
      try {
        const text = atob(file.data);
        const lines = text.split('\n').slice(0, 30);
        userMessage = `[User uploaded CSV file: ${file.name}]\nContent preview (first ${lines.length} lines):\n${lines.join('\n')}\n\n${userMessage || 'Please analyze this data.'}`;
      } catch {
        userMessage = `[User uploaded file: ${file.name}]\n${userMessage || 'Please help with this file.'}`;
      }
    } else if (isExcel) {
      userMessage = `[User uploaded Excel file: ${file.name}]\nThis is an Excel file. Suggest the user to use the Import feature at /import to import this data into the CRM. ${userMessage || 'Please help with this file.'}`;
    } else if (isPDF) {
      userMessage = `[User uploaded PDF file: ${file.name}]\nThis is a PDF document. ${userMessage || 'Please help with this document.'}`;
    } else {
      userMessage = `[User uploaded file: ${file.name}]\n${userMessage || 'Please help with this file.'}`;
    }
  }

  if (!userMessage) return c.json({ reply: 'Message required' });

  try {
    const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];
    if (Array.isArray(history)) {
      for (const msg of history.slice(-8)) {
        if (msg.role && msg.content) messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: 'user', content: userMessage });

    const response1 = await callDeepSeek(apiKey, messages, TOOLS);
    const choice = response1.choices?.[0];
    const toolCalls = choice?.message?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      messages.push(choice.message);
      for (const tc of toolCalls) {
        const fnName = tc.function?.name;
        let fnArgs: any = {};
        try { fnArgs = JSON.parse(tc.function?.arguments || '{}'); } catch {}
        const result = fnName ? await executeTool(fnName, c.env.DB, user.id, fnArgs) : '{}';
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }

      const response2 = await callDeepSeek(apiKey, messages);
      const reply = response2.choices?.[0]?.message?.content || 'Sorry, I could not process that.';
      return c.json({ reply });
    }

    const reply = choice?.message?.content || 'Sorry, I could not process that.';
    return c.json({ reply });
  } catch (e: any) {
    return c.json({ reply: `AI error: ${e.message || 'unknown'}` }, 500);
  }
});

export { chat as chatRoutes };
