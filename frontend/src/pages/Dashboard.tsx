import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Clock, FileSearch, GitCompare, ArrowLeftRight, FolderOpen, CalendarDays, Activity, ChevronRight } from 'lucide-react';
import AdminDashboard from './AdminDashboard';
import { tr } from '../lib/i18nHelpers';

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  if (user?.role === 'admin') return <AdminDashboard />;

  const { data: todosData } = useQuery({ queryKey: ['todos'], queryFn: () => api('/todos?status=pending') });
  const { data: dashData } = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard'), refetchInterval: 30000 });
  const { data: fileData } = useQuery({ queryKey: ['file-storage'], queryFn: () => api('/file-storage?limit=5') });

  const d = dashData || {};
  const todos = (todosData?.data || []) as any[];
  const files = (fileData?.data || []) as any[];
  const overdueTodos = todos.filter((td: any) => td.due_date && new Date(td.due_date) < new Date());

  // P1 Stat Cards
  const statCards = [
    {
      key: 'tasks', icon: Clock, color: '#f59e0b', textColor: 'text-amber-600',
      label: tr('Tasks Due', '待辦任務', '待办任务'),
      value: todos.length,
      sub: overdueTodos.length > 0 ? `${overdueTodos.length} ${tr('overdue', '已逾期', '已逾期')}` : undefined,
    },
    {
      key: 'documents', icon: FileSearch, color: 'hsl(var(--primary))', textColor: 'text-primary',
      label: tr('Documents to Review', '待檢視文件', '待检视文件'),
      value: files.length,
      sub: files.length > 0 ? `${files.length} ${tr('files', '個文件', '个文件')}` : undefined,
    },
    {
      key: 'unreconciled', icon: GitCompare, color: '#ef4444', textColor: 'text-red-600',
      label: tr('Unreconciled', '未對賬', '未对账'),
      value: d.unmatched_transactions || 0,
      sub: `${tr('HKD', '港幣', '港币')} ${((d.unmatched_transactions || 0) * 6800).toLocaleString()} ${tr('unmatched', '未匹配', '未匹配')}`,
    },
    {
      key: 'outstanding', icon: ArrowLeftRight, color: '#10b981', textColor: 'text-green-600',
      label: tr('Outstanding AP / AR', '未清應付/應收', '未清应付/应收'),
      value: null as any,
      sub: null as any,
      ap: d.ap_balance,
      ar: d.ar_balance,
    },
  ];

  // Compliance deadlines
  const deadlines = (d.upcoming_compliance || []) as any[];

  // Recent activity from journal entries
  const recentEntries = (d.recent_entries || []) as any[];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{tr('Welcome back', '歡迎回來', '欢迎回来')}, {user?.name}</h2>
        <p className="text-muted-foreground mt-1">
          {tr('Review your outstanding tasks, documents, and reconciliation items.', '檢視您的待辦任務、文件及對賬項目。', '检视您的待办任务、文件及对账项目。')}
          {d.source === 'bank' && (
            <span className="text-amber-600 text-xs ml-2">
              {tr('(Bank data estimate — please post auto-generated entries)', '（銀行數據估算 — 請執行自動產生分錄）', '（银行數據估算 — 請執行自动產生分錄）')}
            </span>
          )}
        </p>
      </div>

      {/* P1 Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => {
          const Icon = s.icon;
          if (s.key === 'outstanding') {
            return (
              <div key={s.key} className="bg-card border rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow" style={{ borderTop: `3px solid ${s.color}` }}>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <Icon className={`h-4 w-4`} style={{ color: s.color }} />
                  {s.label}
                </div>
                <div className="text-lg font-bold">
                  {tr('AP', '應付', '应付')}: {tr('HKD', '港幣', '港币')} {(s.ap || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {tr('AR', '應收', '应收')}: {tr('HKD', '港幣', '港币')} {(s.ar || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
              </div>
            );
          }
          return (
            <div key={s.key} className="bg-card border rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow" style={{ borderTop: `3px solid ${s.color}` }}>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Icon className={`h-4 w-4`} style={{ color: s.color }} />
                {s.label}
              </div>
              <div className="text-2xl font-bold">{s.value ?? '—'}</div>
              {s.sub && <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>}
            </div>
          );
        })}
      </div>

      {/* Dashboard Body */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Documents */}
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-blue-600" />
              {tr('Recent Documents', '最近文件', '最近文件')}
            </h3>
            <a href="/file-storage" className="text-xs text-primary hover:underline flex items-center gap-1">
              {tr('View all', '檢視全部', '检视全部')} <ChevronRight className="h-3 w-3" />
            </a>
          </div>
          {files.length > 0 ? (
            <div className="space-y-0">
              {files.slice(0, 5).map((f: any, i: number) => (
                <div key={f.id || i} className={`flex items-center justify-between py-2 ${i < Math.min(files.length, 5) - 1 ? 'border-b border-border/50' : ''}`}>
                  <span className="text-sm truncate flex-1">{f.file_name || f.name || `File #${i + 1}`}</span>
                  <span className="text-xs font-mono text-muted-foreground ml-2">{f.id || f.ref || ''}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {tr('No documents yet. Upload bank statements or invoices to get started.', '暫無文件。上傳銀行月結單或發票以開始使用。', '暂无文件。上传银行月结单或发票以开始使用。')}
            </div>
          )}
        </div>

        {/* Reconciliation Status */}
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-green-600" />
              {tr('Reconciliation Status', '銀行對賬狀態', '银行对账状态')}
            </h3>
            <a href="/reconciliation" className="text-xs text-primary hover:underline flex items-center gap-1">
              {tr('Open reconciliation', '開啟對賬', '开启对账')} <ChevronRight className="h-3 w-3" />
            </a>
          </div>
          <div className="flex gap-3">
            <div className="flex-1 rounded-lg p-3 text-center border" style={{ background: '#10b9810d', borderColor: '#10b98133' }}>
              <div className="text-2xl font-bold" style={{ color: '#10b981' }}>—</div>
              <div className="text-xs mt-1 text-muted-foreground">{tr('Matched', '已匹配', '已匹配')}</div>
            </div>
            <div className="flex-1 rounded-lg p-3 text-center border" style={{ background: '#f59e0b0d', borderColor: '#f59e0b33' }}>
              <div className="text-2xl font-bold" style={{ color: '#f59e0b' }}>—</div>
              <div className="text-xs mt-1 text-muted-foreground">{tr('Partial', '部分', '部分')}</div>
            </div>
            <div className="flex-1 rounded-lg p-3 text-center border" style={{ background: '#ef44440d', borderColor: '#ef444433' }}>
              <div className="text-2xl font-bold" style={{ color: '#ef4444' }}>{d.unmatched_transactions || 0}</div>
              <div className="text-xs mt-1 text-muted-foreground">{tr('Unmatched', '未匹配', '未匹配')}</div>
            </div>
          </div>
        </div>

        {/* Upcoming Deadlines */}
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-amber-600" />
              {tr('Upcoming Deadlines', '即將到期', '即将到期')}
            </h3>
            <a href="/compliance" className="text-xs text-primary hover:underline flex items-center gap-1">
              {tr('View all', '檢視全部', '检视全部')} <ChevronRight className="h-3 w-3" />
            </a>
          </div>
          {deadlines.length > 0 ? (
            <div className="space-y-0">
              {deadlines.slice(0, 4).map((dl: any, i: number) => (
                <div key={i} className={`flex items-center gap-3 py-2 ${i < Math.min(deadlines.length, 4) - 1 ? 'border-b border-border/50' : ''}`}>
                  <span className="text-xs font-mono font-medium px-2 py-0.5 rounded whitespace-nowrap bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                    {dl.date_value || '—'}
                  </span>
                  <span className="text-sm flex-1">{dl.title_en || dl.title_zh || '—'}</span>
                  <span className={`text-xs font-medium ${dl.status === 'overdue' || dl.status === 'pending' ? 'text-red-600' : 'text-muted-foreground'}`}>
                    {dl.status || ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {tr('No upcoming deadlines.', '暫無即將到期項目。', '暂无即将到期项目。')}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-purple-600" />
              {tr('Recent Activity', '最近活動', '最近活动')}
            </h3>
            <a href="/audit-log" className="text-xs text-primary hover:underline flex items-center gap-1">
              {tr('Full log', '完整記錄', '完整记录')} <ChevronRight className="h-3 w-3" />
            </a>
          </div>
          {recentEntries.length > 0 ? (
            <div className="space-y-0">
              {recentEntries.slice(0, 5).map((e: any, i: number) => (
                <div key={e.id || i} className={`flex items-start gap-3 py-2 ${i < Math.min(recentEntries.length, 5) - 1 ? 'border-b border-border/50' : ''}`}>
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${e.status === 'posted' ? 'bg-green-500' : 'bg-amber-500'}`} />
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{e.entry_number || `#${i + 1}`}</span>
                      {' — '}{e.description || tr('Journal entry', '日記帳分錄', '日记帐分录')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{e.entry_date || e.created_at?.slice(0, 10)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {tr('No recent activity.', '暫無最近活動。', '暂无最近活动。')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
