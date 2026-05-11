import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Eye, Trash2, Landmark, ChevronDown, ChevronRight, FileText, Link2, Check, X, Zap } from 'lucide-react';

interface Transaction {
  id: string;
  transaction_date: string;
  description: string;
  deposit_amount: number;
  withdrawal_amount: number;
  balance: number;
  account_type: string;
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [matchTxId, setMatchTxId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['bank-statements'],
    queryFn: () => api('/bank-statements'),
  });

  const detailQuery = useQuery({
    queryKey: ['bank-statement', expandedId],
    queryFn: () => api(`/bank-statements/${expandedId}`),
    enabled: !!expandedId,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/bank-statements/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bank-statements'] }); setExpandedId(null); },
  });

  const autoMatchMut = useMutation({
    mutationFn: () => api('/bank-statements/auto-match', { method: 'POST' }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['bank-statement', expandedId] });
      alert(`配對完成：${data.matched?.length || 0} 筆建議，${data.unmatched_count || 0} 筆未配對`);
    },
  });

  const confirmMatchMut = useMutation({
    mutationFn: ({ txId, invoiceId }: { txId: string; invoiceId: string }) =>
      api(`/bank-statements/transactions/${txId}/match`, {
        method: 'PATCH',
        body: JSON.stringify({ invoice_id: invoiceId, action: 'confirm' }),
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bank-statement', expandedId] }); },
  });

  const unlinkMut = useMutation({
    mutationFn: (txId: string) =>
      api(`/bank-statements/transactions/${txId}/match`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'unlink' }),
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bank-statement', expandedId] }); },
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
                    <a href={`/api/bank-statements/${s.id}/file?token=${localStorage.getItem('token') || ''}`} target="_blank" className="p-1.5 hover:bg-muted rounded">
                      <Eye className="h-4 w-4" />
                    </a>
                    <button onClick={() => { if (confirm(t('common.confirmDelete'))) deleteMut.mutate(s.id); }}
                      className="p-1.5 hover:bg-muted rounded text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded: Transaction table */}
                {expandedId === s.id && (
                  <div className="border-x border-b rounded-b-md bg-muted/10 px-4 py-3">
                    {detailQuery.isLoading ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">Loading transactions...</p>
                    ) : transactions.length === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                        <FileText className="h-4 w-4" /> No transactions found
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
                          </div>
                          <button
                            onClick={() => autoMatchMut.mutate()}
                            disabled={autoMatchMut.isPending}
                            className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs hover:opacity-90 disabled:opacity-40"
                          >
                            <Zap className="h-3 w-3" /> Auto Match
                          </button>
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
                                <th className="py-2 font-medium text-center">Invoice</th>
                              </tr>
                            </thead>
                            <tbody>
                              {transactions.map((tx: Transaction) => (
                                <tr key={tx.id} className={`border-b border-muted/50 hover:bg-muted/20 ${
                                  tx.match_status === 'suggested' ? 'bg-yellow-50 dark:bg-yellow-950/20' :
                                  tx.match_status === 'confirmed' ? 'bg-green-50 dark:bg-green-950/20' : ''
                                }`}>
                                  <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                                    {tx.transaction_date?.slice(5)}
                                  </td>
                                  <td className="py-1.5 pr-3 max-w-[250px] truncate">{tx.description}</td>
                                  {detail?.accounts?.length > 1 && (
                                    <td className="py-1.5 pr-3">
                                      <span className="text-xs bg-muted px-1 rounded">{tx.account_type}</span>
                                    </td>
                                  )}
                                  <td className="py-1.5 pr-3 text-right font-mono text-green-600">
                                    {tx.deposit_amount > 0 ? tx.deposit_amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''}
                                  </td>
                                  <td className="py-1.5 pr-3 text-right font-mono text-red-600">
                                    {tx.withdrawal_amount > 0 ? tx.withdrawal_amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''}
                                  </td>
                                  <td className="py-1.5 pr-3 text-right font-mono">
                                    {tx.balance > 0 ? tx.balance.toLocaleString(undefined, { minimumFractionDigits: 2 }) :
                                     tx.balance < 0 ? <span className="text-red-600">{tx.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span> :
                                     '0.00'}
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
                                          {tx.match_confidence && <span className="opacity-60 ml-1">({tx.match_confidence})</span>}
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
                                      <button onClick={() => setMatchTxId(tx.id)}
                                        className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5 mx-auto" title="Link to invoice">
                                        <Link2 className="h-3 w-3" />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
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
