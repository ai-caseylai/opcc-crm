import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ChevronLeft, ChevronRight, Plus, X, CalendarDays, Columns, Clock } from 'lucide-react';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const COLORS = ['#2563eb','#dc2626','#16a34a','#ca8a04','#9333ea','#0891b2','#db2777','#4f46e5'];
const EVENT_TYPES: Record<string, string> = { appointment: '約會', meeting: '會議', deadline: '截止', reminder: '提醒', invoice_due: '發票到期' };
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7am - 9pm

function fmt(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtTime(d: Date) { return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const today = new Date();
  const [view, setView] = useState<'month'|'week'|'day'>('month');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date(today); d.setDate(d.getDate() - d.getDay()); return d;
  });
  const [dayDate, setDayDate] = useState(() => new Date(today));
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', event_type: 'appointment', start_time: '', end_time: '', all_day: 0, customer_id: '', color: '#2563eb', location: '' });

  // Compute date range
  const range = useMemo(() => {
    if (view === 'month') {
      const lastDay = new Date(year, month + 1, 0).getDate();
      return { start: `${year}-${String(month+1).padStart(2,'0')}-01`, end: `${year}-${String(month+1).padStart(2,'0')}-${lastDay}` };
    } else if (view === 'week') {
      const end = new Date(weekStart); end.setDate(end.getDate() + 6);
      return { start: fmt(weekStart), end: fmt(end) };
    } else {
      return { start: fmt(dayDate), end: fmt(dayDate) };
    }
  }, [view, year, month, weekStart, dayDate]);

  const { data: events } = useQuery({
    queryKey: ['calendar-events', range.start, range.end],
    queryFn: () => api(`/calendar/events?start=${range.start}&end=${range.end}`),
  });

  const { data: customers } = useQuery({
    queryKey: ['customers-list-cal'],
    queryFn: () => api('/customers?limit=200'),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => api('/calendar/events', { method: 'POST', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['calendar-events'] }); setShowForm(false); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/calendar/events/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar-events'] }),
  });

  const openNew = (dateStr: string, timeStr?: string) => {
    setForm({ title: '', description: '', event_type: 'appointment',
      start_time: timeStr ? `${dateStr}T${timeStr}` : `${dateStr}T09:00`,
      end_time: timeStr ? `${dateStr}T${String(parseInt(timeStr)+1).padStart(2,'0')}:00` : `${dateStr}T10:00`,
      all_day: timeStr ? 0 : 1, customer_id: '', color: '#2563eb', location: '' });
    setShowForm(true);
  };

  const evList = (events?.data || []);

  // ── Navigation ──
  const nav = (dir: -1|1) => {
    if (view === 'month') {
      const m = month + dir;
      if (m < 0) { setYear(y => y-1); setMonth(11); }
      else if (m > 11) { setYear(y => y+1); setMonth(0); }
      else setMonth(m);
    } else if (view === 'week') {
      const d = new Date(weekStart); d.setDate(d.getDate() + dir * 7); setWeekStart(d);
    } else {
      const d = new Date(dayDate); d.setDate(d.getDate() + dir); setDayDate(d);
    }
  };

  const title = view === 'month'
    ? `${year} 年 ${month + 1} 月`
    : view === 'week'
    ? `${fmt(weekStart)} — ${fmt(new Date(new Date(weekStart).setDate(weekStart.getDate()+6)))}`
    : `${dayDate.getFullYear()} 年 ${dayDate.getMonth()+1} 月 ${dayDate.getDate()} 日 ${WEEKDAYS[dayDate.getDay()]}`;

  // ── Month helpers ──
  const lastDay = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const getDayEvents = (day: number) => {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return evList.filter((e: any) => e.start_time?.startsWith(ds));
  };

  // ── Week helpers ──
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d;
  });
  const getHourEvents = (date: Date, hour: number) => {
    const ds = fmt(date);
    return evList.filter((e: any) => {
      if (!e.start_time) return false;
      const [ed, et] = e.start_time.split('T');
      return ed === ds && parseInt(et) >= hour && parseInt(et) < hour + 1;
    });
  };
  const weekAllDay = (date: Date) => {
    const ds = fmt(date);
    return evList.filter((e: any) => e.all_day && e.start_time?.startsWith(ds));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">日曆 Calendar</h2>
          <p className="text-muted-foreground mt-1">排程與事件管理</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex bg-muted rounded-md p-0.5">
            <button onClick={() => setView('month')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${view === 'month' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <CalendarDays className="h-3.5 w-3.5 inline mr-1" />月
            </button>
            <button onClick={() => setView('week')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${view === 'week' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <Columns className="h-3.5 w-3.5 inline mr-1" />週
            </button>
            <button onClick={() => setView('day')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${view === 'day' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <Clock className="h-3.5 w-3.5 inline mr-1" />日
            </button>
          </div>
          <button onClick={() => nav(-1)} className="p-1.5 hover:bg-muted rounded"><ChevronLeft className="h-5 w-5" /></button>
          <span className="font-semibold min-w-[180px] text-center text-sm">{title}</span>
          <button onClick={() => nav(1)} className="p-1.5 hover:bg-muted rounded"><ChevronRight className="h-5 w-5" /></button>
          <button onClick={() => openNew(fmt(today), '09:00')}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm hover:opacity-90">
            <Plus className="h-4 w-4" /> 新增
          </button>
        </div>
      </div>

      {/* ── Month View ── */}
      {view === 'month' && (
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="grid grid-cols-7">
            {WEEKDAYS.map(w => (
              <div key={w} className="p-2 text-center text-xs font-medium text-muted-foreground border-b bg-muted/30">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => {
              const dayNum = i - firstDow + 1;
              const inMonth = dayNum >= 1 && dayNum <= lastDay;
              const dayEvents = inMonth ? getDayEvents(dayNum) : [];
              const isToday = inMonth && year === today.getFullYear() && month === today.getMonth() && dayNum === today.getDate();
              return (
                <div key={i} className={`min-h-[90px] border-b border-r p-1.5 ${inMonth ? 'hover:bg-muted/30 cursor-pointer' : 'bg-muted/10 text-muted-foreground/50'}`}
                  onClick={() => inMonth && openNew(`${year}-${String(month+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`, '09:00')}>
                  <div className={`text-xs mb-1 ${isToday ? 'bg-primary text-primary-foreground w-5 h-5 flex items-center justify-center rounded-full font-bold' : 'font-medium'}`}>{inMonth ? dayNum : ''}</div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((e: any) => (
                      <div key={e.id} title={e.title} className="text-xs truncate rounded px-1 py-0.5 cursor-pointer hover:opacity-80"
                        style={{ backgroundColor: e.color + '20', color: e.color, borderLeft: `3px solid ${e.color}` }}
                        onClick={(ev) => { ev.stopPropagation(); if (confirm(`刪除「${e.title}」?`)) deleteMut.mutate(e.id); }}>
                        {e.all_day ? '' : (e.start_time?.split('T')[1]?.slice(0, 5) || '') + ' '}{e.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && <div className="text-xs text-muted-foreground">+{dayEvents.length - 3}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Week View ── */}
      {view === 'week' && (
        <div className="bg-card border rounded-xl overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-8 border-b bg-muted/30">
            <div className="p-2 text-center text-xs font-medium text-muted-foreground border-r w-16" />
            {weekDays.map((d, i) => {
              const isToday = fmt(d) === fmt(today);
              const ad = weekAllDay(d);
              return (
                <div key={i} className={`p-2 text-center border-r last:border-r-0 ${isToday ? 'bg-primary/5' : ''}`}>
                  <div className="text-xs text-muted-foreground">{WEEKDAYS[d.getDay()]}</div>
                  <div className={`text-lg font-semibold ${isToday ? 'text-primary' : ''}`}>{d.getDate()}</div>
                  {ad.length > 0 && (
                    <div className="mt-0.5 space-y-0.5">
                      {ad.slice(0, 2).map((e: any) => (
                        <div key={e.id} className="text-[10px] truncate rounded px-1 py-0.5" style={{ backgroundColor: e.color + '30', color: e.color }}>{e.title}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Time grid */}
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 250px)' }}>
            {HOURS.map(hour => (
              <div key={hour} className="grid grid-cols-8 border-b border-muted/30 min-h-[60px]">
                <div className="p-1 text-[10px] text-muted-foreground text-right pr-2 border-r pt-0.5 w-16">
                  {String(hour).padStart(2,'0')}:00
                </div>
                {weekDays.map((d, di) => {
                  const he = getHourEvents(d, hour);
                  const isToday = fmt(d) === fmt(today);
                  return (
                    <div key={di} className={`border-r last:border-r-0 p-0.5 cursor-pointer hover:bg-muted/20 transition-colors ${isToday ? 'bg-primary/[0.02]' : ''}`}
                      onClick={() => openNew(fmt(d), `${String(hour).padStart(2,'0')}:00`)}>
                      {he.map((e: any) => (
                        <div key={e.id} title={`${e.title} — ${e.start_time?.split('T')[1]?.slice(0,5) || ''}`}
                          className="text-[10px] rounded px-1 py-0.5 mb-0.5 truncate cursor-pointer hover:opacity-80"
                          style={{ backgroundColor: e.color + '30', color: e.color, borderLeft: `3px solid ${e.color}` }}
                          onClick={(ev) => { ev.stopPropagation(); if (confirm(`刪除「${e.title}」?`)) deleteMut.mutate(e.id); }}>
                          {e.title}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Day View ── */}
      {view === 'day' && (
        <div className="bg-card border rounded-xl overflow-hidden">
          {/* Day header */}
          <div className="grid grid-cols-2 border-b bg-muted/30">
            <div className="p-3 text-center border-r">
              <div className="text-xs text-muted-foreground">{WEEKDAYS[dayDate.getDay()]}</div>
              <div className={`text-2xl font-bold ${fmt(dayDate) === fmt(today) ? 'text-primary' : ''}`}>{dayDate.getDate()}</div>
              {weekAllDay(dayDate).map((e: any) => (
                <div key={e.id} className="text-xs mt-1 truncate rounded px-2 py-0.5" style={{ backgroundColor: e.color + '30', color: e.color }}>{e.title}</div>
              ))}
            </div>
            <div className="p-3 flex flex-col justify-center text-sm text-muted-foreground">
              <div>{dayDate.getFullYear()} 年 {dayDate.getMonth()+1} 月</div>
              <div className="text-xs mt-1">{evList.filter((e: any) => e.start_time?.startsWith(fmt(dayDate))).length} 個事件</div>
            </div>
          </div>
          {/* Hourly slots */}
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
            {HOURS.map(hour => {
              const he = getHourEvents(dayDate, hour);
              return (
                <div key={hour} className="flex border-b border-muted/30 min-h-[56px] cursor-pointer hover:bg-muted/20 transition-colors"
                  onClick={() => openNew(fmt(dayDate), `${String(hour).padStart(2,'0')}:00`)}>
                  <div className="w-16 flex-shrink-0 p-1 text-[10px] text-muted-foreground text-right pr-2 border-r pt-0.5">
                    {String(hour).padStart(2,'0')}:00
                  </div>
                  <div className="flex-1 p-1">
                    {he.map((e: any) => (
                      <div key={e.id} title={`${e.title} — ${e.start_time?.split('T')[1]?.slice(0,5) || ''} → ${e.end_time?.split('T')[1]?.slice(0,5) || ''}`}
                        className="text-xs rounded px-2 py-1 mb-0.5 cursor-pointer hover:opacity-80"
                        style={{ backgroundColor: e.color + '25', color: e.color, borderLeft: `4px solid ${e.color}` }}
                        onClick={(ev) => { ev.stopPropagation(); if (confirm(`刪除「${e.title}」?`)) deleteMut.mutate(e.id); }}>
                        <span className="font-medium">{e.start_time?.split('T')[1]?.slice(0,5) || ''}</span> {e.title}
                        {e.description && <span className="text-muted-foreground ml-1">— {e.description}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Event Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
          <div className="bg-card border rounded-xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">新增事件</h3>
              <button onClick={() => setShowForm(false)}><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createMut.mutate(form); }} className="space-y-3">
              <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="事件標題 *" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="描述" className="w-full px-3 py-2 border rounded-md bg-background text-sm" rows={2} />
              <div className="grid grid-cols-2 gap-3">
                <select value={form.event_type} onChange={e => setForm({ ...form, event_type: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm">
                  {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm">
                  <option value="">關聯客戶（可選）</option>
                  {(customers?.data || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={form.all_day === 1} onChange={e => setForm({ ...form, all_day: e.target.checked ? 1 : 0 })} className="rounded" />
                <label className="text-sm">全天事件</label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input type="datetime-local" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm" />
                <input type="datetime-local" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
                placeholder="地點" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
              <div className="flex gap-2">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                    className={`w-7 h-7 rounded-full border-2 ${form.color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-md text-sm">取消</button>
                <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">建立</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
