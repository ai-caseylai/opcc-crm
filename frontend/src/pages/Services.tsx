import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Edit, Trash2, Search } from 'lucide-react';

export default function ServicesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', unit_price: 0, currency: 'HKD', unit: 'service', category: 'Service', sku: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['service-items', search],
    queryFn: () => api(`/products?category=Service&limit=500&q=${search}`),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => api('/products', { method: 'POST', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['service-items'] }); setShowForm(false); resetForm(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: any) => api(`/products/${id}`, { method: 'PUT', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['service-items'] }); setShowForm(false); resetForm(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['service-items'] }),
  });

  function resetForm() {
    setForm({ name: '', description: '', unit_price: 0, currency: 'HKD', unit: 'service', category: 'Service', sku: '' });
    setEditId(null);
  }

  function openEdit(p: any) {
    setEditId(p.id);
    setForm({ name: p.name, description: p.description || '', unit_price: p.unit_price, currency: p.currency || 'HKD', unit: p.unit || 'service', category: 'Service', sku: p.sku || '' });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editId) updateMut.mutate({ id: editId, ...form });
    else createMut.mutate(form);
  }

  const items = (data?.data || []).filter((p: any) => p.category === 'Service');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">服務 Services</h2>
          <p className="text-muted-foreground mt-1">管理服務收費項目</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
          <Plus className="h-4 w-4" /> 新增收費項目
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋服務項目..." className="w-full pl-10 pr-4 py-2 border rounded-md bg-background text-sm" />
      </div>

      {isLoading ? <div className="text-center py-12 text-muted-foreground">載入中...</div> :
       items.length === 0 ? <div className="text-center py-12 text-muted-foreground">未有服務項目</div> : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">名稱</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">描述</th>
                <th className="text-right p-3 font-medium">單價</th>
                <th className="text-right p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p: any) => (
                <tr key={p.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3 text-muted-foreground hidden md:table-cell truncate max-w-[250px]">{p.description || '-'}</td>
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
          <div className="bg-card border rounded-xl p-6 w-full max-w-lg mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg">{editId ? '編輯收費項目' : '新增收費項目'}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="項目名稱 *" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="描述" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <div className="grid grid-cols-3 gap-3">
                <input type="number" required step="0.01" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: parseFloat(e.target.value) })}
                  placeholder="單價 *" className="px-3 py-2 border rounded-md bg-background text-sm" />
                <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm">
                  <option value="HKD">HKD</option><option value="USD">USD</option><option value="CNY">CNY</option>
                </select>
                <input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}
                  placeholder="單位" className="px-3 py-2 border rounded-md bg-background text-sm" />
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
