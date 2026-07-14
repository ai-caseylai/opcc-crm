import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, WORKER_API_BASE } from '../lib/api';
import { Save, Trash2, Plus, X, ChevronLeft } from 'lucide-react';

// ─── Money Input (same pattern as BankStatementReview) ───────────────────────
function MoneyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState(value === 0 ? '' : String(value));
  useEffect(() => { if (document.activeElement?.tagName !== 'INPUT') setRaw(value === 0 ? '' : String(value)); }, [value]);
  return (
    <input
      type="text" inputMode="decimal" value={raw}
      onChange={(e) => { setRaw(e.target.value); const n = parseFloat(e.target.value.replace(/,/g, '')); if (!isNaN(n)) onChange(n); }}
      onBlur={() => setRaw(value === 0 ? '' : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
      onFocus={() => setRaw(value === 0 ? '' : String(value))}
      className="w-full px-2 py-1 border rounded text-sm text-right font-mono bg-background"
      placeholder="0.00"
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function InvoiceReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // PDF state
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Editable form state
  const [form, setForm] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [saved, setSaved] = useState(false);

  // ── Load invoice data ──
  const { data: invoiceData, isLoading } = useQuery({
    queryKey: ['invoice-review', id],
    queryFn: () => api(`/invoices/${id}/review`),
    enabled: !!id,
  });

  // Populate form once data loads
  useEffect(() => {
    if (!invoiceData || form) return;
    setForm({
      // For receipts: show receipt_number as the "number" field (not the REC-xxx internal key)
      invoice_number: invoiceData.receipt_number || invoiceData.invoice_number || '',
      vendor_name: invoiceData.vendor_name || '',
      customer_id: invoiceData.customer_id || '',
      issue_date: invoiceData.issue_date || '',
      due_date: invoiceData.due_date || '',
      currency: invoiceData.currency || 'HKD',
      tax_rate: invoiceData.tax_rate || 0,
      discount_amount: invoiceData.discount_amount || 0,
      notes: invoiceData.notes || '',
    });
    setItems((invoiceData.items || []).map((it: any) => ({
      id: it.id,
      description: it.description || '',
      quantity: it.quantity ?? 1,
      unit_price: it.unit_price ?? 0,
      amount: it.amount ?? 0,
    })));
  }, [invoiceData]);

  // ── Load original PDF via authenticated fetch ──
  useEffect(() => {
    if (!invoiceData?.file_id) return;
    let cancelled = false;
    let revokeUrl: string | null = null;
    (async () => {
      try {
        const token = localStorage.getItem('token') || '';
        const activeClientJson = localStorage.getItem('activeClient');
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        try { const c = JSON.parse(activeClientJson || '{}'); if (c?.id) headers['X-Active-Client'] = c.id; } catch {}
        const resp = await fetch(`${WORKER_API_BASE}/file-storage/${invoiceData.file_id}/download`, { headers });
        if (!resp.ok) { if (!cancelled) setPdfError(`Could not load PDF (HTTP ${resp.status})`); return; }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        revokeUrl = url;
        if (!cancelled) setPdfUrl(url);
      } catch (e: any) {
        if (!cancelled) setPdfError(e?.message || 'Failed to load PDF');
      }
    })();
    return () => { cancelled = true; if (revokeUrl) URL.revokeObjectURL(revokeUrl); };
  }, [invoiceData?.file_id]);

  // ── Mutations ──
  const confirmMut = useMutation({
    mutationFn: (body: any) => api(`/invoices/${id}/confirm`, { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices-receipts'] });
      setSaved(true);
      // Receipts go to Expense Receipts page; invoices go to Invoices page
      setTimeout(() => navigate(isReceipt ? '/expense-receipts' : '/invoices'), 1200);
    },
    onError: (err: any) => alert(`Save failed: ${err?.message || 'Unknown error'}`),
  });

  const discardMut = useMutation({
    mutationFn: () => api(`/invoices/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['file-storage'] });
      navigate('/file-storage');
    },
    onError: (err: any) => alert(`Discard failed: ${err?.message || 'Unknown error'}`),
  });

  // ── Item helpers ──
  function updateItem(idx: number, field: string, value: any) {
    const next = [...items];
    next[idx] = { ...next[idx], [field]: value };
    if (field === 'quantity' || field === 'unit_price') {
      next[idx].amount = (next[idx].quantity || 0) * (next[idx].unit_price || 0);
    }
    if (field === 'amount') {
      // manual override of amount
    }
    setItems(next);
  }

  function addItem() {
    setItems([...items, { description: '', quantity: 1, unit_price: 0, amount: 0 }]);
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  const subtotal = items.reduce((s, it) => s + (it.amount || 0), 0);
  const taxAmount = subtotal * ((form?.tax_rate || 0) / 100);
  const total = subtotal + taxAmount - (form?.discount_amount || 0);

  function handleSave() {
    if (!form) return;
    if (items.length === 0) { alert('Please add at least one line item before saving.'); return; }
    confirmMut.mutate({ ...form, items, tax_rate: form.tax_rate || 0, discount_amount: form.discount_amount || 0 });
  }

  function handleDiscard() {
    if (!window.confirm('Discard this invoice? The file will remain in File Storage but the extracted data will be deleted.')) return;
    discardMut.mutate();
  }

  // ── Render ──
  if (isLoading || !form) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-sm text-muted-foreground">Loading invoice data…</p>
        </div>
      </div>
    );
  }

  // Detect if this is a receipt (has receipt_number set, or invoice_number starts with REC-)
  const isReceipt = !!(invoiceData?.receipt_number || invoiceData?.invoice_number?.startsWith('REC-'));
  const isIncomingInvoice = !isReceipt && invoiceData?.direction === 'incoming';
  const docLabel = isReceipt ? 'Receipt 收據' : 'Invoice 發票';
  const customers: any[] = invoiceData?.customers || [];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1 hover:bg-muted rounded text-muted-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="font-semibold text-sm">Review {docLabel}</h2>
            <p className="text-xs text-muted-foreground">
              Check the extracted data against the original PDF, edit if needed, then Save.
            </p>
          </div>
        </div>
      </div>

      {/* ── Split pane ── */}
      <div className="flex flex-1 min-h-0 gap-0">
        {/* Left: original PDF */}
        <div className="w-[50%] border-r flex flex-col bg-gray-100">
          <div className="px-3 py-1.5 text-xs text-muted-foreground bg-card border-b flex-shrink-0">
            原始文件 Original Document
            {invoiceData?.file_original_name && (
              <span className="ml-2 font-medium text-foreground">{invoiceData.file_original_name}</span>
            )}
          </div>
          <div className="flex-1 min-h-0">
            {pdfError ? (
              <div className="flex items-center justify-center h-full text-sm text-destructive p-4 text-center">
                {pdfError}
                <br />
                <span className="text-muted-foreground text-xs mt-1">You can still review the extracted data on the right.</span>
              </div>
            ) : !pdfUrl ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : (
              <iframe src={pdfUrl} className="w-full h-full border-0" title="Invoice PDF" />
            )}
          </div>
        </div>

        {/* Right: editable extracted data */}
        <div className="w-[50%] overflow-y-auto">
          <div className="p-5 space-y-5">

            {/* ── Header fields ── */}
            <div className="bg-card border rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-sm border-b pb-2">{docLabel} Details {isReceipt ? '收據資料' : '發票資料'}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">{isReceipt ? 'Receipt Number 收據號碼' : 'Invoice Number 發票號碼'}</label>
                  <input value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm bg-background font-mono" placeholder="e.g. INV-2025-001" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">Currency 貨幣</label>
                  <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm bg-background">
                    <option value="HKD">HKD</option>
                    <option value="USD">USD</option>
                    <option value="CNY">CNY</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">Issue Date 開票日期</label>
                  <input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm bg-background" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">Due Date 到期日</label>
                  <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm bg-background" />
                </div>
              </div>
            </div>

            {/* ── Customer / Vendor ── */}
            <div className="bg-card border rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-sm border-b pb-2">
                {isIncomingInvoice ? '供應商 Supplier — who billed us' : '客戶 Customer — who we billed'}
              </h3>
              {isIncomingInvoice && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">
                    Supplier Name 供應商名稱
                  </label>
                  <input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm bg-background" placeholder="e.g. Muse Labs Engineering Limited" />
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground block mb-0.5">
                  {isIncomingInvoice ? "Link to Supplier Record 關聯供應商" : "Link to Customer Record 關聯客戶"} <span className="text-muted-foreground">(optional)</span>
                </label>
                <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm bg-background">
                  <option value="">— Select customer —</option>
                  {customers.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  If the vendor is a new contact, leave blank — they'll be created automatically.
                </p>
              </div>
            </div>

            {/* ── Line Items ── */}
            <div className="bg-card border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="font-semibold text-sm">Line Items 明細</h3>
                <button onClick={addItem}
                  className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <Plus className="h-3 w-3" /> Add Row
                </button>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground px-1">
                <span className="col-span-5">Description 描述</span>
                <span className="col-span-2 text-center">Qty 數量</span>
                <span className="col-span-2 text-right">Unit Price 單價</span>
                <span className="col-span-2 text-right">Amount 金額</span>
                <span className="col-span-1" />
              </div>

              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      value={item.description}
                      onChange={(e) => updateItem(idx, 'description', e.target.value)}
                      placeholder="Item description"
                      className="col-span-5 px-2 py-1 border rounded text-sm bg-background"
                    />
                    <input
                      type="number" min="0" step="1"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className="col-span-2 px-2 py-1 border rounded text-sm text-center bg-background"
                    />
                    <div className="col-span-2">
                      <MoneyInput value={item.unit_price} onChange={(v) => updateItem(idx, 'unit_price', v)} />
                    </div>
                    <div className="col-span-2">
                      <MoneyInput value={item.amount} onChange={(v) => updateItem(idx, 'amount', v)} />
                    </div>
                    <button onClick={() => removeItem(idx)}
                      className="col-span-1 flex justify-center text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {items.length === 0 && (
                <div className="text-center py-4 text-sm text-muted-foreground border border-dashed rounded-lg">
                  No line items — click "Add Row" to add one manually
                </div>
              )}

              {/* Totals */}
              <div className="border-t pt-3 space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-mono">{form.currency} {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span>Tax Rate</span>
                    <input type="number" min="0" max="100" step="0.5"
                      value={form.tax_rate}
                      onChange={(e) => setForm({ ...form, tax_rate: parseFloat(e.target.value) || 0 })}
                      className="w-16 px-1.5 py-0.5 border rounded text-xs text-center bg-background" />
                    <span>%</span>
                  </div>
                  <span className="font-mono">{form.currency} {taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {form.discount_amount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Discount</span>
                    <span className="font-mono text-red-500">- {form.currency} {(form.discount_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold border-t pt-1.5">
                  <span>Total 合計</span>
                  <span className="font-mono text-base">{form.currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            {/* ── Notes ── */}
            <div className="bg-card border rounded-xl p-4 space-y-2">
              <h3 className="font-semibold text-sm">Notes 備註</h3>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3} placeholder="Payment terms, reference numbers, etc."
                className="w-full px-2 py-1.5 border rounded text-sm bg-background resize-none" />
            </div>

            {/* ── Action buttons (bottom) ── */}
            <div className="flex gap-3 pb-6">
              <button onClick={handleDiscard} disabled={discardMut.isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 border rounded-md text-sm text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" /> Discard 放棄
              </button>
              <button onClick={handleSave} disabled={confirmMut.isPending || saved}
                className="flex-2 flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90 disabled:opacity-60">
                <Save className="h-4 w-4" />
                {saved ? '已儲存 ✓' : confirmMut.isPending ? 'Saving…' : `Save ${docLabel}`}
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
