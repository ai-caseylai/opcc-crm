import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Search, Edit, Trash2, Package } from 'lucide-react';

export default function Products() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', unit_price: 0, currency: 'HKD', unit: 'pcs', category: '', sku: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['products', search, page],
    queryFn: () => api(`/products?q=${search}&page=${page}&limit=20`),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => api('/products', { method: 'POST', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); setShowForm(false); resetForm(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: any) => api(`/products/${id}`, { method: 'PUT', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); setShowForm(false); resetForm(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  function resetForm() {
    setForm({ name: '', description: '', unit_price: 0, currency: 'HKD', unit: 'pcs', category: '', sku: '' });
    setEditId(null);
  }

  function openEdit(p: any) {
    setEditId(p.id);
    setForm({ name: p.name, description: p.description || '', unit_price: p.unit_price, currency: p.currency || 'HKD', unit: p.unit || 'pcs', category: p.category || '', sku: p.sku || '' });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editId) updateMut.mutate({ id: editId, ...form });
    else createMut.mutate(form);
  }

  const products = data?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">產品 Products</h2>
          <p className="text-muted-foreground mt-1">管理產品與服務</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
          <Plus className="h-4 w-4" /> 新增產品
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜尋產品..." className="w-full pl-10 pr-4 py-2 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>

      {isLoading ? <div className="text-center py-12 text-muted-foreground">載入中...</div> :
       products.length === 0 ? <div className="text-center py-12 text-muted-foreground">未有產品記錄</div> : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">名稱</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">類別</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">SKU</th>
                <th className="text-right p-3 font-medium">單價</th>
                <th className="text-right p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p: any) => (
                <tr key={p.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3 text-muted-foreground hidden md:table-cell">{p.category || '-'}</td>
                  <td className="p-3 hidden lg:table-cell">{p.sku || '-'}</td>
                  <td className="p-3 text-right">{p.currency || 'HKD'} {p.unit_price?.toLocaleString()}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => openEdit(p)} className="p-1 hover:bg-muted rounded mr-1"><Edit className="h-4 w-4" /></button>
                    <button onClick={() => { if (confirm('確定刪除?')) deleteMut.mutate(p.id); }} className="p-1 hover:bg-muted rounded text-destructive"><Trash2 className="h-4 w-4" /></button>
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
            <h3 className="font-bold text-lg">{editId ? '編輯產品' : '新增產品'}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="產品名稱 *" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="描述" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <div className="grid grid-cols-3 gap-3">
                <input type="number" required step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: parseFloat(e.target.value) })}
                  placeholder="單價 *" className="px-3 py-2 border rounded-md bg-background text-sm" />
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm">
                  <option value="HKD">HKD</option><option value="USD">USD</option><option value="CNY">CNY</option>
                </select>
                <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  placeholder="單位" className="px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="類別" className="px-3 py-2 border rounded-md bg-background text-sm" />
                <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="SKU" className="px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
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
