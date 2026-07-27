import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { tr } from '../lib/i18nHelpers';

export default function ChartOfAccounts() {
  const { data, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api('/bookkeeping/accounts') as Promise<{ data?: any[]; results?: any[] }>,
  });

  const accounts = (data?.data || data?.results || []) as any[];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const types = ['asset', 'liability', 'equity', 'revenue', 'expense'];
  const typeLabels: Record<string, string> = {
    asset: tr('Asset', '資產', '资产'),
    liability: tr('Liability', '負債', '负债'),
    equity: tr('Equity', '權益', '权益'),
    revenue: tr('Revenue', '收入', '收入'),
    expense: tr('Expense', '支出', '支出'),
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{tr('Chart of Accounts (COA)', '會計科目表', '会计科目表')}</h2>
        <p className="text-muted-foreground mt-1">
          {tr('5-digit tiered Hong Kong account structure.', '五位數分層香港會計科目結構。', '五位数分层香港会计科目结构。')}
        </p>
      </div>

      {accounts.length === 0 ? (
        <div className="bg-card border rounded-xl p-12 text-center">
          <p className="text-sm text-muted-foreground">{tr('No accounts found. Create your first account to begin.', '暫無科目。請建立第一個科目以開始使用。', '暂无科目。请建立第一个科目以开始使用。')}</p>
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs">
                <th className="px-4 py-2.5 font-medium text-left text-muted-foreground">{tr('Code', '代碼', '代码')}</th>
                <th className="px-4 py-2.5 font-medium text-left text-muted-foreground">{tr('Account Name', '科目名稱', '科目名称')}</th>
                <th className="px-4 py-2.5 font-medium text-left text-muted-foreground">{tr('Type', '類型', '类型')}</th>
                <th className="px-4 py-2.5 font-medium text-left text-muted-foreground">{tr('Parent', '上級', '上级')}</th>
                <th className="px-4 py-2.5 font-medium text-left text-muted-foreground">{tr('Status', '狀態', '状态')}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a: any, i: number) => (
                <tr key={a.id || i} className={`${i % 2 ? 'bg-muted/5' : ''} hover:bg-muted/30 transition-colors`}>
                  <td className="px-4 py-3 font-mono text-xs">{a.account_code || ''}</td>
                  <td className="px-4 py-3">{a.account_name || ''}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{typeLabels[a.account_type] || a.account_type || ''}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{a.parent_code || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${a.is_active !== 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                      {a.is_active !== 0 ? tr('Active', '啟用', '启用') : tr('Inactive', '停用', '停用')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-xs text-muted-foreground">{accounts.length} {tr('accounts', '個科目', '个科目')}</div>
    </div>
  );
}
