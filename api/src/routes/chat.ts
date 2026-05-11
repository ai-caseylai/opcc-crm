import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { Bindings, Variables } from '../types';

const chat = new Hono<{ Bindings: Bindings; Variables: Variables }>();
chat.use('*', authMiddleware);

const SYSTEM_PROMPT = `You are the OPCC CRM assistant with access to the user's real CRM data via function calling.

Rules:
- ALWAYS call functions to get real numbers — never guess or provide example data
- If a user asks "how many", call get_counts
- If a user asks "list", call the appropriate list function
- Reply in the SAME language as the user (繁體中文, 简体中文, or English)
- Be concise and direct
- When presenting numbers, format them clearly`;

// ── Tools / Functions ──
const TOOLS = [
  {
    name: 'get_counts',
    description: 'Get counts of all CRM records for the current user',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_invoices',
    description: 'List recent invoices with status filter',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', description: 'draft, sent, paid, overdue' }, limit: { type: 'number' } },
      required: [],
    },
  },
  {
    name: 'list_quotations',
    description: 'List recent quotations',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', description: 'draft, sent, accepted, rejected, converted' } },
      required: [],
    },
  },
  {
    name: 'list_customers',
    description: 'List recent customers',
    parameters: { type: 'object', properties: { limit: { type: 'number' } }, required: [] },
  },
  {
    name: 'list_todos',
    description: 'List pending todos',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_summary',
    description: 'Get dashboard summary: customer/supplier/invoice/quotation counts plus P&L',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

// ── Tool Executors ──
async function executeTool(name: string, db: D1Database, userId: string): Promise<string> {
  switch (name) {
    case 'get_counts': {
      const tables = ['customers', 'suppliers', 'products', 'invoices', 'quotations', 'journal_entries', 'todos'];
      const result: Record<string, number> = {};
      for (const t of tables) {
        try {
          const r = await db.prepare(`SELECT COUNT(*) as cnt FROM ${t} WHERE user_id = ?`).bind(userId).first<{cnt:number}>();
          result[t] = r?.cnt || 0;
        } catch { result[t] = 0; }
      }
      return JSON.stringify(result);
    }
    case 'list_invoices': {
      const rows = await db.prepare(
        `SELECT i.invoice_number, i.status, i.total, i.currency, i.issue_date, c.name as customer_name
         FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.user_id = ?
         ORDER BY i.created_at DESC LIMIT 10`
      ).bind(userId).all();
      return JSON.stringify(rows.results);
    }
    case 'list_quotations': {
      const rows = await db.prepare(
        `SELECT q.quotation_number, q.status, q.total, q.currency, q.issue_date, q.valid_until, c.name as customer_name
         FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id WHERE q.user_id = ?
         ORDER BY q.created_at DESC LIMIT 10`
      ).bind(userId).all();
      return JSON.stringify(rows.results);
    }
    case 'list_customers': {
      const rows = await db.prepare(
        'SELECT name, company_name, email, phone, created_at FROM customers WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
      ).bind(userId).all();
      return JSON.stringify(rows.results);
    }
    case 'list_todos': {
      const rows = await db.prepare(
        "SELECT title, priority, due_date FROM todos WHERE user_id = ? AND status = 'pending' ORDER BY sort_order LIMIT 10"
      ).bind(userId).all();
      return JSON.stringify(rows.results);
    }
    case 'get_summary': {
      const counts: Record<string, number> = {};
      for (const t of ['customers','suppliers','products','invoices','quotations','todos']) {
        try {
          const r = await db.prepare(`SELECT COUNT(*) as cnt FROM ${t} WHERE user_id = ?`).bind(userId).first<{cnt:number}>();
          counts[t] = r?.cnt || 0;
        } catch { counts[t] = 0; }
      }
      try {
        const pl = await db.prepare(
          `SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as revenue, COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as expenses
           FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
           WHERE je.user_id = ? AND (jl.account_code LIKE '4%' OR jl.account_code LIKE '5%')`
        ).bind(userId).first<{revenue:number;expenses:number}>();
        if (pl) Object.assign(counts, { revenue: pl.revenue, expenses: pl.expenses, net_income: pl.revenue - pl.expenses });
      } catch {}
      return JSON.stringify(counts);
    }
    default:
      return '{}';
  }
}

// ── POST /api/chat ──
chat.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { message, history } = body;

  if (!message || !c.env.AI) {
    return c.json({ reply: !c.env.AI ? 'AI service not available' : 'Message required' });
  }

  try {
    const messages: { role: string; content: string; tool_calls?: any[] }[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    if (Array.isArray(history)) {
      for (const msg of history.slice(-8)) {
        if (msg.role && msg.content) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    messages.push({ role: 'user', content: message });

    // First call — may return tool_calls
    const response1 = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages,
      tools: TOOLS,
      max_tokens: 300,
      temperature: 0.3,
    });

    const toolCalls = (response1 as any)?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      // Execute tool calls
      for (const tc of toolCalls) {
        const fnName = tc?.function?.name || tc?.name;
        if (fnName) {
          const result = await executeTool(fnName, c.env.DB, user.id);
          messages.push({
            role: 'assistant',
            content: '',
            tool_calls: [tc],
          } as any);
          messages.push({
            role: 'tool',
            content: result,
          } as any);
        }
      }

      // Second call — generate final answer with tool results
      const response2 = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages,
        max_tokens: 400,
        temperature: 0.3,
      });

      const reply = (response2 as any)?.response
        || (response2 as any)?.choices?.[0]?.message?.content
        || (typeof response2 === 'string' ? response2 : '')
        || 'Sorry, I could not process that.';

      return c.json({ reply });
    }

    // No tool calls — direct answer
    const reply = (response1 as any)?.response
      || (response1 as any)?.choices?.[0]?.message?.content
      || (typeof response1 === 'string' ? response1 : '')
      || 'Sorry, I could not process that.';

    return c.json({ reply });
  } catch (e: any) {
    return c.json({ reply: `AI error: ${e.message || 'unknown'}` }, 500);
  }
});

export { chat as chatRoutes };
