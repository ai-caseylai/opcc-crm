import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
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
- When presenting lists, show key fields in a readable format

CRITICAL DELETE RULES:
- NEVER call delete_invoice, delete_quotation, delete_purchase_order, or delete_service_order immediately
- When the user asks to delete something, FIRST list all items that will be deleted (show ID, number, status, amount)
- Then ask the user to confirm by replying "確認" or "yes" before proceeding
- Only after explicit user confirmation should you call the delete function(s)
- If the user does not confirm, do NOT delete anything`;

const TOOLS: any[] = [
  // ── Dashboard / Summary ──
  { type: 'function', function: { name: 'get_counts', description: 'Get counts of all CRM records for the current user', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'get_summary', description: 'Get dashboard summary: customer/supplier/invoice/quotation counts plus P&L (income, expense, net)', parameters: { type: 'object', properties: {}, required: [] } } },

  // ── Customers ──
  { type: 'function', function: { name: 'list_customers', description: 'List recent active customers', parameters: { type: 'object', properties: { limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'search_customers', description: 'Search customers by name, email, or company', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword' }, limit: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'get_customer', description: 'Get customer details by ID', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Customer ID' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'create_customer', description: 'Create a new customer', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Customer name' }, company_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'update_customer', description: 'Update customer fields', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Customer ID' }, name: { type: 'string' }, company_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'delete_customer', description: 'Soft-delete a customer', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Customer ID' } }, required: ['id'] } } },

  // ── Suppliers ──
  { type: 'function', function: { name: 'search_suppliers', description: 'Search suppliers by name or company', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword' }, limit: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'list_suppliers', description: 'List recent active suppliers', parameters: { type: 'object', properties: { limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'get_supplier', description: 'Get supplier details by ID', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Supplier ID' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'create_supplier', description: 'Create a new supplier', parameters: { type: 'object', properties: { name: { type: 'string' }, company_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'update_supplier', description: 'Update supplier fields', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, company_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'delete_supplier', description: 'Soft-delete a supplier', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },

  // ── Products ──
  { type: 'function', function: { name: 'list_products', description: 'List all active products and services', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'search_products', description: 'Search products by name or category', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'create_product', description: 'Create a new product or service', parameters: { type: 'object', properties: { name: { type: 'string' }, unit_price: { type: 'number' }, currency: { type: 'string', description: 'HKD/USD/CNY' }, unit: { type: 'string', description: 'pcs/hr/etc' }, category: { type: 'string' } }, required: ['name', 'unit_price'] } } },
  { type: 'function', function: { name: 'update_product', description: 'Update product fields', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, unit_price: { type: 'number' }, category: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'delete_product', description: 'Soft-delete a product', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },

  // ── Invoices ──
  { type: 'function', function: { name: 'search_invoices', description: 'Search invoices by number or customer name', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword' }, limit: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'list_invoices', description: 'List recent invoices with optional status filter', parameters: { type: 'object', properties: { status: { type: 'string', description: 'draft, sent, paid, overdue' }, limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'get_invoice', description: 'Get full invoice details by ID including line items', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Invoice ID' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'create_invoice', description: 'Create a new invoice', parameters: { type: 'object', properties: { customer_id: { type: 'string' }, invoice_number: { type: 'string' }, items: { type: 'array', description: 'Array of {description, quantity, unit_price, amount}', items: { type: 'object' } }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, currency: { type: 'string' }, notes: { type: 'string' } }, required: ['customer_id'] } } },
  { type: 'function', function: { name: 'update_invoice_status', description: 'Update invoice status (e.g. mark as sent/paid)', parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', description: 'draft, sent, paid, overdue, cancelled' } }, required: ['id', 'status'] } } },
  { type: 'function', function: { name: 'delete_invoice', description: 'Delete an invoice by ID', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Invoice ID' } }, required: ['id'] } } },

  // ── Quotations ──
  { type: 'function', function: { name: 'list_quotations', description: 'List recent quotations with optional status filter', parameters: { type: 'object', properties: { status: { type: 'string', description: 'draft, sent, accepted, rejected, converted' }, limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'get_quotation', description: 'Get quotation details by ID', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'create_quotation', description: 'Create a new quotation', parameters: { type: 'object', properties: { customer_id: { type: 'string' }, quotation_number: { type: 'string' }, items: { type: 'array', description: 'Array of {description, quantity, unit_price, amount}', items: { type: 'object' } }, valid_until: { type: 'string', description: 'YYYY-MM-DD' }, currency: { type: 'string' } }, required: ['customer_id'] } } },
  { type: 'function', function: { name: 'convert_quotation', description: 'Convert a quotation to an invoice', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Quotation ID' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'delete_quotation', description: 'Delete a quotation by ID', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },

  // ── Purchase Orders ──
  { type: 'function', function: { name: 'get_purchase_order', description: 'Get purchase order details by ID', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'list_purchase_orders', description: 'List recent purchase orders with optional status filter', parameters: { type: 'object', properties: { status: { type: 'string', description: 'draft, approved, received, paid, cancelled' }, limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'create_purchase_order', description: 'Create a new purchase order', parameters: { type: 'object', properties: { supplier_id: { type: 'string' }, items: { type: 'array', description: 'Array of {description, quantity, unit_price, amount}', items: { type: 'object' } }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, currency: { type: 'string' }, notes: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'update_purchase_order_status', description: 'Update PO status', parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', description: 'draft, approved, received, paid, cancelled' } }, required: ['id', 'status'] } } },
  { type: 'function', function: { name: 'delete_purchase_order', description: 'Delete a purchase order by ID', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },

  // ── Service Orders ──
  { type: 'function', function: { name: 'get_service_order', description: 'Get service order details by ID', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'list_service_orders', description: 'List recent service orders', parameters: { type: 'object', properties: { status: { type: 'string', description: 'draft, active, completed, cancelled' }, limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'create_service_order', description: 'Create a new service order', parameters: { type: 'object', properties: { customer_id: { type: 'string' }, items: { type: 'array', description: 'Array of {description, quantity, unit_price, amount}', items: { type: 'object' } }, valid_from: { type: 'string', description: 'YYYY-MM-DD' }, valid_until: { type: 'string' }, currency: { type: 'string' } }, required: ['customer_id'] } } },
  { type: 'function', function: { name: 'update_service_order_status', description: 'Update SO status', parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', description: 'draft, active, completed, cancelled' } }, required: ['id', 'status'] } } },
  { type: 'function', function: { name: 'delete_service_order', description: 'Delete a service order by ID', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },

  // ── Services & Bookings ──
  { type: 'function', function: { name: 'list_services', description: 'List all active services', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'create_service', description: 'Create a new service', parameters: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number' }, duration_minutes: { type: 'number' }, category: { type: 'string' } }, required: ['name', 'price'] } } },
  { type: 'function', function: { name: 'update_service', description: 'Update a service', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, price: { type: 'number' }, duration_minutes: { type: 'number' }, category: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'delete_service', description: 'Delete a service', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'list_bookings', description: 'List service bookings', parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: [] } } },
  { type: 'function', function: { name: 'create_booking', description: 'Create a service booking', parameters: { type: 'object', properties: { service_id: { type: 'string' }, customer_id: { type: 'string' }, booking_date: { type: 'string', description: 'YYYY-MM-DD' }, start_time: { type: 'string' }, end_time: { type: 'string' }, notes: { type: 'string' } }, required: ['service_id', 'customer_id', 'booking_date', 'start_time'] } } },

  // ── Todos ──
  { type: 'function', function: { name: 'list_todos', description: 'List pending todos, sorted by priority', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'create_todo', description: 'Create a todo item', parameters: { type: 'object', properties: { title: { type: 'string' }, priority: { type: 'string', description: 'high, medium, low' }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, description: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'update_todo', description: 'Update a todo (complete, edit)', parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', description: 'pending, completed' }, title: { type: 'string' }, priority: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'delete_todo', description: 'Delete a todo item', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },

  // ── Calendar ──
  { type: 'function', function: { name: 'list_calendar_events', description: 'List calendar events for a date range', parameters: { type: 'object', properties: { start: { type: 'string', description: 'YYYY-MM-DD' }, end: { type: 'string', description: 'YYYY-MM-DD' } }, required: [] } } },
  { type: 'function', function: { name: 'create_calendar_event', description: 'Create a calendar event', parameters: { type: 'object', properties: { title: { type: 'string' }, start_time: { type: 'string', description: 'ISO datetime' }, end_time: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' }, customer_id: { type: 'string' } }, required: ['title', 'start_time'] } } },
  { type: 'function', function: { name: 'update_calendar_event', description: 'Update a calendar event', parameters: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'delete_calendar_event', description: 'Delete a calendar event', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },

  // ── Company / Profile ──
  { type: 'function', function: { name: 'get_company', description: 'Get company profile settings', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'update_company', description: 'Update company profile fields', parameters: { type: 'object', properties: { name: { type: 'string' }, address: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, website: { type: 'string' }, tagline: { type: 'string' } }, required: [] } } },

  // ── Bookkeeping / Reports ──
  { type: 'function', function: { name: 'get_bookkeeping', description: 'Get P&L (income statement) for a date range', parameters: { type: 'object', properties: { start_date: { type: 'string', description: 'YYYY-MM-DD' }, end_date: { type: 'string', description: 'YYYY-MM-DD' } }, required: [] } } },
  { type: 'function', function: { name: 'get_bookkeeping_transactions', description: 'Get detailed transactions for a specific account code (e.g. 2102 for Director Loan, 1101 for Cash). Returns each entry with date, description, debit, credit, and running balance.', parameters: { type: 'object', properties: { account_code: { type: 'string', description: 'Account code (e.g. 2102, 1101, 4100)' }, start_date: { type: 'string', description: 'YYYY-MM-DD' }, end_date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['account_code'] } } },
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
    case 'search_invoices': {
      const q = args?.query || '';
      const rows = await db.prepare(
        `SELECT i.id, i.invoice_number, i.status, i.total, i.currency, i.issue_date, c.name as customer_name FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.user_id = ? AND (i.invoice_number LIKE ? OR c.name LIKE ?) ORDER BY i.created_at DESC LIMIT ?`
      ).bind(userId, `%${q}%`, `%${q}%`, limit).all();
      return JSON.stringify(rows.results);
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
    case 'search_suppliers': {
      const q = args?.query || '';
      const rows = await db.prepare(
        'SELECT id, name, company_name, email, phone FROM suppliers WHERE user_id = ? AND is_active = 1 AND (name LIKE ? OR company_name LIKE ? OR email LIKE ?) ORDER BY name LIMIT ?'
      ).bind(userId, `%${q}%`, `%${q}%`, `%${q}%`, limit).all();
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
      // Try journal entries first
      try {
        const jlRows = await db.prepare(
          "SELECT a.account_code as code, a.account_name as name, a.account_type as type, SUM(COALESCE(jl.debit,0)) as total_debit, SUM(COALESCE(jl.credit,0)) as total_credit FROM journal_lines jl JOIN accounts a ON jl.account_code = a.account_code JOIN journal_entries je ON jl.entry_id = je.id WHERE je.user_id = ? AND je.entry_date BETWEEN ? AND ? GROUP BY a.account_code, a.account_name, a.account_type ORDER BY a.account_code"
        ).bind(userId, startDate, endDate).all();
        if (jlRows.results.length > 0) return JSON.stringify(jlRows.results);
      } catch {}
      // Fallback: bank transactions
      try {
        const deposits = await db.prepare(
          'SELECT COALESCE(SUM(deposit_amount),0) as total FROM bank_transactions WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ?'
        ).bind(userId, startDate, endDate).first<{ total: number }>();
        const withdrawals = await db.prepare(
          'SELECT COALESCE(SUM(withdrawal_amount),0) as total FROM bank_transactions WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ?'
        ).bind(userId, startDate, endDate).first<{ total: number }>();
        return JSON.stringify([
          { code: 'REV', name: 'Revenue (Bank Deposits)', type: 'revenue', total_credit: deposits?.total || 0 },
          { code: 'EXP', name: 'Expenses (Bank Withdrawals)', type: 'expense', total_debit: withdrawals?.total || 0 },
          { code: 'NET', name: 'Net Income', type: 'equity', total_credit: (deposits?.total || 0) - (withdrawals?.total || 0) },
        ]);
      } catch {
        return JSON.stringify([]);
      }
    }
    case 'get_bookkeeping_transactions': {
      const accountCode = args?.account_code || '';
      if (!accountCode) return JSON.stringify({ error: 'account_code is required' });
      const startDate = args?.start_date || '2000-01-01';
      const endDate = args?.end_date || '2099-12-31';
      // Get account info
      const acct = await db.prepare('SELECT account_code, account_name, account_type FROM accounts WHERE user_id = ? AND account_code = ?').bind(userId, accountCode).first();
      if (!acct) return JSON.stringify({ error: `Account ${accountCode} not found` });
      // Get all lines for this account within date range, ordered by date
      const rows = await db.prepare(
        `SELECT je.entry_date, je.entry_number, je.description as entry_description, jl.account_code, jl.account_name, jl.description as line_description, jl.debit, jl.credit
         FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
         WHERE je.user_id = ? AND jl.account_code = ? AND je.entry_date BETWEEN ? AND ? AND je.status = 'posted'
         ORDER BY je.entry_date ASC, je.created_at ASC`
      ).bind(userId, accountCode, startDate, endDate).all();
      let balance = 0;
      const txns = (rows.results as any[]).map(r => {
        const dr = Number(r.debit) || 0;
        const cr = Number(r.credit) || 0;
        balance += dr - cr;
        return { date: r.entry_date, entry: r.entry_number, description: r.entry_description, line_desc: r.line_description, debit: dr, credit: cr, balance };
      });
      return JSON.stringify({ account: { code: acct.account_code, name: acct.account_name, type: acct.account_type }, total_debit: txns.reduce((s, t) => s + t.debit, 0), total_credit: txns.reduce((s, t) => s + t.credit, 0), closing_balance: balance, transactions: txns });
    }
    case 'get_recent_activity': {
      const rows = await db.prepare(
        "SELECT action, entity_type, entity_id, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
      ).bind(userId, limit).all();
      return JSON.stringify(rows.results);
    }

    // ── Customers CRUD ──
    case 'create_customer': {
      const id = `c-${uuidv4().slice(0, 8)}`;
      await db.prepare('INSERT INTO customers (id, user_id, name, company_name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, userId, args.name, args.company_name || null, args.email || null, args.phone || null, args.address || null).run();
      const row = await db.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
      return JSON.stringify({ success: true, customer: row });
    }
    case 'update_customer': {
      const fields = ['name', 'company_name', 'email', 'phone', 'address'];
      const sets: string[] = [];
      const params: any[] = [];
      for (const f of fields) {
        if (args[f] !== undefined) { sets.push(`${f} = ?`); params.push(args[f]); }
      }
      if (sets.length === 0) return JSON.stringify({ error: 'No fields to update' });
      sets.push("updated_at = datetime('now')");
      params.push(args.id, userId);
      await db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
      const row = await db.prepare('SELECT * FROM customers WHERE id = ?').bind(args.id).first();
      return JSON.stringify({ success: true, customer: row });
    }
    case 'delete_customer': {
      await db.prepare('UPDATE customers SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?').bind(args.id, userId).run();
      return JSON.stringify({ success: true, deleted: args.id });
    }

    // ── Suppliers CRUD ──
    case 'get_supplier': {
      const row = await db.prepare('SELECT * FROM suppliers WHERE id = ? AND user_id = ?').bind(args.id, userId).first();
      if (!row) return JSON.stringify({ error: 'Supplier not found' });
      return JSON.stringify(row);
    }
    case 'create_supplier': {
      const id = `s-${uuidv4().slice(0, 8)}`;
      await db.prepare('INSERT INTO suppliers (id, user_id, name, company_name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, userId, args.name, args.company_name || null, args.email || null, args.phone || null, args.address || null).run();
      const row = await db.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first();
      return JSON.stringify({ success: true, supplier: row });
    }
    case 'update_supplier': {
      const fields = ['name', 'company_name', 'email', 'phone', 'address'];
      const sets: string[] = [];
      const params: any[] = [];
      for (const f of fields) {
        if (args[f] !== undefined) { sets.push(`${f} = ?`); params.push(args[f]); }
      }
      if (sets.length === 0) return JSON.stringify({ error: 'No fields to update' });
      sets.push("updated_at = datetime('now')");
      params.push(args.id, userId);
      await db.prepare(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
      const row = await db.prepare('SELECT * FROM suppliers WHERE id = ?').bind(args.id).first();
      return JSON.stringify({ success: true, supplier: row });
    }
    case 'delete_supplier': {
      await db.prepare('UPDATE suppliers SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?').bind(args.id, userId).run();
      return JSON.stringify({ success: true, deleted: args.id });
    }

    // ── Products CRUD ──
    case 'create_product': {
      const id = `p-${uuidv4().slice(0, 8)}`;
      await db.prepare('INSERT INTO products (id, user_id, name, unit_price, currency, unit, category) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, userId, args.name, args.unit_price || 0, args.currency || 'HKD', args.unit || 'pcs', args.category || null).run();
      const row = await db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
      return JSON.stringify({ success: true, product: row });
    }
    case 'update_product': {
      const fields = ['name', 'unit_price', 'currency', 'unit', 'category'];
      const sets: string[] = [];
      const params: any[] = [];
      for (const f of fields) {
        if (args[f] !== undefined) { sets.push(`${f} = ?`); params.push(args[f]); }
      }
      if (sets.length === 0) return JSON.stringify({ error: 'No fields to update' });
      sets.push("updated_at = datetime('now')");
      params.push(args.id, userId);
      await db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
      const row = await db.prepare('SELECT * FROM products WHERE id = ?').bind(args.id).first();
      return JSON.stringify({ success: true, product: row });
    }
    case 'delete_product': {
      await db.prepare('UPDATE products SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?').bind(args.id, userId).run();
      return JSON.stringify({ success: true, deleted: args.id });
    }

    // ── Invoices Create / Status ──
    case 'create_invoice': {
      const id = `i-${uuidv4().slice(0, 8)}`;
      const items: any[] = args.items || [];
      const subtotal = items.reduce((s: number, i: any) => s + (i.amount || (i.quantity || 1) * (i.unit_price || 0)), 0);
      const invNum = args.invoice_number || `INV-${Date.now().toString(36).toUpperCase()}`;
      await db.prepare(
        'INSERT INTO invoices (id, user_id, invoice_number, customer_id, issue_date, due_date, subtotal, total, currency, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, userId, invNum, args.customer_id, args.issue_date || new Date().toISOString().split('T')[0], args.due_date || null, subtotal, subtotal, args.currency || 'HKD', args.notes || null).run();
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        await db.prepare('INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(`ii-${uuidv4().slice(0, 8)}`, id, it.description, it.quantity || 1, it.unit_price || 0, it.amount || 0, idx).run();
      }
      const row = await db.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first();
      return JSON.stringify({ success: true, invoice: row });
    }
    case 'update_invoice_status': {
      await db.prepare("UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").bind(args.status, args.id, userId).run();
      if (args.status === 'paid') await db.prepare("UPDATE invoices SET paid_date = datetime('now') WHERE id = ?").bind(args.id).run();
      return JSON.stringify({ success: true, id: args.id, status: args.status });
    }

    // ── Quotations Create / Get / Convert ──
    case 'get_quotation': {
      const row = await db.prepare('SELECT q.*, c.name as customer_name FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id WHERE q.id = ? AND q.user_id = ?').bind(args.id, userId).first();
      if (!row) return JSON.stringify({ error: 'Quotation not found' });
      const items = await db.prepare('SELECT description, quantity, unit_price, amount FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order').bind(args.id).all();
      return JSON.stringify({ ...row, items: items.results });
    }
    case 'create_quotation': {
      const id = `q-${uuidv4().slice(0, 8)}`;
      const items: any[] = args.items || [];
      const subtotal = items.reduce((s: number, i: any) => s + (i.amount || (i.quantity || 1) * (i.unit_price || 0)), 0);
      const qNum = args.quotation_number || `QUO-${Date.now().toString(36).toUpperCase()}`;
      await db.prepare(
        'INSERT INTO quotations (id, user_id, quotation_number, customer_id, issue_date, valid_until, subtotal, total, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, userId, qNum, args.customer_id, new Date().toISOString().split('T')[0], args.valid_until || null, subtotal, subtotal, args.currency || 'HKD').run();
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        await db.prepare('INSERT INTO quotation_items (id, quotation_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(`qi-${uuidv4().slice(0, 8)}`, id, it.description, it.quantity || 1, it.unit_price || 0, it.amount || 0, idx).run();
      }
      const row = await db.prepare('SELECT * FROM quotations WHERE id = ?').bind(id).first();
      return JSON.stringify({ success: true, quotation: row });
    }
    case 'convert_quotation': {
      const quo = await db.prepare('SELECT * FROM quotations WHERE id = ? AND user_id = ?').bind(args.id, userId).first<any>();
      if (!quo) return JSON.stringify({ error: 'Quotation not found' });
      const invId = `i-${uuidv4().slice(0, 8)}`;
      const invNum = `INV-${Date.now().toString(36).toUpperCase()}`;
      await db.prepare('INSERT INTO invoices (id, user_id, invoice_number, customer_id, issue_date, due_date, subtotal, total, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(invId, userId, invNum, quo.customer_id, new Date().toISOString().split('T')[0], null, quo.subtotal, quo.total, quo.currency).run();
      const qItems = await db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').bind(args.id).all();
      for (const qi of qItems.results as any[]) {
        await db.prepare('INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(`ii-${uuidv4().slice(0, 8)}`, invId, qi.description, qi.quantity, qi.unit_price, qi.amount, qi.sort_order).run();
      }
      await db.prepare("UPDATE quotations SET status = 'converted', converted_invoice_id = ? WHERE id = ?").bind(invId, args.id).run();
      return JSON.stringify({ success: true, invoice_id: invId, invoice_number: invNum });
    }

    // ── Purchase Orders Create / Status ──
    case 'create_purchase_order': {
      const id = `po-${uuidv4().slice(0, 8)}`;
      const items: any[] = args.items || [];
      const subtotal = items.reduce((s: number, i: any) => s + (i.amount || (i.quantity || 1) * (i.unit_price || 0)), 0);
      const poNum = args.po_number || `PO-${Date.now().toString(36).toUpperCase()}`;
      await db.prepare(
        'INSERT INTO purchase_orders (id, user_id, po_number, supplier_id, issue_date, due_date, subtotal, total, currency, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, userId, poNum, args.supplier_id || null, new Date().toISOString().split('T')[0], args.due_date || null, subtotal, subtotal, args.currency || 'HKD', args.notes || null).run();
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        await db.prepare('INSERT INTO purchase_order_items (id, po_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(`poi-${uuidv4().slice(0, 8)}`, id, it.description, it.quantity || 1, it.unit_price || 0, it.amount || 0, idx).run();
      }
      const row = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(id).first();
      return JSON.stringify({ success: true, purchase_order: row });
    }
    case 'get_purchase_order': {
      const row = await db.prepare('SELECT po.*, s.name as supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id WHERE po.id = ? AND po.user_id = ?').bind(args.id, userId).first();
      if (!row) return JSON.stringify({ error: 'Purchase order not found' });
      const items = await db.prepare('SELECT description, quantity, unit_price, amount FROM purchase_order_items WHERE po_id = ? ORDER BY sort_order').bind(args.id).all();
      return JSON.stringify({ ...row, items: items.results });
    }
    case 'update_purchase_order_status': {
      await db.prepare("UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").bind(args.status, args.id, userId).run();
      if (args.status === 'paid') await db.prepare("UPDATE purchase_orders SET paid_date = datetime('now') WHERE id = ?").bind(args.id).run();
      return JSON.stringify({ success: true, id: args.id, status: args.status });
    }

    // ── Service Orders Create / Status ──
    case 'list_service_orders': {
      let q = `SELECT so.id, so.so_number, so.status, so.total, so.currency, so.issue_date, so.valid_from, so.valid_until, c.name as customer_name FROM service_orders so LEFT JOIN customers c ON so.customer_id = c.id WHERE so.user_id = ?`;
      const params: any[] = [userId];
      if (args?.status) { q += ' AND so.status = ?'; params.push(args.status); }
      q += ' ORDER BY so.created_at DESC LIMIT ?'; params.push(limit);
      const rows = await db.prepare(q).bind(...params).all();
      return JSON.stringify(rows.results);
    }
    case 'create_service_order': {
      const id = `so-${uuidv4().slice(0, 8)}`;
      const items: any[] = args.items || [];
      const subtotal = items.reduce((s: number, i: any) => s + (i.amount || (i.quantity || 1) * (i.unit_price || 0)), 0);
      const soNum = args.so_number || `SO-${Date.now().toString(36).toUpperCase()}`;
      await db.prepare(
        'INSERT INTO service_orders (id, user_id, so_number, customer_id, issue_date, valid_from, valid_until, subtotal, total, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, userId, soNum, args.customer_id, new Date().toISOString().split('T')[0], args.valid_from || null, args.valid_until || null, subtotal, subtotal, args.currency || 'HKD').run();
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        await db.prepare('INSERT INTO service_order_items (id, so_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(`soi-${uuidv4().slice(0, 8)}`, id, it.description, it.quantity || 1, it.unit_price || 0, it.amount || 0, idx).run();
      }
      const row = await db.prepare('SELECT * FROM service_orders WHERE id = ?').bind(id).first();
      return JSON.stringify({ success: true, service_order: row });
    }
    case 'get_service_order': {
      const row = await db.prepare('SELECT so.*, c.name as customer_name FROM service_orders so LEFT JOIN customers c ON so.customer_id = c.id WHERE so.id = ? AND so.user_id = ?').bind(args.id, userId).first();
      if (!row) return JSON.stringify({ error: 'Service order not found' });
      const items = await db.prepare('SELECT description, quantity, unit_price, amount FROM service_order_items WHERE so_id = ? ORDER BY sort_order').bind(args.id).all();
      return JSON.stringify({ ...row, items: items.results });
    }
    case 'update_service_order_status': {
      await db.prepare("UPDATE service_orders SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").bind(args.status, args.id, userId).run();
      return JSON.stringify({ success: true, id: args.id, status: args.status });
    }

    // ── Services & Bookings ──
    case 'list_services': {
      const rows = await db.prepare('SELECT id, name, category, price, duration_minutes FROM services WHERE user_id = ? AND is_active = 1 ORDER BY name').bind(userId).all();
      return JSON.stringify(rows.results);
    }
    case 'create_service': {
      const id = `svc-${uuidv4().slice(0, 8)}`;
      await db.prepare('INSERT INTO services (id, user_id, name, price, duration_minutes, category) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, userId, args.name, args.price || 0, args.duration_minutes || 60, args.category || 'general').run();
      return JSON.stringify({ success: true, id });
    }
    case 'update_service': {
      const fields = ['name', 'price', 'duration_minutes', 'category'];
      const sets: string[] = [];
      const params: any[] = [];
      for (const f of fields) {
        if (args[f] !== undefined) { sets.push(`${f} = ?`); params.push(args[f]); }
      }
      if (sets.length === 0) return JSON.stringify({ error: 'No fields to update' });
      sets.push("updated_at = datetime('now')");
      params.push(args.id, userId);
      await db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
      return JSON.stringify({ success: true, id: args.id });
    }
    case 'delete_service': {
      await db.prepare('UPDATE services SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?').bind(args.id, userId).run();
      return JSON.stringify({ success: true, deleted: args.id });
    }
    case 'list_bookings': {
      let q = 'SELECT sb.*, s.name as service_name, c.name as customer_name FROM service_bookings sb JOIN services s ON sb.service_id = s.id LEFT JOIN customers c ON sb.customer_id = c.id WHERE sb.user_id = ?';
      const params: any[] = [userId];
      if (args?.date) { q += ' AND sb.booking_date = ?'; params.push(args.date); }
      q += ' ORDER BY sb.booking_date DESC, sb.start_time LIMIT ?'; params.push(limit);
      const rows = await db.prepare(q).bind(...params).all();
      return JSON.stringify(rows.results);
    }
    case 'create_booking': {
      const id = `bk-${uuidv4().slice(0, 8)}`;
      await db.prepare('INSERT INTO service_bookings (id, user_id, service_id, customer_id, booking_date, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, userId, args.service_id, args.customer_id, args.booking_date, args.start_time, args.end_time || null, args.notes || null).run();
      return JSON.stringify({ success: true, id });
    }

    // ── Todos CRUD ──
    case 'create_todo': {
      const id = `td-${uuidv4().slice(0, 8)}`;
      await db.prepare('INSERT INTO todos (id, user_id, title, description, priority, due_date) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, userId, args.title, args.description || null, args.priority || 'medium', args.due_date || null).run();
      return JSON.stringify({ success: true, id, title: args.title });
    }
    case 'update_todo': {
      const fields = ['title', 'description', 'status', 'priority', 'due_date'];
      const sets: string[] = [];
      const params: any[] = [];
      for (const f of fields) {
        if (args[f] !== undefined) { sets.push(`${f} = ?`); params.push(args[f]); }
      }
      if (sets.length === 0) return JSON.stringify({ error: 'No fields to update' });
      params.push(args.id, userId);
      await db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
      return JSON.stringify({ success: true, id: args.id });
    }
    case 'delete_todo': {
      await db.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').bind(args.id, userId).run();
      return JSON.stringify({ success: true, deleted: args.id });
    }

    // ── Calendar ──
    case 'list_calendar_events': {
      const start = args?.start || new Date().toISOString().split('T')[0];
      const end = args?.end || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
      const rows = await db.prepare('SELECT id, title, event_type, start_time, end_time, all_day, status, location FROM calendar_events WHERE user_id = ? AND start_time BETWEEN ? AND ? ORDER BY start_time')
        .bind(userId, start, end).all();
      return JSON.stringify(rows.results);
    }
    case 'create_calendar_event': {
      const id = `evt-${uuidv4().slice(0, 8)}`;
      await db.prepare('INSERT INTO calendar_events (id, user_id, title, start_time, end_time, description, location, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, userId, args.title, args.start_time, args.end_time || null, args.description || null, args.location || null, args.customer_id || null).run();
      return JSON.stringify({ success: true, id, title: args.title });
    }
    case 'update_calendar_event': {
      const fields = ['title', 'start_time', 'end_time', 'description', 'location', 'status'];
      const sets: string[] = [];
      const params: any[] = [];
      for (const f of fields) {
        if (args[f] !== undefined) { sets.push(`${f} = ?`); params.push(args[f]); }
      }
      if (sets.length === 0) return JSON.stringify({ error: 'No fields to update' });
      sets.push("updated_at = datetime('now')");
      params.push(args.id, userId);
      await db.prepare(`UPDATE calendar_events SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
      return JSON.stringify({ success: true, id: args.id });
    }
    case 'delete_calendar_event': {
      await db.prepare('DELETE FROM calendar_events WHERE id = ? AND user_id = ?').bind(args.id, userId).run();
      return JSON.stringify({ success: true, deleted: args.id });
    }

    // ── Company ──
    case 'get_company': {
      const row = await db.prepare('SELECT * FROM company_settings WHERE user_id = ?').bind(userId).first();
      if (!row) return JSON.stringify({ error: 'Company not configured' });
      return JSON.stringify(row);
    }
    case 'update_company': {
      const fields = ['name', 'address', 'phone', 'email', 'website', 'tagline', 'legal_name', 'short_name', 'tax_id'];
      const sets: string[] = [];
      const params: any[] = [];
      for (const f of fields) {
        if (args[f] !== undefined) { sets.push(`${f} = ?`); params.push(args[f]); }
      }
      if (sets.length === 0) return JSON.stringify({ error: 'No fields to update' });
      sets.push("updated_at = datetime('now')");
      params.push(userId);
      await db.prepare(`UPDATE company_settings SET ${sets.join(', ')} WHERE user_id = ?`).bind(...params).run();
      return JSON.stringify({ success: true });
    }

    default:
      return '{}';
  }
}

async function callDeepSeek(apiKey: string, messages: any[], tools?: any[]): Promise<any> {
  const body: any = {
    model: 'deepseek-chat',
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

// ── Chat Sessions ──

// List sessions
chat.get('/sessions', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT id, title, created_at, updated_at FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50'
  ).bind(user.id).all();
  return c.json({ data: rows.results });
});

// Get session with messages
chat.get('/sessions/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const session = await c.env.DB.prepare(
    'SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first();
  if (!session) return c.json({ error: 'Session not found' }, 404);
  const msgs = await c.env.DB.prepare(
    'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC'
  ).bind(id).all();
  return c.json({ ...session, messages: msgs.results });
});

// Delete session
chat.delete('/sessions/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?)').bind(id, user.id).run();
  await c.env.DB.prepare('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return c.json({ success: true });
});

// ── Chat (send message) ──

chat.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { message, history, file, session_id } = body;

  if (!message && !file) return c.json({ reply: 'Message required' });

  const apiKey = c.env.DEEPSEEK_API_KEY;
  if (!apiKey) return c.json({ reply: 'DeepSeek API key not configured' });

  const db = c.env.DB;

  // Get or create session
  let sid = session_id || '';
  if (sid) {
    const existing = await db.prepare('SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?').bind(sid, user.id).first();
    if (!existing) sid = '';
  }
  if (!sid) {
    sid = `cs-${uuidv4().slice(0, 8)}`;
    await db.prepare('INSERT INTO chat_sessions (id, user_id, title) VALUES (?, ?, ?)').bind(sid, user.id, '').run();
  }

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

  // Save user message
  const userMsgId = `cm-${uuidv4().slice(0, 8)}`;
  await db.prepare('INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').bind(userMsgId, sid, 'user', userMessage).run();

  // Auto-title from first message
  const existingTitle = await db.prepare('SELECT title FROM chat_sessions WHERE id = ?').bind(sid).first<{ title: string }>();
  if (existingTitle && !existingTitle.title) {
    const title = userMessage.slice(0, 60).replace(/\n/g, ' ');
    await db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').bind(title, sid).run();
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const systemPrompt = SYSTEM_PROMPT + `\n\nCurrent date: ${today}`;
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(history)) {
      for (const msg of history.slice(-8)) {
        if (msg.role && msg.content) messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: 'user', content: userMessage });

    const response1 = await callDeepSeek(apiKey, messages, TOOLS);
    const choice = response1.choices?.[0];
    const toolCalls = choice?.message?.tool_calls;

    let reply: string;

    if (toolCalls && toolCalls.length > 0) {
      messages.push(choice.message);
      for (const tc of toolCalls) {
        const fnName = tc.function?.name;
        let fnArgs: any = {};
        try { fnArgs = JSON.parse(tc.function?.arguments || '{}'); } catch {}
        const result = fnName ? await executeTool(fnName, db, user.id, fnArgs) : '{}';
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }

      const response2 = await callDeepSeek(apiKey, messages);
      reply = response2.choices?.[0]?.message?.content || 'Sorry, I could not process that.';
    } else {
      reply = choice?.message?.content || 'Sorry, I could not process that.';

      // Handle DSML or XML-like tool calls in text (fallback for models without structured tool calling)
      // Broad match: any tag containing "DSML" or "tool_call"
      const tagPattern = /<[^>]*DSML[^>]*>|<[^>]*tool_call[^>]*>/i;
      const hasToolTags = tagPattern.test(reply);

      if (hasToolTags) {
        // Try to extract function name and parameters from various formats
        const toolResults: string[] = [];

        // Pattern 1: <...invoke name="fnName">...<...parameter name="key">value</...>...</...invoke>
        const invokePattern = /<[^>]*invoke\s+name="(\w+)"[^>]*>([\s\S]*?)<\/[^>]*invoke>/gi;
        let im;
        while ((im = invokePattern.exec(reply)) !== null) {
          const fnName = im[1];
          const paramPattern = /<[^>]*parameter\s+name="(\w+)"[^>]*>([\s\S]*?)<\/[^>]*parameter>/gi;
          const fnArgs: Record<string, string> = {};
          let pm;
          while ((pm = paramPattern.exec(im[2])) !== null) {
            fnArgs[pm[1]] = pm[2].trim();
          }
          const result = await executeTool(fnName, db, user.id, fnArgs);
          toolResults.push(`${fnName}: ${result}`);
        }

        // Strip all DSML/tool_call tags from reply
        const cleanReply = reply
          .replace(/<[^>]*DSML[^>]*>[\s\S]*?(<\/[^>]*DSML[^>]*>)?/gi, '')
          .replace(/<[^>]*tool_call[^>]*>[\s\S]*?(<\/[^>]*tool_call[^>]*>)?/gi, '')
          .replace(/<[^>]*invoke[^>]*>[\s\S]*?<\/[^>]*invoke>/gi, '')
          .replace(/<[^>]*parameter[^>]*>[\s\S]*?<\/[^>]*parameter>/gi, '')
          .trim();

        if (toolResults.length > 0) {
          messages.push({ role: 'assistant', content: cleanReply });
          messages.push({ role: 'user', content: `[Tool results]\n${toolResults.join('\n')}\n\nPlease summarize the results concisely.` });
          const resp2 = await callDeepSeek(apiKey, messages);
          reply = resp2.choices?.[0]?.message?.content || cleanReply || 'Done.';
        } else {
          reply = cleanReply || 'Done.';
        }
      }
    }

    // Save assistant reply
    const asstMsgId = `cm-${uuidv4().slice(0, 8)}`;
    await db.prepare('INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').bind(asstMsgId, sid, 'assistant', reply).run();
    await db.prepare("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?").bind(sid).run();

    return c.json({ reply, session_id: sid });
  } catch (e: any) {
    return c.json({ reply: `AI error: ${e.message || 'unknown'}` }, 500);
  }
});

export { chat as chatRoutes };
