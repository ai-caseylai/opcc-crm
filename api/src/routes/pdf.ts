import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { generateInvoicePDF } from '../lib/pdf-gen';
import type { InvoiceData } from '../lib/invoice-template';

const pdf = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function buildPayload(doc: Record<string, any>, items: any[], type: string): InvoiceData {
  const isInvoice = type === 'invoice';
  return {
    type: isInvoice ? 'invoice' : 'quotation',
    invoice_no: isInvoice ? (doc.invoice_number || '') : (doc.quotation_number || ''),
    invoice_date: (doc.issue_date || '').replace(/-/g, '/'),
    customer_en: doc.customer_name || '',
    customer_zh: doc.customer_company || '',
    attn: doc.customer_name || '',
    tel: doc.customer_phone || '',
    address: doc.customer_address || '',
    items: items.map((it: any, idx: number) => ({
      no: idx + 1,
      desc: it.description || '',
      qty: Number(it.quantity || 0),
      unit_price: Number(it.unit_price || 0),
    })),
    payment_terms: doc.terms || 'COD',
  };
}

pdf.get('/:type/:id', async (c) => {
  const { type, id } = c.req.param('type') ? { type: c.req.param('type'), id: c.req.param('id') } : { type: '', id: '' };
  if (type !== 'invoice' && type !== 'quotation') {
    return c.json({ error: 'Type must be invoice or quotation' }, 400);
  }

  const db = c.env.DB;
  const table = type === 'invoice' ? 'invoices' : 'quotations';
  const itemsTable = type === 'invoice' ? 'invoice_items' : 'quotation_items';

  const doc = await db.prepare(
    `SELECT d.*, c.name as customer_name, c.email as customer_email, c.company_name as customer_company, c.address as customer_address, c.phone as customer_phone FROM ${table} d JOIN customers c ON d.customer_id = c.id WHERE d.id = ?`
  ).bind(id).first();

  if (!doc) return c.json({ error: 'Not found' }, 404);

  const items = await db.prepare(
    `SELECT * FROM ${itemsTable} WHERE ${type}_id = ? ORDER BY sort_order`
  ).bind(id).all();

  // Load company settings for header/footer (filter by tenant)
  const company = await db.prepare("SELECT * FROM company_settings WHERE user_id = ? LIMIT 1").bind((doc as any).user_id).first<Record<string, string>>();

  const payload = buildPayload(doc as Record<string, any>, items.results as any[], type);
  payload.company_name = (company as any)?.name || 'OPCC';
  payload.company_address1 = (company as any)?.address || 'Hong Kong';
  payload.company_address2 = (company as any)?.address2 || (company as any)?.website || '';
  payload.company_contact = `Tel: ${(company as any)?.phone || ''}  Email: ${(company as any)?.email || ''}`;
  payload.signatory_name = (company as any)?.signatory_name || '';
  payload.bank_info = (company as any)?.bank_name ? `${(company as any).bank_name} . Acc#: ${(company as any)?.bank_account || ''}` : '';
  payload.bank_swift = (company as any)?.bank_swift || '';
  payload.bank_name = (company as any)?.bank_name || '';
  payload.bank_address = (company as any)?.bank_address || '';

  const num = doc[type === 'invoice' ? 'invoice_number' : 'quotation_number'] as string;

  try {
    const pdfBytes = await generateInvoicePDF(c.env.FILE_BUCKET, payload, (doc as any).user_id);
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(num || type)}.pdf"`,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'PDF generation failed', details: err.message }, 500);
  }
});

export { pdf as pdfRoutes };
