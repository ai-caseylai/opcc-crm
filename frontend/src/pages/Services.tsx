import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Edit, Trash2, Clock, Calendar as CalIcon, Check, X, DollarSign, Search } from 'lucide-react';

export default function ServicesPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'services' | 'bookings'>('services');
  const [showForm, setShowForm] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [bookingDate, setBookingDate] = useState(new Date().toISOString().split('T')[0]);
  const [form, setForm] = useState({ name: '', description: '', category: 'general', duration_minutes: 60, price: 0, currency: 'HKD' });
  const [bookingForm, setBookingForm] = useState({ service_id: '', customer_id: '', booking_date: new Date().toISOString().split('T')[0], start_time: '09:00', end_time: '', notes: '', price: 0 });

  const { data: services, isLoading } = useQuery({
    queryKey: ['services'],
    queryFn: () => api('/services'),
  });

  const { data: customers } = useQuery({
    queryKey: ['customers-list-svc'],
    queryFn: () => api('/customers?limit=200'),
  });

  const { data: bookings } = useQuery({
    queryKey: ['service-bookings', bookingDate],
    queryFn: () => api(`/services/bookings?date=${bookingDate}`),
    enabled: tab === 'bookings',
  });

  const createMut = useMutation({
    mutationFn: (body: any) => api('/services', { method: 'POST', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['services'] }); setShowForm(false); resetForm(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: any) => api(`/services/${id}`, { method: 'PUT', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['services'] }); setShowForm(false); resetForm(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/services/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });

  const createBooking = useMutation({
    mutationFn: (body: any) => api('/services/bookings', { method: 'POST', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['service-bookings'] }); setShowBooking(false); },
  });

  const updateBookingStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/services/bookings/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['service-bookings'] }),
  });

  function resetForm() {
    setForm({ name: '', description: '', category: 'general', duration_minutes: 60, price: 0, currency: 'HKD' });
    setEditId(null);
  }

  function openEdit(s: any) {
    setEditId(s.id);
    setForm({ name: s.name, description: s.description || '', category: s.category || 'general', duration_minutes: s.duration_minutes || 60, price: s.price || 0, currency: s.currency || 'HKD' });
    setShowForm(true);
  }

  function openNewBooking(svc?: any) {
    setBookingForm({
      service_id: svc?.id || '',
      customer_id: '',
      booking_date: new Date().toISOString().split('T')[0],
      start_time: '09:00',
      end_time: '',
      notes: '',
      price: svc?.price || 0,
    });
    setShowBooking(true);
  }

  const svcList = services?.data || [];
  const bList = bookings?.data || [];

  const categoryLabel = (c: string) => ({ general: '一般', consulting: '諮詢', maintenance: '維護', design: '設計', development: '開發', marketing: '營銷', training: '培訓' }[c] || c);
  const statusBadge = (s: string) => {
    const m: Record<string, string> = { confirmed: 'bg-green-100 text-green-700', completed: 'bg-blue-100 text-blue-700', cancelled: 'bg-red-100 text-red-700', no_show: 'bg-yellow-100 text-yellow-700' };
    return `px-2 py-0.5 rounded-full text-xs font-medium ${m[s] || 'bg-gray-100'}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">服務 Services</h2>
          <p className="text-muted-foreground mt-1">服務項目與預約管理</p>
        </div>
        <div className="flex gap-2">
          {tab === 'services' && (
            <button onClick={() => { resetForm(); setShowForm(true); }}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
              <Plus className="h-4 w-4" /> 新增服務
            </button>
          )}
          {tab === 'bookings' && (
            <button onClick={() => openNewBooking()}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
              <Plus className="h-4 w-4" /> 新增預約
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { id: 'services' as const, label: '服務項目' },
          { id: 'bookings' as const, label: '預約管理' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Services List */}
      {tab === 'services' && (
        isLoading ? <div className="text-center py-12 text-muted-foreground">載入中...</div> :
        svcList.length === 0 ? <div className="text-center py-12 text-muted-foreground">未有服務項目，按「新增服務」建立</div> : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {svcList.map((s: any) => (
              <div key={s.id} className="bg-card border rounded-xl p-5 space-y-3 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{s.name}</h3>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{categoryLabel(s.category)}</span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openNewBooking(s)} className="p-1.5 hover:bg-muted rounded text-green-600" title="新增預約"><CalIcon className="h-4 w-4" /></button>
                    <button onClick={() => openEdit(s)} className="p-1.5 hover:bg-muted rounded"><Edit className="h-4 w-4" /></button>
                  </div>
                </div>
                {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {s.duration_minutes} 分鐘</span>
                  <span className="flex items-center gap-1 font-semibold text-foreground"><DollarSign className="h-3.5 w-3.5" /> {s.currency} {s.price?.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Bookings List */}
      {tab === 'bookings' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)}
              className="px-3 py-2 border rounded-md bg-background text-sm" />
            <span className="text-sm text-muted-foreground">共 {bList.length} 筆預約</span>
          </div>
          {bList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">當日未有預約</div>
          ) : (
            <div className="bg-card border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3">時間</th>
                    <th className="text-left p-3">客戶</th>
                    <th className="text-left p-3 hidden md:table-cell">服務</th>
                    <th className="text-left p-3">狀態</th>
                    <th className="text-right p-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {bList.map((b: any) => (
                    <tr key={b.id} className="border-b hover:bg-muted/30">
                      <td className="p-3 font-medium">{b.start_time} - {b.end_time}</td>
                      <td className="p-3">{b.customer_name}</td>
                      <td className="p-3 hidden md:table-cell text-muted-foreground">{b.service_name}</td>
                      <td className="p-3"><span className={statusBadge(b.status)}>{{ confirmed: '已確認', completed: '已完成', cancelled: '已取消', no_show: '未到' }[b.status] || b.status}</span></td>
                      <td className="p-3 text-right">
                        {b.status === 'confirmed' && (
                          <>
                            <button onClick={() => updateBookingStatus.mutate({ id: b.id, status: 'completed' })}
                              className="p-1 hover:bg-muted rounded mr-1 text-green-600"><Check className="h-4 w-4" /></button>
                            <button onClick={() => updateBookingStatus.mutate({ id: b.id, status: 'cancelled' })}
                              className="p-1 hover:bg-muted rounded text-destructive"><X className="h-4 w-4" /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Service Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
          <div className="bg-card border rounded-xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg">{editId ? '編輯服務' : '新增服務'}</h3>
            <form onSubmit={e => { e.preventDefault(); editId ? updateMut.mutate({ id: editId, ...form }) : createMut.mutate(form); }} className="space-y-3">
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="服務名稱 *" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="描述" className="w-full px-3 py-2 border rounded-md bg-background text-sm" rows={2} />
              <div className="grid grid-cols-2 gap-3">
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm">
                  <option value="general">一般</option><option value="consulting">諮詢</option>
                  <option value="maintenance">維護</option><option value="design">設計</option>
                  <option value="development">開發</option><option value="marketing">營銷</option>
                  <option value="training">培訓</option>
                </select>
                <input type="number" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: parseInt(e.target.value) || 60 })}
                  placeholder="時長（分鐘）" className="px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input type="number" step="0.01" required value={form.price} onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })}
                  placeholder="價格 *" className="px-3 py-2 border rounded-md bg-background text-sm" />
                <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm">
                  <option value="HKD">HKD</option><option value="USD">USD</option><option value="CNY">CNY</option>
                </select>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-md text-sm">取消</button>
                <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">
                  {editId ? '更新' : '建立'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Booking Form Modal */}
      {showBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowBooking(false)}>
          <div className="bg-card border rounded-xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg">新增預約</h3>
            <form onSubmit={e => { e.preventDefault(); createBooking.mutate(bookingForm); }} className="space-y-3">
              <select required value={bookingForm.service_id} onChange={e => setBookingForm({ ...bookingForm, service_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md bg-background text-sm">
                <option value="">選擇服務 *</option>
                {svcList.map((s: any) => <option key={s.id} value={s.id}>{s.name} — {s.currency} {s.price} ({s.duration_minutes}分鐘)</option>)}
              </select>
              <select required value={bookingForm.customer_id} onChange={e => setBookingForm({ ...bookingForm, customer_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md bg-background text-sm">
                <option value="">選擇客戶 *</option>
                {(customers?.data || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <input type="date" required value={bookingForm.booking_date} onChange={e => setBookingForm({ ...bookingForm, booking_date: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm" />
                <input type="time" required value={bookingForm.start_time} onChange={e => setBookingForm({ ...bookingForm, start_time: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <textarea value={bookingForm.notes} onChange={e => setBookingForm({ ...bookingForm, notes: e.target.value })}
                placeholder="備註" className="w-full px-3 py-2 border rounded-md bg-background text-sm" rows={2} />
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowBooking(false)} className="px-4 py-2 border rounded-md text-sm">取消</button>
                <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">建立預約</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
