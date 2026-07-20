import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Eye, Trash2, Landmark, ChevronDown, ChevronRight, FileText, Link2, Check, X, Zap, Search, Tag, Download, Upload, FilePlus, Pencil } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import SupervisorPasswordModal from '../components/SupervisorPasswordModal';

interface Transaction {
  id: string;
  transaction_date: string;
  description: string;
  deposit_amount: number;
  withdrawal_amount: number;
  balance: number;
  account_type: string;
  account_code?: string | null;
  reference: string | null;
  sort_order: number;
  invoice_id?: string | null;
  match_confidence?: string | null;
  match_status?: string;
  invoice_number?: string | null;
  invoice_total?: number | null;
  invoice_status?: string | null;
}

export default function BankStatements() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isStaff = user?.role === 'staff' || user?.role === 'viewer';
  const [supModal, setSupModal] = useState<{ show: boolean; onConfirm: () => void } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [matchTxId, setMatchTxId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [edits, setEdits] = useState<Record<string, Partial<Transaction>>>({});
  const [acctModalTx, setAcctModalTx] = useState<Transaction | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [reconData, setReconData] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['bank-statements'],
    queryFn: () => api('/bank-statements'),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api('/bookkeeping/accounts'),
  });
  const accounts: any[] = accountsData?.data || [];

  const detailQuery = useQuery({
    queryKey: ['bank-statement', expandedId],
    queryFn: () => api(`/bank-statements/${expandedId}`),
    enabled: !!expandedId,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/bank-statements/${id}`, { method: 'DELETE' }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['bank-statements-drafts'] });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions-flat'] });
      queryClient.invalidateQueries({ queryKey: ['file-storage'] });
      setExpandedId(null);
      const cascadeMsg = data?.transactions_deleted != null
        ? `\n${data.transactions_deleted} transaction${data.transactions_deleted === 1 ? '' : 's'} also removed.`
        : '';
      const fileMsg = data?.file_deleted ? '\nOriginal PDF also removed from File Storage.' : '';
      const restoreMsg = data?.restorable_until
        ? '\n\nItem moved to Recycle Bin — can be restored within 30 days.'
        : '';
      if (cascadeMsg || fileMsg || restoreMsg) {
        setTimeout(() => alert(`Statement deleted.${cascadeMsg}${fileMsg}${restoreMsg}`), 10);
      }
    },
    onError: (err: any) => {
      if (err?.status === 403 || /higher permission/i.test(err?.error || err?.message || '')) {
        alert('Delete not allowed for your account. Only account owner or boss-level users can delete records. Please ask your admin.');
      } else {
        alert(`Delete failed: ${err?.error || err?.message || 'Unknown error'}`);
      }
    },
  });

  const autoMatchMut = useMutation({
    mutationFn: () => api('/bank-statements/auto-match', { method: 'POST' }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['bank-statement', expandedId] });
      alert(i18n.language === 'en'
        ? `Auto-match done: ${data.matched?.length || 0} suggested, ${data.unmatched_count || 0} unmatched`
        : `配對完成：${data.matched?.length || 0} 筆建議，${data.unmatched_count || 0} 筆未配對`);
    },
  });

  const confirmMatchMut = useMutation({
    mutationFn: ({ txId, invoiceId }: { txId: string; invoiceId: string }) =>
      api(`/bank-statements/transactions/${txId}/match`, {
        method: 'PATCH',
        body: JSON.stringify({ invoice_id: invoiceId, action: 'confirm' }),
      }),
    onSuccess: async (_data: any, variables: { txId: string; invoiceId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['bank-statement', expandedId] });
      // Auto-post payment to GL: Dr Cash, Cr AR
      try {
        await api(`/bookkeeping/post-payment/${variables.txId}`, { method: 'POST' });
        queryClient.invalidateQueries({ queryKey: ['entries'] });
      } catch { /* may already be posted */ }
    },
  });

  const unlinkMut = useMutation({
    mutationFn: (txId: string) =>
      api(`/bank-statements/transactions/${txId}/match`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'unlink' }),
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bank-statement', expandedId] }); },
  });

  const createInvoiceMut = useMutation({
    mutationFn: (txId: string) => api('/invoices/generate-from-transaction', { method: 'POST', body: { transaction_id: txId } }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['bank-statement', expandedId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      navigate(`/invoices?highlight=${data.id}`);
    },
    onError: (err: any) => {
      alert(`Could not create invoice: ${err?.error || err?.message || 'Unknown error'}`);
    },
  });

  const autoCatMut = useMutation({
    mutationFn: () => api(`/bank-statements/${expandedId}/auto-categorize`, { method: 'POST' }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['bank-statement', expandedId] });
      alert(i18n.language === 'en'
        ? `Auto-categorized: ${data.categorized} rows, skipped ${data.skipped} (total ${data.total})`
        : `已自動分類：${data.categorized} 筆，跳過 ${data.skipped} 筆（共 ${data.total} 筆）`);
    },
  });

  const updateTxMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      api(`/bank-statements/transactions/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-statement', expandedId] });
    },
  });

  const statements = (data?.data || []) as any[];
  const detail = detailQuery.data as any;
  const transactions = detail?.transactions || [];

  const totalDeposits = transactions.reduce((s: number, tx: Transaction) => s + tx.deposit_amount, 0);
  const totalWithdrawals = transactions.reduce((s: number, tx: Transaction) => s + tx.withdrawal_amount, 0);
  const suggestedCount = transactions.filter((tx: Transaction) => tx.match_status === 'suggested').length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('bank.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('bank.desc')}</p>
      </div>

      <PendingReviewBanner />

      {/* Continuity Chain */}
      <ContinuityChain />

      {/* Statements list */}
      <div className="bg-card border rounded-xl p-6 space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Landmark className="h-4 w-4" /> {t('bank.list')} ({statements.length})
        </h3>
        {isLoading ? <p className="text-sm text-muted-foreground">{t('common.loading')}</p> :
         statements.length === 0 ? <p className="text-sm text-muted-foreground">{t('bank.noData')}</p> : (
          <div className="space-y-2">
            {statements.map((s: any) => (
              <div key={s.id}>
                <div
                  className="flex items-center justify-between border rounded-md px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      {expandedId === s.id
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                      <span className="text-sm font-medium truncate">
                        {s.statement_year}-{String(s.statement_month).padStart(2, '0')} {s.bank_name || 'Statement'}
                      </span>
                      {s.account_type && (
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{s.account_type}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground ml-6">
                      {s.account_number && <span>{s.account_number}</span>}
                      {s.branch && <span className="text-muted-foreground/60">{s.branch}</span>}
                      {s.currency && <span className="font-mono">{s.currency}</span>}
                      {s.closing_balance != null && (
                        <span className={`font-mono font-medium ${s.closing_balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {s.closing_balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                    <a href={`/api/bank-statements/${s.id}/file`} target="_blank" className="p-1.5 hover:bg-muted rounded" title="View original file">
                      <Eye className="h-4 w-4" />
                    </a>
                    <button
                      onClick={() => {
                        setExpandedId(s.id);
                        setEditMode(true);
                        setEdits({});
                      }}
                      className="p-1.5 hover:bg-muted rounded"
                      title="Edit transactions"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => {
                      const doDelete = () => deleteMut.mutate(s.id);
                      if (isStaff) {
                        setSupModal({ show: true, onConfirm: doDelete });
                      } else {
                        if (confirm(t('common.confirmDelete'))) doDelete();
                      }
                    }}
                      className="p-1.5 hover:bg-muted rounded text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded: Transaction table */}
                {expandedId === s.id && (
                  <div className="border-x border-b rounded-b-md bg-muted/10 px-4 py-3">
                    {detailQuery.isLoading ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        {i18n.language === 'en' ? 'Loading transactions...' : '載入交易中...'}
                      </p>
                    ) : transactions.length === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                        <FileText className="h-4 w-4" />
                        {i18n.language === 'en' ? 'No transactions found' : '沒有找到交易'}
                      </div>
                    ) : (
                      <div>
                        {/* Summary bar */}
                        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground mb-3 px-1">
                          <div className="flex flex-wrap items-center gap-3">
                            {detail?.period_start && (
                              <span>Period: {detail.period_start} – {detail.period_end}</span>
                            )}
                            <span>Opening: <span className="font-mono font-medium">{detail?.opening_balance?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '-'}</span></span>
                            <span>Closing: <span className="font-mono font-medium text-green-600">{detail?.closing_balance?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '-'}</span></span>
                            <div className="flex items-center gap-1">
                              {!isStaff && (
                              <a href={`/api/bank-statements/${detail?.id}/export-csv`}
                                className="px-2 py-1 text-xs rounded border hover:bg-muted flex items-center gap-1"
                                title="Export CSV">
                                <Download className="h-3 w-3" /> CSV
                              </a>
                              )}
                              <label className="px-2 py-1 text-xs rounded border hover:bg-muted cursor-pointer flex items-center gap-1"
                                title="Import CSV">
                                <Upload className="h-3 w-3" /> CSV
                                <input type="file" accept=".csv" className="hidden"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    const text = await file.text();
                                    try {
                                      await api(`/bank-statements/${detail?.id}/import-csv`, {
                                        method: 'POST',
                                        body: { csv: text },
                                      });
                                      queryClient.invalidateQueries({ queryKey: ['bank-statement', expandedId] });
                                      alert(i18n.language === 'en' ? 'CSV import complete' : 'CSV 匯入完成');
                                    } catch (err: any) {
                                      alert((i18n.language === 'en' ? 'Import failed: ' : '匯入失敗：') + (err.message || 'unknown'));
                                    }
                                    e.target.value = '';
                                  }} />
                              </label>
                              <button onClick={() => { setEditMode(!editMode); setEdits({}); }}
                                className={`px-2 py-1 text-xs rounded border ${editMode ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}>
                                {editMode
                                  ? (i18n.language === 'en' ? 'Done Editing' : '完成編輯')
                                  : (i18n.language === 'en' ? '✏️ Edit' : '✏️ 編輯')}
                              </button>
                              <button onClick={async () => {
                                if (!detail?.id) return;
                                try {
                                  const res = await api(`/bank-statements/${detail.id}/reconcile`, { method: 'POST' });
                                  setReconData(res);
                                } catch (err: any) {
                                  alert((i18n.language === 'en' ? 'Reconcile failed: ' : '對賬失敗：') + (err.message || 'unknown'));
                                }
                              }}
                                className="px-2 py-1 text-xs rounded border hover:bg-green-100">
                                {i18n.language === 'en' ? '🔍 Reconcile' : '🔍 對賬 Reconcile'}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b text-left text-xs text-muted-foreground">
                                <th className="py-2 pr-3 font-medium">Date</th>
                                <th className="py-2 pr-3 font-medium">Description</th>
                                {detail?.accounts?.length > 1 && <th className="py-2 pr-3 font-medium">Account</th>}
                                <th className="py-2 pr-3 font-medium text-right">Deposit</th>
                                <th className="py-2 pr-3 font-medium text-right">Withdrawal</th>
                                <th className="py-2 pr-3 font-medium text-right">Balance</th>
                                <th className="py-2 pr-3 font-medium min-w-[200px]">Account</th>
                                <th className="py-2 font-medium text-center">Invoice</th>
                                {editMode && <th className="py-2 font-medium text-center w-16">Save</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {transactions.map((tx: Transaction) => {
                                const e = edits[tx.id] || {};
                                const date = e.transaction_date !== undefined ? e.transaction_date : tx.transaction_date;
                                const desc = e.description !== undefined ? e.description : tx.description;
                                const dep = e.deposit_amount !== undefined ? e.deposit_amount : tx.deposit_amount;
                                const wit = e.withdrawal_amount !== undefined ? e.withdrawal_amount : tx.withdrawal_amount;
                                const bal = e.balance !== undefined ? e.balance : tx.balance;
                                const dirty = !!edits[tx.id];

                                return (
                                <tr key={tx.id} className={`border-b border-muted/50 hover:bg-muted/20 ${dirty ? 'bg-blue-50 dark:bg-blue-950/20' : ''} ${
                                  tx.match_status === 'suggested' ? 'bg-yellow-50 dark:bg-yellow-950/20' :
                                  tx.match_status === 'confirmed' ? 'bg-green-50 dark:bg-green-950/20' : ''
                                }`}>
                                  <td className="py-1.5 pr-3 whitespace-nowrap">
                                    {editMode ? (
                                      <input value={date || ''} onChange={e => setEdits(prev => ({...prev, [tx.id]: {...prev[tx.id], transaction_date: e.target.value}}))}
                                        className="w-24 px-1 py-0.5 border rounded text-xs bg-background" />
                                    ) : (
                                      <span className="text-muted-foreground">{tx.transaction_date?.slice(5)}</span>
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-3 max-w-[300px]">
                                    {editMode ? (
                                      <input value={desc || ''} onChange={e => setEdits(prev => ({...prev, [tx.id]: {...prev[tx.id], description: e.target.value}}))}
                                        className="w-full px-1 py-0.5 border rounded text-xs bg-background" />
                                    ) : (
                                      <span className="truncate block">{tx.description}</span>
                                    )}
                                  </td>
                                  {detail?.accounts?.length > 1 && (
                                    <td className="py-1.5 pr-3">
                                      <span className="text-xs bg-muted px-1 rounded">{tx.account_type}</span>
                                    </td>
                                  )}
                                  <td className="py-1.5 pr-3 text-right font-mono text-green-600">
                                    {editMode ? (
                                      <input type="number" step="0.01" value={dep || 0} onChange={e => setEdits(prev => ({...prev, [tx.id]: {...prev[tx.id], deposit_amount: parseFloat(e.target.value) || 0}}))}
                                        className="w-24 px-1 py-0.5 border rounded text-xs text-right bg-background" />
                                    ) : (
                                      dep > 0 ? dep.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-3 text-right font-mono text-red-600">
                                    {editMode ? (
                                      <input type="number" step="0.01" value={wit || 0} onChange={e => setEdits(prev => ({...prev, [tx.id]: {...prev[tx.id], withdrawal_amount: parseFloat(e.target.value) || 0}}))}
                                        className="w-24 px-1 py-0.5 border rounded text-xs text-right bg-background" />
                                    ) : (
                                      wit > 0 ? wit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-3 text-right font-mono">
                                    {editMode ? (
                                      <input type="number" step="0.01" value={bal != null ? bal : 0} onChange={e => setEdits(prev => ({...prev, [tx.id]: {...prev[tx.id], balance: parseFloat(e.target.value) || 0}}))}
                                        className="w-24 px-1 py-0.5 border rounded text-xs text-right bg-background" />
                                    ) : (
                                      bal > 0 ? bal.toLocaleString(undefined, { minimumFractionDigits: 2 }) :
                                      bal < 0 ? <span className="text-red-600">{bal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span> :
                                      '0.00'
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-3" onClick={e => e.stopPropagation()}>
                                    {tx.account_code ? (
                                      (() => {
                                        const acc = accounts.find((a: any) => a.account_code === tx.account_code);
                                        const name = acc?.account_name || '(unknown account)';
                                        return (
                                          <span
                                            className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded cursor-pointer hover:bg-primary/20 inline-block max-w-[260px] truncate"
                                            title={`${tx.account_code} · ${name}`}
                                            onClick={() => setAcctModalTx(tx)}>
                                            <span className="font-mono">{tx.account_code}</span>
                                            <span className="text-muted-foreground ml-1">{name}</span>
                                          </span>
                                        );
                                      })()
                                    ) : (
                                      <select
                                        className="text-xs border rounded px-1 py-0.5 bg-background max-w-[260px] truncate cursor-pointer"
                                        value={tx.account_code || ''}
                                        onChange={e => {
                                          if (e.target.value) {
                                            updateTxMut.mutate({ id: tx.id, body: { account_code: e.target.value } });
                                          }
                                        }}
                                        onClick={e => e.stopPropagation()}
                                      >
                                        <option value="" className="text-muted-foreground">
                          {i18n.language === 'en' ? '-- Select account --' : '-- 選科目 --'}
                        </option>
                                        {accounts.map((a: any) => (
                                          <option key={a.account_code} value={a.account_code}>
                                            {a.account_code} {a.account_name}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </td>
                                  <td className="py-1.5 text-center">
                                    {tx.match_status === 'confirmed' && tx.invoice_number && (
                                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded">
                                        {tx.invoice_number}
                                        <button onClick={() => unlinkMut.mutate(tx.id)} className="hover:text-red-600" title="Unlink">
                                          <X className="h-3 w-3" />
                                        </button>
                                      </span>
                                    )}
                                    {tx.match_status === 'suggested' && tx.invoice_number && (
                                      <span className="inline-flex items-center gap-1">
                                        <span className="text-xs text-yellow-700 bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 rounded">
                                          {tx.invoice_number}
                                        </span>
                                        <button onClick={() => confirmMatchMut.mutate({ txId: tx.id, invoiceId: tx.invoice_id! })}
                                          className="p-0.5 text-green-600 hover:bg-green-100 rounded" title="Confirm">
                                          <Check className="h-3.5 w-3.5" />
                                        </button>
                                        <button onClick={() => unlinkMut.mutate(tx.id)}
                                          className="p-0.5 text-red-500 hover:bg-red-100 rounded" title="Reject">
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      </span>
                                    )}
                                    {tx.match_status === 'unmatched' && tx.deposit_amount > 0 && (
                                      <div className="flex items-center gap-1 justify-center">
                                        <button onClick={() => setMatchTxId(tx.id)}
                                          className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5" title="Link to existing invoice">
                                          <Link2 className="h-3 w-3" />
                                        </button>
                                        <button
                                          onClick={() => {
                                            if (window.confirm(`Create a draft invoice for HKD ${tx.deposit_amount.toLocaleString()} from:\n"${tx.description}"?\n\nYou can edit it in the Invoices page.`)) {
                                              createInvoiceMut.mutate(tx.id);
                                            }
                                          }}
                                          disabled={createInvoiceMut.isPending}
                                          className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-0.5" title="Create invoice from this transaction">
                                          <FilePlus className="h-3 w-3" />
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                  {editMode && (
                                    <td className="py-1.5 text-center">
                                      <div className="flex items-center gap-1 justify-center">
                                        <button onClick={async () => {
                                          if (aiLoading) return;
                                          setAiLoading(tx.id);
                                          try {
                                            const data = await api('/chat', {
                                              method: 'POST',
                                              body: {
                                                message: `Fix this bank transaction if it looks wrong. Common errors: description merged from multiple lines, amounts that don't match the merchant (e.g., NAME-CHEAP is ~$100 not $14,000).

Date: ${tx.transaction_date}
Description: ${tx.description}
Deposit: ${tx.deposit_amount}
Withdrawal: ${tx.withdrawal_amount}
Balance: ${tx.balance}

Return ONLY a JSON object with corrected fields. If nothing needs fixing, return {}. Format: {"description":"...","deposit_amount":N,"withdrawal_amount":N,"note":"explanation"}`,
                                                history: [],
                                              },
                                            });
                                            const reply = data.reply || '';
                                            // Extract JSON from reply (skip DSML tags)
                                            const cleanReply = reply.replace(/<[^>]+>/g, '');
                                            const jsonMatch = cleanReply.match(/\{[\s\S]*\}/);
                                            if (jsonMatch) {
                                              try {
                                                const json = JSON.parse(jsonMatch[0]);
                                                if (json.description || json.deposit_amount !== undefined || json.withdrawal_amount !== undefined) {
                                                  const update: any = {};
                                                  if (json.description) update.description = json.description;
                                                  if (json.deposit_amount !== undefined) update.deposit_amount = json.deposit_amount;
                                                  if (json.withdrawal_amount !== undefined) update.withdrawal_amount = json.withdrawal_amount;
                                                  if (json.balance !== undefined) update.balance = json.balance;
                                                  setEdits(prev => ({...prev, [tx.id]: {...prev[tx.id], ...update}}));
                                                  if (json.note) alert('AI: ' + json.note);
                                                } else {
                                                  alert('AI 認為此交易無需修改');
                                                }
                                              } catch { alert('AI 回應無法解析：' + cleanReply.slice(0, 200)); }
                                            } else {
                                              alert('AI 回應：' + reply.slice(0, 300));
                                            }
                                          } catch (e: any) { alert('AI 失敗：' + (e.message || 'unknown')); }
                                          setAiLoading(null);
                                        }}
                                          disabled={aiLoading === tx.id}
                                          className={`px-2 py-0.5 text-xs rounded text-white ${
                                            aiLoading === tx.id
                                              ? 'bg-purple-300 animate-pulse'
                                              : 'bg-purple-500 hover:opacity-90'
                                          }`}
                                          title="AI 根據 OCR 原始資料修正">
                                          {aiLoading === tx.id ? '⏳' : '🤖'} AI
                                        </button>
                                        <button onClick={() => {
                                          updateTxMut.mutate({ id: tx.id, body: edits[tx.id] });
                                          setEdits(prev => { const n = {...prev}; delete n[tx.id]; return n; });
                                        }}
                                          disabled={!dirty}
                                          className="px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-30">
                                          Save
                                        </button>
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t font-medium text-xs">
                                <td colSpan={detail?.accounts?.length > 1 ? 3 : 2} className="py-2 text-muted-foreground">
                                  {transactions.length} transactions
                                  {suggestedCount > 0 && <span className="ml-2 text-yellow-600">({suggestedCount} suggested)</span>}
                                </td>
                                <td className="py-2 pr-3 text-right font-mono text-green-600">
                                  {totalDeposits.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </td>
                                <td className="py-2 pr-3 text-right font-mono text-red-600">
                                  {totalWithdrawals.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </td>
                                <td></td>
                                <td></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Account categorization modal */}
      {acctModalTx && (
        <AccountModal
          tx={acctModalTx}
          allTx={transactions}
          accounts={accounts}
          onClose={() => setAcctModalTx(null)}
          onApply={(code, _applySimilar, similarIds) => {
            // Update this transaction
            updateTxMut.mutate({ id: acctModalTx.id, body: { account_code: code } });
            // Update selected similar transactions
            if (similarIds && similarIds.size > 0) {
              similarIds.forEach((tid: string) => {
                updateTxMut.mutate({ id: tid, body: { account_code: code } });
              });
            }
            setAcctModalTx(null);
          }}
        />
      )}

      {/* Manual match modal */}
      {matchTxId && (
        <ManualMatchModal
          txId={matchTxId}
          onClose={() => setMatchTxId(null)}
          onMatch={(invoiceId) => {
            confirmMatchMut.mutate({ txId: matchTxId, invoiceId });
            setMatchTxId(null);
          }}
        />
      )}

      {/* Bank Reconciliation Modal */}
      {reconData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setReconData(null)}>
          <div className="bg-card border rounded-xl p-6 w-full max-w-lg mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">{i18n.language === 'en' ? 'Bank Reconciliation' : '銀行對賬 Bank Reconciliation'}</h3>
              <span className={`text-sm font-bold px-3 py-1 rounded ${Math.abs(reconData.difference || 0) < 0.01 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {Math.abs(reconData.difference || 0) < 0.01
                  ? (i18n.language === 'en' ? '✓ Balanced' : '✓ 相符')
                  : (i18n.language === 'en' ? '⚠ Difference' : '⚠ 不符')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-muted/50 rounded-lg p-3">
                <span className="text-muted-foreground text-xs">{i18n.language === 'en' ? 'Statement Balance' : '月結單餘額'}</span>
                <p className="font-bold text-lg">HKD {reconData.statement_balance?.toLocaleString()}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <span className="text-muted-foreground text-xs">{i18n.language === 'en' ? 'GL Balance' : '總賬餘額'}</span>
                <p className="font-bold text-lg">HKD {reconData.gl_balance?.toLocaleString()}</p>
              </div>
            </div>
            <div className="text-sm flex justify-between border-t pt-3">
              <span>{i18n.language === 'en' ? 'Difference' : '差異 Difference'}</span>
              <span className={`font-bold ${Math.abs(reconData.difference || 0) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
                HKD {reconData.difference?.toLocaleString()}
              </span>
            </div>
            {(reconData.outstanding_transactions || []).length > 0 && (
              <div>
                <span className="text-sm font-medium">
                  {i18n.language === 'en' ? `Outstanding (${reconData.outstanding_transactions.length})` : `未達交易 Outstanding (${reconData.outstanding_transactions.length})`}
                </span>
                <div className="max-h-48 overflow-y-auto mt-2 border rounded-lg divide-y">
                  {(reconData.outstanding_transactions || []).map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/30">
                      <span className="w-20 text-muted-foreground">{t.transaction_date}</span>
                      <span className="flex-1 truncate mx-2">{t.description?.slice(0, 50)}</span>
                      <span className={`font-mono ${t.deposit_amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {t.deposit_amount > 0 ? `+${t.deposit_amount.toLocaleString()}` : t.withdrawal_amount > 0 ? `-${t.withdrawal_amount.toLocaleString()}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setReconData(null)} className="px-4 py-2 border rounded-md text-sm">
                {i18n.language === 'en' ? 'Close' : '關閉'}
              </button>
            </div>
          </div>
        </div>
      )}

      {supModal?.show && (
        <SupervisorPasswordModal
          action="delete this bank statement"
          onConfirm={supModal.onConfirm}
          onCancel={() => setSupModal(null)}
        />
      )}
    </div>
  );
}

// ── Continuity Chain: shows gap/overlap/duplicate/mismatch detection ──
function ContinuityChain() {
  const { i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['bank-continuity'],
    queryFn: () => api('/bank-statements/continuity'),
  });

  const groups: any[] = (data as any)?.groups || [];
  if (isLoading || groups.length === 0) return null;

  const hasIssues = groups.some((g: any) => g.status !== 'complete');

  const issueIcon = (issues: string[]) => {
    if (issues.includes('gap')) return '🔴';
    if (issues.includes('balance_mismatch')) return '🟡';
    if (issues.includes('duplicate')) return '🟣';
    if (issues.includes('overlap') || issues.includes('date_overlap')) return '🟠';
    if (issues.includes('matched')) return '🟢';
    return '⚪';
  };

  const issueLabel = (issues: string[], lang: string) => {
    if (issues.includes('gap')) return lang === 'en' ? 'Gap' : '缺失';
    if (issues.includes('balance_mismatch')) return lang === 'en' ? 'Balance mismatch' : '餘額不符';
    if (issues.includes('duplicate')) return lang === 'en' ? 'Duplicate' : '重複';
    if (issues.includes('overlap') || issues.includes('date_overlap')) return lang === 'en' ? 'Overlap' : '重疊';
    if (issues.includes('matched')) return lang === 'en' ? 'OK' : '正常';
    if (issues.includes('first')) return lang === 'en' ? 'Start' : '起始';
    return '';
  };

  const groupStatusColor = (status: string) => {
    if (status === 'complete') return 'border-green-400 bg-green-50 dark:bg-green-950/30';
    if (status === 'has_gaps') return 'border-red-400 bg-red-50 dark:bg-red-950/30';
    if (status === 'has_mismatches') return 'border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30';
    return 'border-orange-400 bg-orange-50 dark:bg-orange-950/30';
  };

  return (
    <div className={`rounded-lg border-2 p-4 space-y-3 ${hasIssues ? 'border-red-400 bg-red-50 dark:bg-red-950/20' : 'border-green-400 bg-green-50 dark:bg-green-950/20'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          }
          <span className="font-bold text-sm">
            {hasIssues ? '⚠️' : '✅'}{' '}
            {i18n.language === 'en' ? 'Statement Continuity Chain' : '月結單連續性檢查'}
          </span>
          {!expanded && (
            <span className="text-xs text-muted-foreground ml-2">
              {groups.length} {i18n.language === 'en' ? 'account(s)' : '個帳戶'}
              {hasIssues && (
                <span className="text-red-600 font-medium ml-2">
                  {i18n.language === 'en' ? '— issues found' : '— 發現問題'}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {groups.map((g: any) => (
            <span key={g.account_number} className={`w-2.5 h-2.5 rounded-full ${g.status === 'complete' ? 'bg-green-500' : g.status === 'has_gaps' ? 'bg-red-500' : g.status === 'has_mismatches' ? 'bg-yellow-500' : 'bg-orange-500'}`} />
          ))}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 pt-1">
          {/* Legend */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>🟢 {i18n.language === 'en' ? 'Matched' : '正常'}</span>
            <span>🔴 {i18n.language === 'en' ? 'Gap (missing month)' : '缺失月份'}</span>
            <span>🟡 {i18n.language === 'en' ? 'Balance mismatch' : '餘額不符'}</span>
            <span>🟠 {i18n.language === 'en' ? 'Overlap' : '重疊'}</span>
            <span>🟣 {i18n.language === 'en' ? 'Duplicate' : '重複'}</span>
          </div>

          {groups.map((g: any) => (
            <div key={g.account_number} className={`rounded-lg border p-3 space-y-2 ${groupStatusColor(g.status)}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{g.bank_name || ''}</span>
                  <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{g.account_number}</span>
                  <span className="text-xs text-muted-foreground">{g.currency}</span>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                  g.status === 'complete' ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'
                }`}>
                  {g.status === 'complete'
                    ? (i18n.language === 'en' ? 'Complete' : '完整')
                    : (i18n.language === 'en' ? 'Issues found' : '有問題')}
                </span>
              </div>

              {/* Chain timeline */}
              <div className="flex flex-wrap items-center gap-1">
                {g.chain.map((link: any, idx: number) => (
                  <div key={link.id} className="flex items-center gap-1">
                    {idx > 0 && !link.issues.includes('first') && (
                      <span className="text-xs">
                        {link.issues.includes('gap') ? (
                          <span className="text-red-500 font-bold">✕✕✕</span>
                        ) : link.issues.includes('balance_mismatch') ? (
                          <span className="text-yellow-600">⚡</span>
                        ) : (
                          <span className="text-green-500">―</span>
                        )}
                      </span>
                    )}
                    <div
                      className={`relative group px-2 py-1 rounded text-xs border cursor-default ${
                        link.issues.includes('gap') ? 'border-red-400 bg-red-100 dark:bg-red-900/30' :
                        link.issues.includes('balance_mismatch') ? 'border-yellow-400 bg-yellow-100 dark:bg-yellow-900/30' :
                        link.issues.includes('duplicate') ? 'border-purple-400 bg-purple-100 dark:bg-purple-900/30' :
                        link.issues.includes('overlap') || link.issues.includes('date_overlap') ? 'border-orange-400 bg-orange-100 dark:bg-orange-900/30' :
                        'border-green-300 bg-white dark:bg-green-900/20'
                      }`}
                      title={`${link.statement_year}-${String(link.statement_month).padStart(2, '0')}\nOpening: ${link.opening_balance?.toLocaleString() ?? '?'}\nClosing: ${link.closing_balance?.toLocaleString() ?? '?'}${link.missing_months ? '\nMissing: ' + link.missing_months.join(', ') : ''}${link.expected_opening != null ? '\nExpected opening: ' + link.expected_opening.toLocaleString() : ''}`}
                    >
                      <span className="font-mono font-medium">
                        {link.statement_year}-{String(link.statement_month).padStart(2, '0')}
                      </span>
                      <span className="ml-1">{issueIcon(link.issues)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Issue details */}
              {g.chain.filter((l: any) => l.issues.some((i: string) => i !== 'matched' && i !== 'first')).map((link: any) => (
                <div key={`issue-${link.id}`} className="text-xs pl-2 border-l-2 border-red-300 ml-2 space-y-0.5">
                  {link.issues.includes('gap') && link.missing_months && (
                    <p className="text-red-700 dark:text-red-400">
                      {issueIcon(link.issues)} {i18n.language === 'en' ? 'Missing:' : '缺失：'}{' '}
                      <span className="font-mono font-medium">{link.missing_months.join(', ')}</span>
                    </p>
                  )}
                  {link.issues.includes('balance_mismatch') && (
                    <p className="text-yellow-700 dark:text-yellow-400">
                      🟡 {i18n.language === 'en'
                        ? `Balance mismatch at ${link.statement_year}-${String(link.statement_month).padStart(2, '0')}: expected opening ${link.expected_opening?.toLocaleString()}, got ${link.actual_opening?.toLocaleString()} (diff: ${link.mismatch_amount?.toLocaleString()})`
                        : `${link.statement_year}-${String(link.statement_month).padStart(2, '0')} 餘額不符：預期期初 ${link.expected_opening?.toLocaleString()}，實際 ${link.actual_opening?.toLocaleString()}（差異 ${link.mismatch_amount?.toLocaleString()}）`}
                    </p>
                  )}
                  {link.issues.includes('duplicate') && (
                    <p className="text-purple-700 dark:text-purple-400">
                      🟣 {i18n.language === 'en'
                        ? `Duplicate statement for ${link.statement_year}-${String(link.statement_month).padStart(2, '0')}`
                        : `${link.statement_year}-${String(link.statement_month).padStart(2, '0')} 重複月結單`}
                    </p>
                  )}
                  {(link.issues.includes('overlap') || link.issues.includes('date_overlap')) && (
                    <p className="text-orange-700 dark:text-orange-400">
                      🟠 {i18n.language === 'en'
                        ? `Overlapping period at ${link.statement_year}-${String(link.statement_month).padStart(2, '0')}`
                        : `${link.statement_year}-${String(link.statement_month).padStart(2, '0')} 期間重疊`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountModal({ tx, allTx, accounts, onClose, onApply }: {
  tx: Transaction;
  allTx: Transaction[];
  accounts: any[];
  onClose: () => void;
  onApply: (code: string, applySimilar: boolean, similarIds?: Set<string>) => void;
}) {
  const { i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const [selectedCode, setSelectedCode] = useState(tx.account_code || '');
  const [selectedSimilar, setSelectedSimilar] = useState<Set<string>>(new Set());

  const filtered = accounts.filter((a: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return a.account_code.includes(q) || (a.account_name || '').toLowerCase().includes(q);
  });

  // Find similar transactions
  const desc = tx.description || '';
  const words = desc.split(/\s+/).filter((w: string) => w.length > 2).slice(0, 3);
  const similar = allTx.filter((t: Transaction) =>
    t.id !== tx.id && words.some((w: string) => (t.description || '').includes(w))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border rounded-xl p-4 w-[80vw] mx-4 space-y-3 max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg flex items-center gap-2"><Tag className="h-5 w-5" /> {i18n.language === 'en' ? 'Select Account Code' : '選擇會計科目'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-5 w-5" /></button>
        </div>

        {/* Transaction info */}
        <div className="bg-muted/30 rounded-lg p-3 text-sm flex items-center gap-3">
          <span className="font-medium flex-shrink-0">{tx.transaction_date}</span>
          <span className="text-muted-foreground truncate flex-1 min-w-0">{desc}</span>
          <span className={`font-mono flex-shrink-0 font-medium ${tx.deposit_amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {tx.deposit_amount > 0 ? `+${tx.deposit_amount.toLocaleString()}` :
             tx.withdrawal_amount > 0 ? `-${tx.withdrawal_amount.toLocaleString()}` : ''}
          </span>
          {tx.account_code && (
            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded flex-shrink-0">
              <span className="font-mono">{tx.account_code}</span>
              <span className="ml-1">{accounts.find((a: any) => a.account_code === tx.account_code)?.account_name?.slice(0, 20) || ''}</span>
            </span>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={i18n.language === 'en' ? 'Search by code or name...' : '輸入科目編號或名稱搜尋...'}
            className="w-full pl-9 pr-3 py-2 border rounded-md text-sm bg-background" autoFocus />
        </div>

        {/* Account list */}
        <div className="border rounded-lg max-h-36 overflow-y-auto">
          {filtered.slice(0, 50).map((a: any) => (
            <button key={a.account_code}
              onClick={() => setSelectedCode(a.account_code)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between ${
                selectedCode === a.account_code ? 'bg-primary/10 text-primary font-medium' : ''
              }`}>
              <span className="font-mono text-xs">{a.account_code}</span>
              <span className="flex-1 ml-3 truncate">{a.account_name}</span>
              {selectedCode === a.account_code && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">{i18n.language === 'en' ? 'No matching accounts' : '無匹配科目'}</p>
          )}
        </div>

        {/* Apply to similar transactions */}
        {similar.length > 0 && (
          <div className="border rounded-lg">
            <div className="px-3 py-2 bg-muted/30 border-b text-sm font-medium flex items-center gap-2">
              <span>{i18n.language === 'en' ? `Similar transactions (${similar.length})` : `相似交易 (${similar.length})`}</span>
              <span className="text-xs text-muted-foreground">
                {(() => {
                  const cats = new Map<string, number>();
                  similar.forEach((t: Transaction) => {
                    const k = t.account_code ? `${t.account_code} ${accounts.find((a: any) => a.account_code === t.account_code)?.account_name?.slice(0, 8) || ''}` : '未分類';
                    cats.set(k, (cats.get(k) || 0) + 1);
                  });
                  return Array.from(cats.entries()).map(([k, v]) => `${k}(${v})`).join('  ');
                })()}
              </span>
              <span className="flex-1" />
              <span className="text-xs text-muted-foreground w-24 text-right">金額</span>
              <span className="text-xs text-muted-foreground text-right" style={{minWidth: '120px'}}>科目</span>
              <button onClick={() => {
                if (selectedSimilar.size === similar.length) setSelectedSimilar(new Set());
                else setSelectedSimilar(new Set(similar.map((t: Transaction) => t.id)));
              }}
                className="text-xs text-primary hover:underline">
                {selectedSimilar.size === similar.length
                  ? (i18n.language === 'en' ? 'Deselect All' : '取消全選')
                  : (i18n.language === 'en' ? 'Select All' : '全選')}
              </button>
            </div>
            <div className="max-h-36 overflow-y-auto">
              {similar.map((t: Transaction) => (
                <label key={t.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 cursor-pointer border-b border-muted/30 last:border-0">
                  <input type="checkbox"
                    checked={selectedSimilar.has(t.id)}
                    onChange={() => {
                      const next = new Set(selectedSimilar);
                      if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                      setSelectedSimilar(next);
                    }}
                    className="flex-shrink-0" />
                  <span className="text-xs text-muted-foreground w-14 flex-shrink-0">{t.transaction_date?.slice(5)}</span>
                  <span className="text-xs truncate flex-1 min-w-0">{t.description?.slice(0, 80)}</span>
                  <span className={`text-xs font-mono flex-shrink-0 w-24 text-right ${t.deposit_amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {t.deposit_amount > 0 ? `+${t.deposit_amount.toLocaleString()}` :
                     t.withdrawal_amount > 0 ? `-${t.withdrawal_amount.toLocaleString()}` : ''}
                  </span>
                  <span className="text-xs flex-shrink-0 text-right min-w-[120px]">
                    {t.account_code ? (
                      <span className="bg-primary/10 text-primary px-1 py-0.5 rounded">
                        <span className="font-mono">{t.account_code}</span>
                        <span className="text-muted-foreground ml-1">
                          {accounts.find((a: any) => a.account_code === t.account_code)?.account_name?.slice(0, 12) || ''}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Apply button */}
        <button onClick={() => {
          if (selectedCode) onApply(selectedCode, false, selectedSimilar);
        }}
          disabled={!selectedCode}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-30">
          {selectedSimilar.size > 0
            ? (i18n.language === 'en' ? `Apply to ${selectedSimilar.size + 1} transactions` : `套用科目（含 ${selectedSimilar.size} 筆相似交易）`)
            : (i18n.language === 'en' ? 'Apply Account Code' : '套用科目')}
        </button>
      </div>
    </div>
  );
}

function ManualMatchModal({ txId, onClose, onMatch }: { txId: string; onClose: () => void; onMatch: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const { data } = useQuery({
    queryKey: ['unpaid-invoices', search],
    queryFn: () => api(`/workbuddy/invoices?status=draft,sent,overdue${search ? `&q=${search}` : ''}`),
  });
  const invoices = (data?.data || []) as any[];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border rounded-xl p-6 w-full max-w-lg mx-4 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold">Link to Invoice</h3>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search invoices..."
          className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
        <div className="max-h-64 overflow-y-auto space-y-1">
          {invoices.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No unpaid invoices</p>}
          {invoices.map((inv: any) => (
            <button key={inv.id} onClick={() => onMatch(inv.id)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted text-sm text-left">
              <div>
                <span className="font-medium">{inv.invoice_number || inv.id}</span>
                <span className="ml-2 text-muted-foreground">{inv.customer_name || ''}</span>
              </div>
              <span className="font-mono">${inv.total?.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-muted">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Pending Review Banner: shows draft statements awaiting confirmation ──
function PendingReviewBanner() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['bank-statements-drafts'],
    queryFn: () => api('/bank-statements?only_drafts=1'),
    refetchInterval: 5000, // poll every 5s so newly uploaded drafts appear quickly
  });
  const drafts: any[] = data?.data || [];
  const dismissMut = useMutation({
    mutationFn: (id: string) => api(`/bank-statements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-statements-drafts'] });
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['file-storage'] });
    },
    onError: (err: any) => {
      if (err?.status === 403 || /higher permission/i.test(err?.error || err?.message || '')) {
        alert('Only account owner or boss-level users can discard drafts. Please ask your admin.');
      } else {
        alert(`Discard failed: ${err?.error || err?.message || 'Unknown error'}`);
      }
    },
  });
  if (drafts.length === 0) return null;
  return (
    <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 dark:bg-yellow-950 p-4 space-y-2">
      <div className="flex items-start gap-3">
        <div className="text-2xl">⚠️</div>
        <div className="flex-1">
          <h3 className="font-bold text-yellow-900 dark:text-yellow-100">
            {drafts.length} statement{drafts.length === 1 ? '' : 's'} pending review
          </h3>
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            The system extracted data from your uploaded file{drafts.length === 1 ? '' : 's'}.
            Please review and confirm before saving to the database.
          </p>
        </div>
      </div>
      <div className="space-y-1 pt-2">
        {drafts.map((d: any) => (
          <div
            key={d.id}
            className="flex items-center justify-between rounded border border-yellow-300 bg-white dark:bg-yellow-900/40 px-3 py-2 hover:bg-yellow-100 dark:hover:bg-yellow-900/70 transition-colors"
          >
            <a
              href={`/bank-statements/review/${d.id}`}
              className="flex-1 text-sm"
            >
              <span className="font-medium">{d.bank_name || 'Statement'}</span>
              {d.account_number && <span className="text-muted-foreground"> · {d.account_number}</span>}
              {d.period_start && <span className="text-muted-foreground"> · {d.period_start} → {d.period_end}</span>}
            </a>
            <div className="flex items-center gap-2">
              <a
                href={`/bank-statements/review/${d.id}`}
                className="text-sm text-yellow-900 dark:text-yellow-100 font-medium hover:underline"
              >
                Review →
              </a>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (confirm(i18n.language === 'en'
                    ? 'Discard this draft? It will be moved to the Recycle Bin (30-day restore) and the PDF will also be removed from File Storage.'
                    : '放棄此草稿？將移至回收站（可在30天內還原），PDF 也將從文件存儲中刪除。')) {
                    dismissMut.mutate(d.id);
                  }
                }}
                disabled={dismissMut.isPending}
                className="text-xs px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                title="Discard this draft"
              >
                🗑 Discard
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
