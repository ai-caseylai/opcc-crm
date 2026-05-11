import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Search, FileText, Eye, Trash2, Download } from 'lucide-react';

export default function Invoices() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [form, setForm] = useState({ invoice_number: '', customer_id: '', issue_date: new Date().toISOString().split('T')[0], due_date: '', currency: 'HKD', tax_rate: 0, discount_amount: 0, notes: '', terms: '', items: [{ description: '', quantity: 1, unit_price: 0, amount: 0 }] });

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', search, status, page],
    queryFn: () => api(`/invoices?q=${search}&status=${status}&page=${page}&limit=20`),
  });

  const { data: customers } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => api('/customers?limit=200'),
  });

  const { data: invoiceDetail } = useQuery({
    queryKey: ['invoice', viewId],
    queryFn: () => api(`/invoices/${viewId}`),
    enabled: !!viewId,
  });

  const createMut = useMutation({
    mutationFn: (body: any) => api('/invoices', { method: 'POST', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); setShowForm(false); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/invoices/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/invoices/${id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });

  function addItem() {
    setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unit_price: 0, amount: 0 }] });
  }

  function updateItem(idx: number, field: string, value: any) {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: value };
    if (field === 'quantity' || field === 'unit_price') {
      items[idx].amount = items[idx].quantity * items[idx].unit_price;
    }
    setForm({ ...form, items });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMut.mutate(form);
  }

  const invoices = data?.data || [];
  const statusBadge = (s: string) => {
    const colors: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', sent: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500' };
    return `px-2 py-0.5 rounded-full text-xs font-medium ${colors[s] || 'bg-gray-100'}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">發票 Invoices</h2>
          <p className="text-muted-foreground mt-1">管理銷售發票</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
          <Plus className="h-4 w-4" /> 建立發票
        </button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="搜尋發票..." className="w-full pl-10 pr-4 py-2 border rounded-md bg-background text-sm" />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 border rounded-md bg-background text-sm">
          <option value="">全部狀態</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      {isLoading ? <div className="text-center py-12 text-muted-foreground">載入中...</div> :
       invoices.length === 0 ? <div className="text-center py-12 text-muted-foreground">未有發票記錄</div> : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3">發票號碼</th>
                <th className="text-left p-3 hidden md:table-cell">客戶</th>
                <th className="text-left p-3">狀態</th>
                <th className="text-right p-3 hidden lg:table-cell">金額</th>
                <th className="text-left p-3 hidden lg:table-cell">日期</th>
                <th className="text-right p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv: any) => (
                <tr key={inv.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{inv.invoice_number}</td>
                  <td className="p-3 hidden md:table-cell">{inv.customer_name || '-'}</td>
                  <td className="p-3"><span className={statusBadge(inv.status)}>{inv.status}</span></td>
                  <td className="p-3 text-right hidden lg:table-cell">{inv.currency} {inv.total?.toLocaleString()}</td>
                  <td className="p-3 hidden lg:table-cell">{inv.issue_date}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => setViewId(inv.id)} className="p-1 hover:bg-muted rounded mr-1"><Eye className="h-4 w-4" /></button>
                    <a href={`/api/pdf/invoice/${inv.id}`} target="_blank" className="p-1 hover:bg-muted rounded mr-1 inline-block"><Download className="h-4 w-4" /></a>
                    {inv.status === 'draft' && (
                      <button onClick={() => updateStatus.mutate({ id: inv.id, status: 'sent' })} className="text-xs text-blue-600 hover:underline mr-2">Send</button>
                    )}
                    {inv.status === 'sent' && (
                      <button onClick={() => updateStatus.mutate({ id: inv.id, status: 'paid' })} className="text-xs text-green-600 hover:underline mr-2">Paid</button>
                    )}
                    <button onClick={() => { if (confirm('確定刪除?')) deleteMut.mutate(inv.id); }} className="p-1 hover:bg-muted rounded text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Invoice Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto" onClick={() => setShowForm(false)}>
          <div className="bg-card border rounded-xl p-6 w-full max-w-2xl mx-4 my-8 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg">建立發票</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input required value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                  placeholder="發票號碼 *" className="px-3 py-2 border rounded-md bg-background text-sm" />
                <select required value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm">
                  <option value="">選擇客戶 *</option>
                  {(customers?.data || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm" />
                <input type="date" required value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm" placeholder="到期日" />
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm">
                  <option value="HKD">HKD</option><option value="USD">USD</option><option value="CNY">CNY</option>
                </select>
              </div>

              <div className="border rounded-md p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">項目 Items</span>
                  <button type="button" onClick={addItem} className="text-xs text-primary hover:underline">+ 新增項目</button>
                </div>
                {form.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input required value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)}
                      placeholder="描述" className="col-span-5 px-2 py-1 border rounded text-sm" />
                    <input type="number" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', parseFloat(e.target.value))}
                      className="col-span-2 px-2 py-1 border rounded text-sm" placeholder="數量" />
                    <input type="number" step="0.01" value={item.unit_price} onChange={(e) => updateItem(idx, 'unit_price', parseFloat(e.target.value))}
                      className="col-span-2 px-2 py-1 border rounded text-sm" placeholder="單價" />
                    <span className="col-span-2 text-sm text-right">{form.currency} {(item.amount || 0).toFixed(2)}</span>
                    <button type="button" onClick={() => { const items = form.items.filter((_, i) => i !== idx); setForm({ ...form, items: items.length ? items : [{ description: '', quantity: 1, unit_price: 0, amount: 0 }] }); }} className="col-span-1 text-destructive text-xs">✕</button>
                  </div>
                ))}
                <div className="text-right font-bold text-sm pt-2 border-t">
                  總計: {form.currency} {form.items.reduce((s, i) => s + i.amount, 0).toFixed(2)}
                </div>
              </div>

              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="備註 Notes" className="w-full px-3 py-2 border rounded-md bg-background text-sm" rows={2} />
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-md text-sm">取消</button>
                <button type="submit" disabled={createMut.isPending}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">建立</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Invoice Modal */}
      {viewId && invoiceDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setViewId(null)}>
          <div className="bg-card border rounded-xl p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">發票 #{invoiceDetail.invoice_number}</h3>
              <button onClick={() => setViewId(null)} className="text-muted-foreground">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">客戶:</span> {invoiceDetail.customer_name}</div>
              <div><span className="text-muted-foreground">狀態:</span> <span className={statusBadge(invoiceDetail.status)}>{invoiceDetail.status}</span></div>
              <div><span className="text-muted-foreground">日期:</span> {invoiceDetail.issue_date}</div>
              <div><span className="text-muted-foreground">到期:</span> {invoiceDetail.due_date}</div>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left p-2">項目</th><th className="text-right p-2">數量</th><th className="text-right p-2">單價</th><th className="text-right p-2">金額</th></tr></thead>
              <tbody>
                {(invoiceDetail.items || []).map((item: any) => (
                  <tr key={item.id} className="border-b">
                    <td className="p-2">{item.description}</td>
                    <td className="p-2 text-right">{item.quantity}</td>
                    <td className="p-2 text-right">{invoiceDetail.currency} {item.unit_price?.toFixed(2)}</td>
                    <td className="p-2 text-right">{invoiceDetail.currency} {item.amount?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3} className="text-right font-bold p-2">總計</td><td className="text-right font-bold p-2">{invoiceDetail.currency} {invoiceDetail.total?.toFixed(2)}</td></tr></tfoot>
            </table>
            <a href={`/api/pdf/invoice/${invoiceDetail.id}`} target="_blank"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"><Download className="h-4 w-4" /> 下載 PDF</a>
          </div>
        </div>
      )}
    </div>
  );
}
