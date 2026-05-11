import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Calculator, Download } from 'lucide-react';

export default function Bookkeeping() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'entries' | 'accounts' | 'trial' | 'pl' | 'ledger' | 'export'>('entries');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [ledgerAccount, setLedgerAccount] = useState('');
  const [entryForm, setEntryForm] = useState({
    entry_number: '', entry_date: new Date().toISOString().split('T')[0], description: '',
    lines: [{ account_code: '', account_name: '', description: '', debit: 0, credit: 0 }],
  });

  const { data: entries } = useQuery({
    queryKey: ['entries', startDate, endDate],
    queryFn: () => api(`/bookkeeping/entries?start_date=${startDate}&end_date=${endDate}`),
    enabled: tab === 'entries',
  });

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api('/bookkeeping/accounts'),
    enabled: tab === 'accounts',
  });

  const { data: trialBalance } = useQuery({
    queryKey: ['trial-balance'],
    queryFn: () => api('/bookkeeping/trial-balance'),
    enabled: tab === 'trial',
  });

  const { data: incomeStatement } = useQuery({
    queryKey: ['income-statement', startDate, endDate],
    queryFn: () => api(`/bookkeeping/income-statement?start_date=${startDate}&end_date=${endDate}`),
    enabled: tab === 'pl',
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery({
    queryKey: ['ledger', ledgerAccount, startDate, endDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);
      if (ledgerAccount) params.set('account_code', ledgerAccount);
      const qs = params.toString();
      return api(`/bookkeeping/ledger${qs ? `?${qs}` : ''}`);
    },
    enabled: tab === 'ledger',
  });

  const autoGenMut = useMutation({
    mutationFn: () => api('/bookkeeping/auto-generate-entries', { method: 'POST' }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      queryClient.invalidateQueries({ queryKey: ['entries'] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
      queryClient.invalidateQueries({ queryKey: ['income-statement'] });
      alert(`已建立 ${data.created} 筆分錄（共 ${data.total_transactions} 筆銀行交易，跳過 ${data.skipped} 筆已存在）`);
    },
  });

  const createEntry = useMutation({
    mutationFn: (body: any) => api('/bookkeeping/entries', { method: 'POST', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['entries'] }); setShowEntryForm(false); },
  });

  const exportCSV = async () => {
    const csv = await api(`/bookkeeping/export?format=csv&start_date=${startDate}&end_date=${endDate}`);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'bookkeeping-export.csv'; a.click();
  };

  function addLine() {
    setEntryForm({
      ...entryForm,
      lines: [...entryForm.lines, { account_code: '', account_name: '', description: '', debit: 0, credit: 0 }],
    });
  }

  function updateLine(idx: number, field: string, value: any) {
    const lines = [...entryForm.lines];
    lines[idx] = { ...lines[idx], [field]: value };
    if (field === 'debit') lines[idx].credit = 0;
    if (field === 'credit') lines[idx].debit = 0;
    setEntryForm({ ...entryForm, lines });
  }

  const tabs = [
    { id: 'entries', label: '分錄 Entries' },
    { id: 'accounts', label: '科目 Accounts' },
    { id: 'ledger', label: '分類帳 Ledger' },
    { id: 'trial', label: '試算 Trial Balance' },
    { id: 'pl', label: '損益 P&L' },
    { id: 'export', label: '導出 Export' },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">記帳 Bookkeeping</h2>
          <p className="text-muted-foreground mt-1">雙式記帳管理</p>
        </div>
        <button onClick={() => setShowEntryForm(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
          <Plus className="h-4 w-4" /> 新增分錄
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Date filters for relevant tabs */}
      {(tab === 'entries' || tab === 'pl' || tab === 'ledger' || tab === 'export') && (
        <div className="flex gap-3">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 border rounded-md bg-background text-sm" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 border rounded-md bg-background text-sm" />
        </div>
      )}

      {/* Entries Tab */}
      {tab === 'entries' && (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3">號碼</th>
                <th className="text-left p-3">日期</th>
                <th className="text-left p-3">描述</th>
                <th className="text-left p-3">狀態</th>
              </tr>
            </thead>
            <tbody>
              {(entries?.data || []).map((e: any) => (
                <tr key={e.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{e.entry_number}</td>
                  <td className="p-3">{e.entry_date}</td>
                  <td className="p-3">{e.description}</td>
                  <td className="p-3">{e.status}</td>
                </tr>
              ))}
              {(!entries?.data || entries.data.length === 0) && (
                <tr><td colSpan={4} className="text-center p-6 text-muted-foreground">未有分錄記錄</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Accounts Tab */}
      {tab === 'accounts' && (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3">科目編號</th>
                <th className="text-left p-3">科目名稱</th>
                <th className="text-left p-3">類別</th>
              </tr>
            </thead>
            <tbody>
              {(accounts?.data || []).map((a: any) => (
                <tr key={a.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{a.account_code}</td>
                  <td className="p-3">{a.account_name}</td>
                  <td className="p-3 capitalize">{a.account_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Trial Balance Tab */}
      {tab === 'trial' && (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3">科目</th>
                <th className="text-right p-3">借方 Debit</th>
                <th className="text-right p-3">貸方 Credit</th>
              </tr>
            </thead>
            <tbody>
              {(trialBalance?.data || []).map((row: any) => (
                <tr key={row.account_code} className="border-b hover:bg-muted/30">
                  <td className="p-3">{row.account_code} – {row.account_name}</td>
                  <td className="p-3 text-right">{row.total_debit?.toLocaleString()}</td>
                  <td className="p-3 text-right">{row.total_credit?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Ledger Tab */}
      {tab === 'ledger' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select value={ledgerAccount} onChange={e => setLedgerAccount(e.target.value)}
              className="px-3 py-2 border rounded-md bg-background text-sm min-w-[180px]">
              <option value="">所有科目</option>
              {(accounts?.data || []).map((a: any) => (
                <option key={a.account_code} value={a.account_code}>{a.account_code} – {a.account_name}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">資料來源：{ledgerData?.source === 'journal' ? '分錄' : '銀行交易'}</span>
            <button onClick={() => autoGenMut.mutate()} disabled={autoGenMut.isPending}
              className="ml-auto flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-md text-xs hover:opacity-90 disabled:opacity-40">
              <Calculator className="h-3 w-3" /> 從銀行資料自動產生分錄
            </button>
          </div>

          {ledgerLoading ? (
            <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>
          ) : (ledgerData?.accounts || []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">未有分類帳資料</p>
          ) : (
            (ledgerData?.accounts || []).map((acct: any) => (
              <div key={acct.account_code} className="bg-card border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center justify-between">
                  <span className="font-medium text-sm">{acct.account_code} – {acct.account_name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{acct.account_type}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left py-2 px-4 font-medium">日期</th>
                      <th className="text-left py-2 px-3 font-medium">描述</th>
                      <th className="text-right py-2 px-3 font-medium">借方 Debit</th>
                      <th className="text-right py-2 px-3 font-medium">貸方 Credit</th>
                      <th className="text-right py-2 px-3 font-medium">餘額 Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acct.entries.map((e: any, i: number) => (
                      <tr key={i} className="border-b border-muted/30 hover:bg-muted/20">
                        <td className="py-1.5 px-4 whitespace-nowrap text-muted-foreground">{e.date}</td>
                        <td className="py-1.5 px-3 max-w-[300px] truncate">{e.description}</td>
                        <td className="py-1.5 px-3 text-right font-mono">{e.debit > 0 ? e.debit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''}</td>
                        <td className="py-1.5 px-3 text-right font-mono">{e.credit > 0 ? e.credit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''}</td>
                        <td className={`py-1.5 px-3 text-right font-mono font-medium ${e.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {e.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 text-xs font-medium">
                      <td className="py-2 px-4" colSpan={2}>合計</td>
                      <td className="py-2 px-3 text-right font-mono">{acct.total_debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="py-2 px-3 text-right font-mono">{acct.total_credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ))
          )}
        </div>
      )}

      {/* P&L Tab */}
      {tab === 'pl' && incomeStatement && (
        <div className="bg-card border rounded-xl p-6 max-w-md space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">收入 Revenue</span>
            <span className="font-semibold text-green-600">HKD {incomeStatement.revenue?.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">支出 Expenses</span>
            <span className="font-semibold text-red-600">HKD {incomeStatement.expenses?.toLocaleString()}</span>
          </div>
          <div className="flex justify-between border-t pt-2">
            <span className="font-bold">淨利 Net Income</span>
            <span className={`font-bold ${(incomeStatement.net_income || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              HKD {incomeStatement.net_income?.toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Export Tab */}
      {tab === 'export' && (
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">導出給審計師 Export for Auditor</h3>
          <p className="text-sm text-muted-foreground">選擇日期範圍後導出 CSV 檔案</p>
          <div className="flex gap-3 items-center">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border rounded-md bg-background text-sm" />
            <span className="text-muted-foreground">至</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border rounded-md bg-background text-sm" />
            <button onClick={exportCSV}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:opacity-90">
              <Download className="h-4 w-4" /> 導出 CSV
            </button>
          </div>
        </div>
      )}

      {/* Entry Form Modal */}
      {showEntryForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto" onClick={() => setShowEntryForm(false)}>
          <div className="bg-card border rounded-xl p-6 w-full max-w-2xl mx-4 my-8 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg">新增分錄 Journal Entry</h3>
            <form onSubmit={(e) => { e.preventDefault(); createEntry.mutate(entryForm); }} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <input required value={entryForm.entry_number} onChange={(e) => setEntryForm({ ...entryForm, entry_number: e.target.value })}
                  placeholder="分錄號碼 *" className="px-3 py-2 border rounded-md bg-background text-sm" />
                <input type="date" required value={entryForm.entry_date} onChange={(e) => setEntryForm({ ...entryForm, entry_date: e.target.value })}
                  className="px-3 py-2 border rounded-md bg-background text-sm" />
                <input required value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })}
                  placeholder="描述 *" className="px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <div className="border rounded-md p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">分錄行 Lines</span>
                  <button type="button" onClick={addLine} className="text-xs text-primary hover:underline">+ 新增行</button>
                </div>
                {entryForm.lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input required value={line.account_code} onChange={(e) => updateLine(idx, 'account_code', e.target.value)}
                      placeholder="科目編號" className="col-span-2 px-2 py-1 border rounded text-sm" />
                    <input required value={line.account_name} onChange={(e) => updateLine(idx, 'account_name', e.target.value)}
                      placeholder="科目名稱" className="col-span-3 px-2 py-1 border rounded text-sm" />
                    <input type="number" step="0.01" value={line.debit} onChange={(e) => updateLine(idx, 'debit', parseFloat(e.target.value))}
                      className="col-span-2 px-2 py-1 border rounded text-sm" placeholder="借方" />
                    <input type="number" step="0.01" value={line.credit} onChange={(e) => updateLine(idx, 'credit', parseFloat(e.target.value))}
                      className="col-span-2 px-2 py-1 border rounded text-sm" placeholder="貸方" />
                    <input value={line.description} onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      placeholder="描述" className="col-span-2 px-2 py-1 border rounded text-sm" />
                    <button type="button" onClick={() => {
                      const lines = entryForm.lines.filter((_, i) => i !== idx);
                      setEntryForm({ ...entryForm, lines: lines.length ? lines : [{ account_code: '', account_name: '', description: '', debit: 0, credit: 0 }] });
                    }} className="col-span-1 text-destructive text-xs">✕</button>
                  </div>
                ))}
                <div className="text-sm text-muted-foreground">
                  借方總計: {entryForm.lines.reduce((s, l) => s + (l.debit || 0), 0).toFixed(2)} |
                  貸方總計: {entryForm.lines.reduce((s, l) => s + (l.credit || 0), 0).toFixed(2)}
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowEntryForm(false)} className="px-4 py-2 border rounded-md text-sm">取消</button>
                <button type="submit" disabled={createEntry.isPending}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">建立</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
