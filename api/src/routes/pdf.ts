import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const pdf = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const PDF_WORKER_URL = 'https://pdf-invoice.techforliving.net/generate';

async function callPdfWorker(payload: Record<string, any>): Promise<Response | null> {
  try {
    const r = await fetch(PDF_WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (r.ok) return r;
  } catch (e) { console.error('pdf-invoice-worker error:', e); }
  return null;
}

async function buildPayload(doc: any, items: any[], type: string, db: D1Database) {
  const row = await db.prepare("SELECT * FROM company_settings LIMIT 1").first<Record<string,string>>();
  const c = row || {};
  const isInvoice = type === 'invoice';
  return {
    type: isInvoice ? 'invoice' : 'quotation',
    invoice_no: isInvoice ? (doc.invoice_number || '') : (doc.quotation_number || ''),
    invoice_date: (doc.issue_date || '').replace(/-/g, '/'),
    customer_en: doc.customer_name || '', customer_zh: doc.customer_company || '',
    attn: doc.customer_name || '', tel: doc.customer_phone || '', address: doc.customer_address || '',
    items: items.map((it: any, idx: number) => ({ no: idx+1, desc: it.description||'', qty: Number(it.quantity||0), unit_price: Number(it.unit_price||0) })),
    payment_terms: doc.terms || 'COD',
    company_name: c.name || 'OPCC', company_address1: c.address || 'Hong Kong',
    company_address2: c.website || '', company_contact: `Tel: ${c.phone||''}  Email: ${c.email||''}`,
    signatory_name: c.signatory_name || '',
    bank_info: c.bank_name ? `${c.bank_name} . Acc#: ${c.bank_account||''}` : '',
    bank_swift: c.bank_swift || '', bank_name: c.bank_name || '', bank_address: c.bank_address || '',
  };
}

pdf.get('/:type/:id', async (c) => {
  const db = c.env.DB; const type = c.req.param('type'); const id = c.req.param('id');
  if (type !== 'invoice' && type !== 'quotation') return c.json({ error: 'Type must be invoice or quotation' }, 400);

  const table = type === 'invoice' ? 'invoices' : 'quotations';
  const itemsTable = type === 'invoice' ? 'invoice_items' : 'quotation_items';
  const doc = await db.prepare(
    `SELECT d.*, c.name as customer_name, c.email as customer_email, c.company_name as customer_company, c.address as customer_address, c.phone as customer_phone FROM ${table} d JOIN customers c ON d.customer_id = c.id WHERE d.id = ?`
  ).bind(id).first();
  if (!doc) return c.json({ error: 'Not found' }, 404);

  const items = await db.prepare(`SELECT * FROM ${itemsTable} WHERE ${type}_id = ? ORDER BY sort_order`).bind(id).all();
  const num = doc[type==='invoice'?'invoice_number':'quotation_number'] as string;

  const payload = await buildPayload(doc as any, items.results as any[], type, db);
  const ext = await callPdfWorker(payload);
  if (ext) return new Response(ext.body, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${encodeURIComponent(num||type)}.pdf"` } });

  // fallback
  const esc = (s:string)=>(s||'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const label=type==='invoice'?'INVOICE':'QUOTATION'; const cur=doc.currency||'HKD'; const tot=(doc.total||0).toFixed(2);
  const dt=doc.issue_date||''; const dd=doc.due_date||doc.valid_until||'';
  const objs:string[]=[]; let oid=1;
  function ao(c:string){objs.push(`${oid} 0 obj\n${c}\nendobj`);return oid++;}
  const f1=ao('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const f2=ao('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pid=ao('<< /Type /Pages /Kids [] /Count 0 >>');
  const pgs:number[]=[];
  function bp(){
    const c2:string[]=[];let y=750;
    function dt2(t:string,x:number,s:number,b:boolean,r=0,g=0,k=0){c2.push(`BT\n/${b?'F2':'F1'} ${s} Tf\n${r} ${g} ${k} rg\n${x} ${y} Td\n(${esc(t)}) Tj\nET`);}
    dt2('OPCC CRM',50,22,true,0.15,0.39,0.92);dt2('opcc-crm.techforliving.net',50,8,false,0.5,0.5,0.5);y-=30;
    dt2(label,395,20,true,0.15,0.39,0.92);dt2(`#${doc[type==='invoice'?'invoice_number':'quotation_number']||''}`,395,12,true);y-=35;
    const mx=400;dt2(`Date: ${dt}`,mx,9,false,0.4,0.4,0.4);y-=13;
    if(dd){dt2(`${type==='invoice'?'Due:':'Valid:'} ${dd}`,mx,9,false,0.4,0.4,0.4);y-=13;}
    dt2(`Status: ${doc.status||'-'}`,mx,9,false,0.4,0.4,0.4);y-=15;y-=30;
    dt2('Customer',50,9,true,0.6,0.6,0.6);y-=14;dt2(esc(doc.customer_name||''),50,12,true);y-=14;
    if(doc.customer_company){dt2(esc(doc.customer_company),50,9,false);y-=12;}
    if(doc.customer_email){dt2(esc(doc.customer_email),50,9,false);y-=12;}y-=20;
    const cx=[50,330,400,470,545];c2.push(`${0.95} ${0.95} ${0.95} rg\n50 ${y-4} 495 18 re f`);
    dt2('Description',cx[0]+4,8,true,0.4,0.4,0.4);dt2('Qty',cx[1],8,true,0.4,0.4,0.4);
    dt2('Unit Price',cx[2],8,true,0.4,0.4,0.4);dt2('Amount',cx[4]-40,8,true,0.4,0.4,0.4);y-=20;
    for(const it of items.results as any[]){
      if(y<150){pgs.push(ao(`<< /Type /Page /Parent ${pid} 0 R /MediaBox [0 0 595 842] /Contents ${ao(`<< /Length ${c2.join('\n').length} >>\nstream\n${c2.join('\n')}\nendstream`)} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`));c2.length=0;y=750;}
      dt2(esc(it.description||'').substring(0,50),cx[0]+4,9,false);dt2(String(it.quantity||0),cx[1],9,false);
      dt2(`${cur} ${(it.unit_price||0).toFixed(2)}`,cx[2],9,false);dt2(`${cur} ${(it.amount||0).toFixed(2)}`,cx[4]-40,9,false);y-=16;
    }
    y-=10;c2.push(`${0.7} ${0.7} ${0.7} RG 1.5 w\n${cx[2]-30} ${y} m ${cx[4]} ${y} l S`);y-=20;
    dt2('Total',cx[2],14,true);dt2(`${cur} ${tot}`,cx[4]-40,14,true,0.15,0.39,0.92);y-=40;
    if(doc.notes){dt2('Notes',50,8,true,0.5,0.5,0.5);y-=12;dt2(esc(doc.notes).substring(0,100),50,8,false);y-=30;}
    c2.push(`${0.85} ${0.85} ${0.85} RG 1 w\n50 60 m 545 60 l S`);
    dt2('OPCC CRM',50,9,false,0.5,0.5,0.5);dt2('Auto-generated',415,9,false,0.5,0.5,0.5);
    return ao(`<< /Length ${c2.join('\n').length} >>\nstream\n${c2.join('\n')}\nendstream`);
  }
  const fc=bp();pgs.push(ao(`<< /Type /Page /Parent ${pid} 0 R /MediaBox [0 0 595 842] /Contents ${fc} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`));
  objs[pid-1]=`${pid} 0 obj\n<< /Type /Pages /Kids [${pgs.map(id=>`${id} 0 R`).join(' ')}] /Count ${pgs.length} >>\nendobj`;
  const cat=ao(`<< /Type /Catalog /Pages ${pid} 0 R >>`);
  const body=objs.join('\n');const hdr='%PDF-1.4\n';
  let xr=`xref\n0 ${oid+1}\n0000000000 65535 f \n`;let off=hdr.length;
  for(const o of objs){xr+=`${String(off).padStart(10,'0')} 00000 n \n`;off+=o.length+1;}
  return new Response(new TextEncoder().encode(hdr+body+'\n'+xr+`trailer\n<< /Size ${oid+1} /Root ${cat} 0 R >>\nstartxref\n${off}\n%%EOF`),{
    headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${encodeURIComponent(num||type)}.pdf"`}
  });
});

pdf.post('/generate', authMiddleware, async (c) => {
  const body = await c.req.json();
  const ext = await callPdfWorker(body);
  if (ext) return new Response(ext.body, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${body.invoice_number||'document'}.pdf"` } });
  return c.json({ error: 'PDF generation unavailable' }, 503);
});

export { pdf as pdfRoutes };
