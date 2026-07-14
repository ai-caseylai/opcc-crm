import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Sparkles, Link2, CheckCircle2, FileText, Banknote } from 'lucide-react';

interface Tx {
  id: string;
  bank_statement_id: string;
  transaction_date: string;
  description: string;
  deposit_amount: number;
  withdrawal_amount: number;
  invoice_id: string | null;
  match_status: string;
  match_confidence: string | null;
}

interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  total: number;
  currency: string;
  issue_date: string;
  due_date: string;
  status: string;
}

export default function Reconciliation() {
  const queryClient = useQueryClient();
  const [showMatched, setShowMatched] = useState(false);
  const [linkingTx, setLinkingTx] = useState<string | null>(null);

  // Load transactions (flat) and invoices
  const txQ = useQuery({
    queryKey: ['bank-transactions-flat'],
    queryFn: () => api('/bank-statements/transactions') as Promise<{ data: Tx[] }>,
  });
  const invQ = useQuery({
    queryKey: ['invoices-all'],
    queryFn: () => api('/invoices') as Promise<{ data: Invoice[] }>,
  });

  const transactions: Tx[] = txQ.data?.data || [];

  const invoices: Invoice[] = invQ.data?.data || [];

  // Map invoice_id → invoice
  const invMap = useMemo(() => {
    const m = new Map<string, Invoice>();
    for (const i of invoices) m.set(i.id, i);
    return m;
  }, [invoices]);

  const stats = useMemo(() => {
    const total = transactions.length;
    const matched = transactions.filter(t => t.invoice_id && t.match_status === 'matched').length;
    const suggested = transactions.filter(t => t.match_status === 'suggested').length;
    const unmatched = total - matched - suggested;
    return { total, matched, suggested, unmatched };
  }, [transactions]);

  // Auto-match mutation
  const autoMatchMut = useMutation({
    mutationFn: async () => {
      const r1 = await api('/bank-statements/auto-match', { method: 'POST' });
      // Also run file-records-based auto-match for invoices stored as file_records only
      let r2: any = null;
      try {
        r2 = await api('/file-storage/auto-match-invoices', { method: 'POST' });
      } catch {}
      return { r1, r2 };
    },
    onSuccess: (res: any) => {
      const matched1 = res.r1?.matched?.length || 0;
      const matched2 = res.r2?.matched?.length || 0;
      alert(`Auto-match complete!\n\n${matched1} bank transaction(s) suggested for matching.\n${matched2} invoice file(s) auto-matched to bank transactions.\n\nReview the suggestions below and click ✓ Confirm to accept, or ✗ to reject.`);
      queryClient.invalidateQueries({ queryKey: ['bank-transactions-flat'] });
      queryClient.invalidateQueries({ queryKey: ['invoices-all'] });
    },
    onError: (err: any) => alert(`Auto-match failed: ${err?.message || err?.error || 'Unknown error'}`),
  });

  // Confirm or reject match
  const matchMut = useMutation({
    mutationFn: ({ txId, action, invoice_id }: { txId: string; action: 'confirm' | 'reject' | 'link'; invoice_id?: string }) =>
      api(`/bank-statements/transactions/${txId}/match`, { method: 'PATCH', body: { action, invoice_id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions-flat'] });
      setLinkingTx(null);
    },
    onError: (err: any) => alert(`Failed: ${err?.message || err?.error}`),
  });

  // For a given transaction, find candidate invoices (by amount)
  const candidatesFor = (tx: Tx): Invoice[] => {
    const amt = tx.deposit_amount > 0 ? tx.deposit_amount : tx.withdrawal_amount;
    if (!amt) return [];
    return invoices.filter(i => Math.abs(i.total - amt) < 0.01 && i.status !== 'cancelled');
  };

  const visibleTx = transactions.filter(t => showMatched || t.match_status !== 'matched');

  if (txQ.isLoading || invQ.isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading reconciliation data...</div>;
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Link2 className="h-6 w-6 text-primary" /> Reconciliation 對賬
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Match bank transactions to invoices. The system suggests matches; you confirm them.
        </p>
      </div>

      {/* Stats + Auto-match button */}
      <div className="bg-card border rounded-lg p-4 flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Total:</span>
          <span className="font-bold">{stats.total}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-green-700">Matched: <b>{stats.matched}</b></span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <span className="text-blue-700">Suggested: <b>{stats.suggested}</b></span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-orange-600">Unmatched: <b>{stats.unmatched}</b></span>
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showMatched} onChange={e => setShowMatched(e.target.checked)} />
          Show matched
        </label>
        <button
          onClick={() => autoMatchMut.mutate()}
          disabled={autoMatchMut.isPending}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
        >
          <Sparkles className="h-4 w-4" />
          {autoMatchMut.isPending ? 'Auto-matching…' : 'Auto-Match All'}
        </button>
      </div>

      {/* Empty state */}
      {transactions.length === 0 && (
        <div className="bg-card border rounded-lg p-12 text-center text-muted-foreground">
          <Banknote className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No bank transactions yet. Upload a bank statement first.</p>
        </div>
      )}

      {invoices.length === 0 && transactions.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-4 text-sm">
          ⚠️ No invoices in the system yet. Upload some invoice PDFs from File Storage to enable matching.
        </div>
      )}

      {/* Transactions table */}
      {transactions.length > 0 && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Deposit</th>
                <th className="px-3 py-2 text-right">Withdrawal</th>
                <th className="px-3 py-2 text-left">Match status</th>
                <th className="px-3 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleTx.map(tx => {
                const matchedInv = tx.invoice_id ? invMap.get(tx.invoice_id) : null;
                const cands = !matchedInv && tx.match_status === 'unmatched' ? candidatesFor(tx) : [];
                const rowBg =
                  tx.match_status === 'matched' ? 'bg-green-50/50' :
                  tx.match_status === 'suggested' ? 'bg-blue-50/50' : '';
                return (
                  <React.Fragment key={tx.id}>
                    <tr className={`border-t ${rowBg}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{tx.transaction_date}</td>
                      <td className="px-3 py-2 max-w-md truncate" title={tx.description}>{tx.description}</td>
                      <td className="px-3 py-2 text-right text-green-700">
                        {tx.deposit_amount > 0 ? `+${tx.deposit_amount.toLocaleString()}` : ''}
                      </td>
                      <td className="px-3 py-2 text-right text-red-700">
                        {tx.withdrawal_amount > 0 ? `-${tx.withdrawal_amount.toLocaleString()}` : ''}
                      </td>
                      <td className="px-3 py-2">
                        {matchedInv && tx.match_status === 'matched' && (
                          <span className="inline-flex items-center gap-1 text-green-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {matchedInv.invoice_number}
                          </span>
                        )}
                        {matchedInv && tx.match_status === 'suggested' && (
                          <span className="inline-flex items-center gap-1 text-blue-700">
                            <Sparkles className="h-3.5 w-3.5" />
                            Suggested: {matchedInv.invoice_number}
                          </span>
                        )}
                        {!matchedInv && (
                          <span className="text-muted-foreground text-xs">unmatched</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {tx.match_status === 'suggested' && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => matchMut.mutate({ txId: tx.id, action: 'confirm' })}
                              className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                              disabled={matchMut.isPending}
                            >✓ Confirm</button>
                            <button
                              onClick={() => matchMut.mutate({ txId: tx.id, action: 'reject' })}
                              className="text-xs px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50"
                              disabled={matchMut.isPending}
                            >✗ Reject</button>
                          </div>
                        )}
                        {tx.match_status === 'matched' && (
                          <button
                            onClick={() => matchMut.mutate({ txId: tx.id, action: 'reject' })}
                            className="text-xs px-2 py-1 border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
                            disabled={matchMut.isPending}
                          >Unlink</button>
                        )}
                        {tx.match_status === 'unmatched' && (
                          <button
                            onClick={() => setLinkingTx(linkingTx === tx.id ? null : tx.id)}
                            className="text-xs px-2 py-1 border border-blue-300 text-blue-600 rounded hover:bg-blue-50"
                          >
                            {cands.length > 0 ? `Link (${cands.length} candidate${cands.length === 1 ? '' : 's'})` : 'No matches'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {linkingTx === tx.id && cands.length > 0 && (
                      <tr className="bg-blue-50/30">
                        <td colSpan={6} className="px-6 py-3">
                          <div className="text-xs font-medium mb-2">Candidates with matching amount:</div>
                          <div className="space-y-1">
                            {cands.map(c => (
                              <div key={c.id} className="flex items-center gap-3 text-sm">
                                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="font-mono">{c.invoice_number}</span>
                                <span className="text-muted-foreground">·</span>
                                <span>{c.issue_date}</span>
                                <span className="text-muted-foreground">·</span>
                                <span>{c.currency} {c.total.toLocaleString()}</span>
                                <span className="flex-1" />
                                <button
                                  onClick={() => matchMut.mutate({ txId: tx.id, action: 'link', invoice_id: c.id })}
                                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                  disabled={matchMut.isPending}
                                >Link this →</button>
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={() => setLinkingTx(null)}
                            className="text-xs text-muted-foreground hover:underline mt-2"
                          >Cancel</button>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {visibleTx.length === 0 && (
            <div className="p-8 text-center text-muted-foreground text-sm">
              All transactions are matched! 🎉 Toggle "Show matched" to see them.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
