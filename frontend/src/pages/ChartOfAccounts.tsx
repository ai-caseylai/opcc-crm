import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { tr } from '../lib/i18nHelpers';
import { Search, Plus, X, ChevronDown, ChevronRight, Building2, BookOpen } from 'lucide-react';

const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

const TYPE_LABELS: Record<string, string> = {
  asset: tr('Assets', '資產', '资产'),
  liability: tr('Liabilities', '負債', '负债'),
  equity: tr('Equity', '權益', '权益'),
  revenue: tr('Revenue', '收入', '收入'),
  expense: tr('Expenses', '支出', '支出'),
};

const TYPE_COLORS: Record<string, string> = {
  asset: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  liability: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  equity: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  revenue: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  expense: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

function getDepth(code: string): number {
  if (!code) return 0;
  const stripped = code.replace(/0+$/, '');
  if (stripped.length <= 1) return 0;
  return Math.max(0, stripped.length - 1);
}

function formatBalance(v: number | null | undefined): string {
  if (v == null || v === 0) return '—';
  return v.toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ChartOfAccounts() {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expandedTypes, setExpandedTypes] = useState<Record<string, boolean>>({
    asset: true, liability: true, equity: true, revenue: true, expense: true,
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAccount, setNewAccount] = useState({
    account_code: '', account_name: '', account_type: 'asset', parent_code: '', opening_balance: 0,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api('/bookkeeping/accounts') as Promise<{ data?: any[]; results?: any[] }>,
  });

  const accounts = (data?.data || data?.results || []) as any[];

  const seedMut = useMutation({
    mutationFn: () => api('/bookkeeping/accounts/seed', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const createMut = useMutation({
    mutationFn: (body: typeof newAccount) => api('/bookkeeping/accounts', { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setShowAddForm(false);
      setNewAccount({ account_code: '', account_name: '', account_type: 'asset', parent_code: '', opening_balance: 0 });
    },
  });

  const toggleType = (t: string) => setExpandedTypes(prev => ({ ...prev, [t]: !prev[t] }));

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Filter accounts
  const filtered = accounts.filter((a: any) => {
    if (typeFilter && a.account_type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (a.account_code || '').toLowerCase().includes(q) || (a.account_name || '').toLowerCase().includes(q);
    }
    return true;
  });

  // Group by type
  const grouped: Record<string, any[]> = {};
  for (const t of TYPE_ORDER) grouped[t] = [];
  for (const a of filtered) {
    const t = a.account_type || 'expense';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(a);
  }

  // Sort each group by code
  for (const t of Object.keys(grouped)) {
    grouped[t].sort((a: any, b: any) => (a.account_code || '').localeCompare(b.account_code || ''));
  }

  const hasAccounts = accounts.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">{tr('Chart of Accounts (COA)', '會計科目表', '会计科目表')}</h2>
          <p className="text-muted-foreground mt-1">
            {tr('5-digit tiered Hong Kong account structure.', '五位數分層香港會計科目結構。', '五位数分层香港会计科目结构。')}
          </p>
        </div>
      </div>

      {/* Empty state */}
      {!hasAccounts && (
        <div className="bg-card border rounded-xl p-12 text-center space-y-4">
          <div className="flex justify-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/50" />
          </div>
          <p className="text-sm text-muted-foreground">{tr(
            'No accounts yet. Start by using the Hong Kong industry template or build your COA manually.',
            '尚無科目。可使用香港行業模板或手動建立會計科目表。',
            '尚无科目。可使用香港行业模板或手动建立会计科目表。',
          )}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => seedMut.mutate()}
              disabled={seedMut.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              <Building2 className="h-4 w-4" />
              {seedMut.isPending ? tr('Seeding...', '正在建立...', '正在建立...') : tr('Use Industry Template', '使用行業模板', '使用行业模板')}
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted/50"
            >
              <Plus className="h-4 w-4" />
              {tr('Build Manually', '手動建立', '手动建立')}
            </button>
          </div>
          {seedMut.isError && <p className="text-sm text-destructive">{(seedMut.error as Error).message}</p>}
          {seedMut.isSuccess && <p className="text-sm text-green-600">{tr('COA seeded successfully!', '科目表建立成功！', '科目表建立成功！')}</p>}
        </div>
      )}

      {/* Filters + Add button */}
      {hasAccounts && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={tr('Search code or name...', '搜尋代碼或名稱...', '搜索代码或名称...')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 border rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{tr('All Types', '所有類型', '所有类型')}</option>
            {TYPE_ORDER.map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
          <div className="flex-1" />
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {tr('Add Account', '新增科目', '新增科目')}
          </button>
        </div>
      )}

      {/* Inline add form */}
      {showAddForm && (
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">{tr('New Account', '新增科目', '新增科目')}</h3>
            <button onClick={() => setShowAddForm(false)} className="p-1 hover:bg-muted rounded">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <input
              placeholder={tr('Code', '代碼', '代码')}
              value={newAccount.account_code}
              onChange={e => setNewAccount(p => ({ ...p, account_code: e.target.value }))}
              className="px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              placeholder={tr('Account Name', '科目名稱', '科目名称')}
              value={newAccount.account_name}
              onChange={e => setNewAccount(p => ({ ...p, account_name: e.target.value }))}
              className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              value={newAccount.account_type}
              onChange={e => setNewAccount(p => ({ ...p, account_type: e.target.value }))}
              className="px-3 py-2 border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {TYPE_ORDER.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
            <input
              placeholder={tr('Parent Code', '上級代碼', '上级代码')}
              value={newAccount.parent_code}
              onChange={e => setNewAccount(p => ({ ...p, parent_code: e.target.value }))}
              className="px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={() => {
                if (newAccount.account_code && newAccount.account_name) createMut.mutate(newAccount);
              }}
              disabled={!newAccount.account_code || !newAccount.account_name || createMut.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {createMut.isPending ? tr('Creating...', '建立中...', '建立中...') : tr('Create', '建立', '建立')}
            </button>
          </div>
          {createMut.isError && <p className="text-sm text-destructive mt-2">{(createMut.error as Error).message}</p>}
        </div>
      )}

      {/* Grouped accounts */}
      {hasAccounts && filtered.length === 0 && (
        <div className="bg-card border rounded-xl p-12 text-center">
          <p className="text-sm text-muted-foreground">{tr('No accounts match your filters.', '沒有符合篩選條件的科目。', '没有符合筛选条件的科目。')}</p>
        </div>
      )}

      {TYPE_ORDER.filter(t => grouped[t]?.length > 0).map(type => (
        <div key={type} className="bg-card border rounded-xl overflow-hidden">
          {/* Section header */}
          <button
            onClick={() => toggleType(type)}
            className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
          >
            {expandedTypes[type] ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${TYPE_COLORS[type]}`}>
              {TYPE_LABELS[type]}
            </span>
            <span className="text-xs text-muted-foreground">
              {grouped[type].length} {tr('accounts', '個科目', '个科目')}
            </span>
          </button>

          {expandedTypes[type] && (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/20 text-xs">
                  <th className="px-4 py-2 font-medium text-left text-muted-foreground">{tr('Code', '代碼', '代码')}</th>
                  <th className="px-4 py-2 font-medium text-left text-muted-foreground">{tr('Account Name', '科目名稱', '科目名称')}</th>
                  <th className="px-4 py-2 font-medium text-right text-muted-foreground">{tr('Opening Balance', '期初餘額', '期初余额')}</th>
                  <th className="px-4 py-2 font-medium text-left text-muted-foreground">{tr('Parent', '上級', '上级')}</th>
                  <th className="px-4 py-2 font-medium text-left text-muted-foreground">{tr('Status', '狀態', '状态')}</th>
                </tr>
              </thead>
              <tbody>
                {grouped[type].map((a: any, i: number) => {
                  const depth = getDepth(a.account_code);
                  return (
                    <tr key={a.id || a.account_code || i} className={`${i % 2 ? 'bg-muted/5' : ''} hover:bg-muted/30 transition-colors`}>
                      <td className="px-4 py-2.5 font-mono text-xs" style={{ paddingLeft: `${16 + depth * 20}px` }}>
                        {a.account_code || ''}
                      </td>
                      <td className="px-4 py-2.5" style={{ paddingLeft: `${16 + depth * 20}px` }}>
                        {a.account_name || ''}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">
                        {formatBalance(a.opening_balance)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{a.parent_code || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${a.is_active !== 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                          {a.is_active !== 0 ? tr('Active', '啟用', '启用') : tr('Inactive', '停用', '停用')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}

      <div className="text-xs text-muted-foreground">{filtered.length} / {accounts.length} {tr('accounts', '個科目', '个科目')}</div>
    </div>
  );
}
