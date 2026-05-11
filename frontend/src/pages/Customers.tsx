import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Search, Edit, Trash2, Building2 } from 'lucide-react';

export default function Customers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', company_name: '', email: '', phone: '', address: '', city: '', country: 'Hong Kong', notes: '', tax_id: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, page],
    queryFn: () => api(`/customers?q=${search}&page=${page}&limit=20`),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => api('/customers', { method: 'POST', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['customers'] }); setShowForm(false); resetForm(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: any) => api(`/customers/${id}`, { method: 'PUT', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['customers'] }); setShowForm(false); resetForm(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/customers/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });

  function resetForm() {
    setForm({ name: '', company_name: '', email: '', phone: '', address: '', city: '', country: 'Hong Kong', notes: '', tax_id: '' });
    setEditId(null);
  }

  function openEdit(c: any) {
    setEditId(c.id);
    setForm({ name: c.name, company_name: c.company_name || '', email: c.email || '', phone: c.phone || '', address: c.address || '', city: c.city || '', country: c.country || 'Hong Kong', notes: c.notes || '', tax_id: c.tax_id || '' });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editId) updateMut.mutate({ id: editId, ...form });
    else createMut.mutate(form);
  }

  const customers = data?.data || [];
  const total = data?.total || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">客戶 Customers</h2>
          <p className="text-muted-foreground mt-1">管理客戶資料庫</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
          <Plus className="h-4 w-4" /> 新增客戶
        </button>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="搜尋客戶名稱、公司、電郵..." className="w-full pl-10 pr-4 py-2 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">載入中...</div>
      ) : customers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">未有客戶記錄</div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">名稱 Name</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">公司 Company</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">電郵 Email</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">電話 Phone</th>
                <th className="text-right p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c: any) => (
                <tr key={c.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3 text-muted-foreground hidden md:table-cell">{c.company_name || '-'}</td>
                  <td className="p-3 hidden lg:table-cell">{c.email || '-'}</td>
                  <td className="p-3 hidden lg:table-cell">{c.phone || '-'}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => openEdit(c)} className="p-1 hover:bg-muted rounded mr-1"><Edit className="h-4 w-4" /></button>
                    <button onClick={() => { if (confirm('確定刪除?')) deleteMut.mutate(c.id); }} className="p-1 hover:bg-muted rounded text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > 20 && (
            <div className="p-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">共 {total} 筆</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border rounded disabled:opacity-50">上一頁</button>
                <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border rounded disabled:opacity-50">下一頁</button>
              </div>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
          <div className="bg-card border rounded-xl p-6 w-full max-w-lg mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg">{editId ? '編輯客戶' : '新增客戶'}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="客戶名稱 *" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                placeholder="公司名稱" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="電郵 Email" className="px-3 py-2 border rounded-md bg-background text-sm" />
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="電話 Phone" className="px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="地址 Address" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
                  placeholder="城市 City" className="px-3 py-2 border rounded-md bg-background text-sm" />
                <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}
                  placeholder="國家 Country" className="px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                placeholder="稅號 Tax ID" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="備註 Notes" className="w-full px-3 py-2 border rounded-md bg-background text-sm" rows={2} />
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-md text-sm">取消</button>
                <button type="submit" disabled={createMut.isPending || updateMut.isPending}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50">
                  {editId ? '更新' : '建立'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
