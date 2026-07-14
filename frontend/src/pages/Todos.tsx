import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Plus, Trash2, Check, Circle, GripVertical, ChevronDown } from 'lucide-react';

const PRIORITIES = { high: '🔴', medium: '🟡', low: '🟢' } as const;
const priorityLabel = (p: string) => ({ high: '高', medium: '中', low: '低' } as Record<string,string>)[p] || p;

export default function Todos() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['todos', filter],
    queryFn: () => api(`/todos${filter ? `?status=${filter}` : ''}`),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => api('/todos', { method: 'POST', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['todos'] }); setTitle(''); setAdding(false); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: any) => api(`/todos/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/todos/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });

  const handleAdd = () => {
    if (!title.trim()) return;
    createMut.mutate({ title: title.trim(), priority, due_date: dueDate || null });
  };

  const todos = (data?.data || []) as any[];
  const pending = todos.filter((t: any) => t.status === 'pending');
  const completed = todos.filter((t: any) => t.status === 'completed');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('todos.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('todos.desc')}</p>
      </div>

      {/* Add */}
      <div className="bg-card border rounded-xl p-4 space-y-3">
        <div className="flex gap-2">
          <input value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            placeholder={t('todos.placeholder')}
            className="flex-1 px-3 py-2 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          <select value={priority} onChange={e => setPriority(e.target.value)}
            className="px-2 py-2 border rounded-md bg-background text-sm w-20">
            <option value="high">🔴</option><option value="medium">🟡</option><option value="low">🟢</option>
          </select>
          <button onClick={handleAdd} disabled={!title.trim() || createMut.isPending}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {adding && (
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="w-40 px-3 py-1.5 border rounded-md bg-background text-sm" />
        )}
        <button onClick={() => setAdding(!adding)} className="text-xs text-muted-foreground hover:underline">
          {adding ? '隱藏日期' : '+ 到期日'}
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {[{k:'',l:'全部'},{k:'pending',l:'待辦'},{k:'completed',l:'已完成'}].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === f.k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
            {f.l}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? <p className="text-sm text-muted-foreground text-center py-8">{t('common.loading')}</p> :
       todos.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">{t('todos.empty')}</p> : (
        <div className="space-y-2">
          {pending.map((td: any) => (
            <div key={td.id} className="flex items-center gap-3 bg-card border rounded-lg px-4 py-3 group">
              <button onClick={() => updateMut.mutate({ id: td.id, status: 'completed' })}
                className="text-muted-foreground hover:text-primary flex-shrink-0">
                <Circle className="h-5 w-5" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm">{td.title}</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <span>{PRIORITIES[td.priority as keyof typeof PRIORITIES] || '⚪'} {priorityLabel(td.priority)}</span>
                  {td.due_date && <span>{td.due_date}</span>}
                </div>
              </div>
              <button onClick={() => { if (confirm(t('common.confirmDelete'))) deleteMut.mutate(td.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded text-destructive transition-opacity">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {completed.length > 0 && (
            <details>
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground py-2">
                <ChevronDown className="h-3 w-3 inline mr-1" /> 已完成 ({completed.length})
              </summary>
              <div className="space-y-2 mt-1">
                {completed.map((td: any) => (
                  <div key={td.id} className="flex items-center gap-3 bg-muted/30 border rounded-lg px-4 py-3 opacity-70">
                    <button onClick={() => updateMut.mutate({ id: td.id, status: 'pending' })}
                      className="text-primary flex-shrink-0">
                      <Check className="h-5 w-5" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm line-through">{td.title}</div>
                    </div>
                    <button onClick={() => deleteMut.mutate(td.id)}
                      className="p-1 hover:bg-muted rounded text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
