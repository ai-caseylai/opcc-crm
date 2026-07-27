import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Search, Edit, Trash2 } from 'lucide-react';

export default function Suppliers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', company_name: '', email: '', phone: '', address: '', notes: '', tax_id: '', payment_terms: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search, page],
    queryFn: () => api(`/suppliers?q=${search}&page=${page}&limit=20`),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => api('/suppliers', { method: 'POST', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); setShowForm(false); resetForm(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: any) => api(`/suppliers/${id}`, { method: 'PUT', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); setShowForm(false); resetForm(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/suppliers/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  });

  function resetForm() {
    setForm({ name: '', company_name: '', email: '', phone: '', address: '', notes: '', tax_id: '', payment_terms: '' });
    setEditId(null);
  }

  function openEdit(s: any) {
    setEditId(s.id);
    setForm({ name: s.name, company_name: s.company_name || '', email: s.email || '', phone: s.phone || '', address: s.address || '', notes: s.notes || '', tax_id: s.tax_id || '', payment_terms: s.payment_terms || '' });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editId) updateMut.mutate({ id: editId, ...form });
    else createMut.mutate(form);
  }

  const suppliers = data?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">供應商 Suppliers</h2>
          <p className="text-muted-foreground mt-1">管理供應商資料庫</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
          <Plus className="h-4 w-4" /> 新增供應商
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜尋供應商..." className="w-full pl-10 pr-4 py-2 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>

      {isLoading ? <div className="text-center py-12 text-muted-foreground">載入中...</div> :
       suppliers.length === 0 ? <div className="text-center py-12 text-muted-foreground">未有供應商記錄</div> : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">名稱</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">公司</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">電郵</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">付款條件</th>
                <th className="text-right p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s: any) => (
                <tr key={s.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3 text-muted-foreground hidden md:table-cell">{s.company_name || '-'}</td>
                  <td className="p-3 hidden lg:table-cell">{s.email || '-'}</td>
                  <td className="p-3 hidden lg:table-cell">{s.payment_terms || '-'}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => openEdit(s)} className="p-1 hover:bg-muted rounded mr-1"><Edit className="h-4 w-4" /></button>
                    <button onClick={() => { if (confirm('確定刪除?')) deleteMut.mutate(s.id); }} className="p-1 hover:bg-muted rounded text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
          <div className="bg-card border rounded-xl p-6 w-full max-w-lg mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg">{editId ? '編輯供應商' : '新增供應商'}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="供應商名稱 *" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                placeholder="公司名稱" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="電郵" className="px-3 py-2 border rounded-md bg-background text-sm" />
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="電話" className="px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="地址" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                  placeholder="稅號" className="px-3 py-2 border rounded-md bg-background text-sm" />
                <input value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                  placeholder="付款條件" className="px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="備註" className="w-full px-3 py-2 border rounded-md bg-background text-sm" rows={2} />
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
