import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, WORKER_API_BASE } from '../lib/api';

// Money formatter — always 2 decimals with thousand separators
const money = (v: number | null | undefined): string => {
  if (v == null || v === undefined || isNaN(Number(v))) return '';
  return Number(v).toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Parse user-typed money back to a number (strip commas + non-numeric)
const parseMoney = (s: string): number | null => {
  if (s == null || String(s).trim() === '') return null;
  const cleaned = String(s).replace(/,/g, '').replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
};

// Money input that DISPLAYS commas + 2 decimals when not focused,
// and shows the raw editable number while focused.
// Fixes Lily issues #3 and #11 (decimals/commas hidden until you click).
function MoneyInput({
  value, onChange, className = '', placeholder,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  className?: string;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const shown = focused
    ? draft
    : (value == null || value === undefined || isNaN(Number(value)) ? '' : money(value));
  return (
    <input
      type="text"
      inputMode="decimal"
      value={shown}
      placeholder={placeholder}
      onFocus={() => {
        setFocused(true);
        setDraft(value == null || isNaN(Number(value)) ? '' : String(value));
      }}
      onChange={e => {
        setDraft(e.target.value);
        onChange(parseMoney(e.target.value));
      }}
      onBlur={() => setFocused(false)}
      className={className}
    />
  );
}

interface Transaction {
  id: string;
  transaction_date: string;
  description: string;
  deposit_amount: number;
  withdrawal_amount: number;
  balance: number | null;
  reference?: string | null;
  account_type?: string | null;
}

interface StatementWithTx {
  id: string;
  file_name?: string;
  bank_name?: string;
  account_number?: string;
  branch?: string;
  currency?: string;
  account_type?: string;
  statement_year?: number;
  statement_month?: number;
  period_start?: string;
  period_end?: string;
  opening_balance?: number;
  closing_balance?: number;
  status?: string;
  transactions?: Transaction[];
}

export default function BankStatementReview() {
  const { i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: stmt, isLoading } = useQuery<StatementWithTx>({
    queryKey: ['bank-statement', id],
    queryFn: () => api(`/bank-statements/${id}`),
    enabled: !!id,
  });

  // Local edit state
  const [headerEdits, setHeaderEdits] = useState<Partial<StatementWithTx>>({});
  const [txEdits, setTxEdits] = useState<Record<string, Partial<Transaction>>>({});
  const [deletedTxIds, setDeletedTxIds] = useState<Set<string>>(new Set());
  // Track whether the user has manually typed a closing balance.
  // While false, the closing balance auto-follows the computed running total
  // (Lily #4: accountants edit line items first, the total should follow).
  const [closingManuallyEdited, setClosingManuallyEdited] = useState(false);
  // Rows added manually via "Add Row" (used when OCR failed to read the file).
  const [localRows, setLocalRows] = useState<Transaction[]>([]);

  // PDF blob URL (loaded with auth)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Load PDF as blob (so we can pass through auth header)
  useEffect(() => {
    if (!id) return;
    let revokeUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        // Forward active client header so the backend scopes correctly
        const activeClientJson = localStorage.getItem('activeClient');
        if (activeClientJson) {
          try {
            const client = JSON.parse(activeClientJson);
            if (client?.id) headers['X-Active-Client'] = client.id;
          } catch {}
        }
        const resp = await fetch(`${WORKER_API_BASE}/bank-statements/${id}/file`, {
          headers,
          credentials: 'include',
        });
        if (!resp.ok) {
          setPdfError(`Could not load PDF (HTTP ${resp.status})`);
          return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        revokeUrl = url;
        if (!cancelled) setPdfUrl(url);
      } catch (e: any) {
        setPdfError(e?.message || 'Failed to load PDF');
      }
    })();
    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [id]);

  // Mutations
  const saveHeaderMut = useMutation({
    mutationFn: (body: Partial<StatementWithTx>) =>
      api(`/bank-statements/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-statement', id] });
      setHeaderEdits({});
    },
  });

  const saveTxMut = useMutation({
    mutationFn: ({ txId, body }: { txId: string; body: Partial<Transaction> }) =>
      api(`/bank-statements/transactions/${txId}`, { method: 'PATCH', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-statement', id] });
    },
  });

  const deleteTxMut = useMutation({
    mutationFn: (txId: string) =>
      api(`/bank-statements/transactions/${txId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-statement', id] });
    },
  });

  // Create a brand-new transaction row (used by the "Add Row" button)
  const createTxMut = useMutation({
    mutationFn: (body: Partial<Transaction>) =>
      api(`/bank-statements/${id}/transactions`, { method: 'POST', body }),
  });

  const confirmMut = useMutation({
    mutationFn: () => api(`/bank-statements/${id}/confirm`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['bank-statements-drafts'] });
      alert(i18n.language === 'en' ? '✅ Saved to database! This statement is now confirmed.' : '✅ 已儲存至數據庫！此月結單已確認。');
      navigate('/bank-statements');
    },
    onError: (err: any) => {
      alert(`Failed to save: ${err?.message || err?.error || 'Unknown error'}`);
    },
  });

  const discardMut = useMutation({
    mutationFn: () => api(`/bank-statements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['bank-statements-drafts'] });
      navigate('/file-storage');
    },
  });

  const transactions = useMemo(
    () => [
      ...(stmt?.transactions || []).filter(t => !deletedTxIds.has(t.id)),
      ...localRows,
    ],
    [stmt, deletedTxIds, localRows]
  );

  const totals = useMemo(() => {
    const rowChecks: Record<string, { expected: number; actual: number | null; mismatch: boolean }> = {};
    const opening = Number(headerEdits.opening_balance ?? stmt?.opening_balance ?? 0);

    // Resolve each transaction's edited values once, preserving original (statement) order.
    const resolved = transactions.map(tx => {
      const e = txEdits[tx.id] || {};
      const date = e.transaction_date ?? tx.transaction_date ?? '';
      const description = e.description ?? tx.description ?? '';
      const deposit = Number(e.deposit_amount ?? tx.deposit_amount) || 0;
      const withdrawal = Number(e.withdrawal_amount ?? tx.withdrawal_amount) || 0;
      const shown = e.balance ?? tx.balance;
      const balance = shown != null ? Number(shown) : null;
      const accountType = (e.account_type ?? tx.account_type) || null;
      return { id: tx.id, date, description, deposit, withdrawal, balance, accountType };
    });

    const dep = resolved.reduce((s, t) => s + t.deposit, 0);
    const wit = resolved.reduce((s, t) => s + t.withdrawal, 0);

    // A statement can contain multiple sub-ledgers in one document (e.g. HSBC
    // "HKD Current" + "HKD Savings" sections), each with its own running balance.
    // Figure out how to split "resolved" into per-ledger segments:
    const distinctTypes = new Set(resolved.map(t => t.accountType).filter(Boolean));
    let segments: (typeof resolved)[];

    if (distinctTypes.size >= 2) {
      // Preferred: the parser reliably tagged account_type on multiple ledgers — group by it.
      const byType = new Map<string, typeof resolved>();
      for (const t of resolved) {
        const key = t.accountType || '__untagged__';
        if (!byType.has(key)) byType.set(key, []);
        byType.get(key)!.push(t);
      }
      segments = Array.from(byType.values());
    } else {
      // Fallback: account_type wasn't reliably tagged (the AI parse doesn't always
      // set it consistently). Detect ledger boundaries deterministically instead,
      // using "B/F BALANCE" (bring-forward) marker rows — these mark the start of
      // a new sub-account section in the ORIGINAL statement order. This does NOT
      // depend on the AI's tagging and works even when account_type is entirely absent.
      const isBfBalance = (desc: string) => /B\/?F\s*BAL/i.test(desc || '');
      segments = [];
      let current: typeof resolved = [];
      for (const t of resolved) {
        if (isBfBalance(t.description) && current.length > 0) {
          segments.push(current);
          current = [];
        }
        current.push(t);
      }
      if (current.length > 0) segments.push(current);
    }

    let computedClosing = 0;
    if (segments.length <= 1) {
      // Single-ledger statement — one continuous running balance from the header opening balance.
      const ordered = [...resolved].sort((a, b) => a.date.localeCompare(b.date));
      let running = opening;
      for (const t of ordered) {
        running = running + t.deposit - t.withdrawal;
        const mismatch = t.balance !== null && Math.abs(t.balance - running) > 0.01;
        rowChecks[t.id] = { expected: running, actual: t.balance, mismatch };
      }
      computedClosing = running;
    } else {
      // Multi sub-ledger statement — validate each ledger independently, anchored
      // on its own first row's stated balance (typically its "B/F BALANCE" row).
      // Sort WITHIN each segment only — segments themselves are never merged,
      // so dates that happen to coincide across different ledgers can't cross-contaminate.
      for (const segTxs of segments) {
        const ordered = [...segTxs].sort((a, b) => a.date.localeCompare(b.date));
        const first = ordered[0];
        const anchor = first.balance !== null
          ? first.balance - (first.deposit - first.withdrawal)
          : opening;
        let running = anchor;
        for (const t of ordered) {
          running = running + t.deposit - t.withdrawal;
          const mismatch = t.balance !== null && Math.abs(t.balance - running) > 0.01;
          rowChecks[t.id] = { expected: running, actual: t.balance, mismatch };
        }
        computedClosing += running;
      }
    }

    const declaredClosing = Number(headerEdits.closing_balance ?? stmt?.closing_balance ?? 0);
    const closingMismatch = Math.abs(computedClosing - declaredClosing) > 0.01;
    return {
      dep, wit, net: dep - wit,
      opening, computedClosing, declaredClosing, closingMismatch,
      rowChecks,
      mismatchCount: Object.values(rowChecks).filter(c => c.mismatch).length,
    };
  }, [transactions, txEdits, headerEdits, stmt]);

  // Fix Issue 4: when the user edits ANY transaction row, clear the
  // "closing manually edited" flag so the closing balance follows automatically.
  // The only time we keep the flag is when the user has typed directly into
  // the Closing Balance field AND has not subsequently edited any row.
  useEffect(() => {
    setClosingManuallyEdited(false);
  }, [txEdits]);

  // Auto-sync closing balance to the computed running total UNLESS the user has
  // manually typed a closing balance. This means when an accountant edits the
  // line items, the closing balance at the top follows automatically (Lily #4).
  useEffect(() => {
    if (closingManuallyEdited) return;
    if (!stmt) return;
    const current = headerEdits.closing_balance ?? stmt.closing_balance;
    // Only push an update if it actually differs, to avoid render loops
    if (current == null || Math.abs(Number(current) - totals.computedClosing) > 0.01) {
      setHeaderEdits(prev => ({ ...prev, closing_balance: totals.computedClosing }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.computedClosing, closingManuallyEdited]);

  if (isLoading) {
    return <div className="p-6 text-center text-muted-foreground">Loading extracted data…</div>;
  }
  if (!stmt) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600">Statement not found.</p>
        <Link to="/bank-statements" className="text-primary underline">← Back to Bank Statements</Link>
      </div>
    );
  }

  const isDraft = stmt.status === 'draft';
  const merged = { ...stmt, ...headerEdits };
  const headerHasChanges = Object.keys(headerEdits).length > 0;
  const txDirtyCount = Object.keys(txEdits).length;

  const upd = (k: keyof StatementWithTx, v: any) =>
    setHeaderEdits(prev => ({ ...prev, [k]: v }));

  const saveHeader = () => {
    if (!headerHasChanges) return;
    saveHeaderMut.mutate(headerEdits);
  };

  const saveAllTxEdits = async () => {
    for (const [txId, rowBody] of Object.entries(txEdits)) {
      const body = rowBody as Partial<Transaction>;
      // Local rows (added manually) are created, not patched
      if (txId.startsWith('local-')) {
        const row = localRows.find(r => r.id === txId);
        if (row) {
          const combined = { ...row, ...body };
          await createTxMut.mutateAsync({
            transaction_date: combined.transaction_date,
            description: combined.description,
            deposit_amount: combined.deposit_amount,
            withdrawal_amount: combined.withdrawal_amount,
            balance: combined.balance,
          });
        }
      } else {
        await saveTxMut.mutateAsync({ txId, body });
      }
    }
    // Create any local rows the user added but did not further edit
    for (const row of localRows) {
      if (!txEdits[row.id]) {
        await createTxMut.mutateAsync({
          transaction_date: row.transaction_date,
          description: row.description,
          deposit_amount: row.deposit_amount,
          withdrawal_amount: row.withdrawal_amount,
          balance: row.balance,
        });
      }
    }
    setTxEdits({});
    setLocalRows([]);
  };

  const addRow = () => {
    const newId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const lastDate = transactions.length > 0
      ? (transactions[transactions.length - 1].transaction_date || merged.period_start || '')
      : (merged.period_start || '');
    setLocalRows(prev => [...prev, {
      id: newId,
      transaction_date: lastDate,
      description: '',
      deposit_amount: 0,
      withdrawal_amount: 0,
      balance: null,
    }]);
  };

  const saveAndConfirm = async () => {
    if (headerHasChanges) await saveHeaderMut.mutateAsync(headerEdits);
    if (txDirtyCount > 0 || localRows.length > 0) await saveAllTxEdits();
    confirmMut.mutate();
  };

  return (
    <div className="p-4 space-y-4 max-w-[1800px] mx-auto">
      {/* Banner */}
      {isDraft ? (
        <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 dark:bg-yellow-950 p-4">
          <div className="flex items-start gap-3">
            <div className="text-2xl">⚠️</div>
            <div className="flex-1">
              <h2 className="font-bold text-yellow-900 dark:text-yellow-100">
                {i18n.language === 'en' ? 'Review extracted data before saving to database' : '儲存至數據庫前請先審核提取的數據'}
              </h2>
              <p className="text-sm text-yellow-800 dark:text-yellow-200 mt-1">
                {i18n.language === 'en'
                  ? <>Compare the AI-extracted data on the right with the original PDF on the left. Edit any field that's wrong. When everything matches, click <strong>Save to Database</strong>.</>
                  : <>將右側 AI 提取的數據與左側原始 PDF 進行對比。修正任何錯誤，確認後點擊<strong>儲存至數據庫</strong>。</>}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-green-400 bg-green-50 dark:bg-green-950 p-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">✅</span>
            <p className="text-sm text-green-900 dark:text-green-100">
              {i18n.language === 'en'
                ? <><strong>Confirmed.</strong> This statement is saved. Any edits below save instantly.</>
                : <><strong>已確認。</strong>此月結單已儲存。以下的編輯將即時保存。</>}
            </p>
          </div>
        </div>
      )}

      {/* Split-screen: PDF left, data right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ minHeight: '70vh' }}>
        {/* Left: PDF viewer */}
        <div className="rounded-lg border bg-card flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
            <h3 className="font-bold text-sm">{i18n.language === 'en' ? '📄 Original Document' : '📄 原始文件'}</h3>
            <span className="text-xs text-muted-foreground truncate ml-2">{stmt.file_name || 'PDF'}</span>
          </div>
          <div className="flex-1 bg-muted/10 relative" style={{ minHeight: '70vh' }}>
            {pdfError ? (
              <div className="p-4 text-sm text-red-600 text-center">
                {pdfError}
                <br/><span className="text-muted-foreground">You can still review and edit the extracted data on the right.</span>
              </div>
            ) : !pdfUrl ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading PDF…</div>
            ) : (
              <iframe
                src={pdfUrl}
                title="Bank statement PDF"
                className="w-full h-full border-0"
                style={{ minHeight: '70vh' }}
              />
            )}
          </div>
        </div>

        {/* Right: Extracted data */}
        <div className="space-y-4 overflow-y-auto pb-24" style={{ maxHeight: '85vh' }}>
          {/* Header info */}
          <div className="rounded-lg border bg-card p-4">
            <h3 className="font-bold text-sm mb-3">{i18n.language === 'en' ? '📋 Extracted Statement Details' : '📋 提取的月結單資料'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label={i18n.language === 'en' ? 'Bank Name' : 'Bank Name 銀行名稱'} value={merged.bank_name || ''} onChange={v => upd('bank_name', v)} />
              <Field label={i18n.language === 'en' ? 'Account Number' : 'Account Number 帳號'} value={merged.account_number || ''} onChange={v => upd('account_number', v)} />
              <Field label={i18n.language === 'en' ? 'Branch' : 'Branch 分行'} value={merged.branch || ''} onChange={v => upd('branch', v)} />
              <Field label={i18n.language === 'en' ? 'Currency' : 'Currency 貨幣'} value={merged.currency || ''} onChange={v => upd('currency', v)} />
              <Field label={i18n.language === 'en' ? 'Period Start' : 'Period Start 開始日期'} value={merged.period_start || ''} onChange={v => upd('period_start', v)} placeholder="YYYY-MM-DD" />
              <Field label={i18n.language === 'en' ? 'Period End' : 'Period End 結束日期'} value={merged.period_end || ''} onChange={v => upd('period_end', v)} placeholder="YYYY-MM-DD" />
              <label className="block">
                <span className="text-xs text-muted-foreground">{i18n.language === 'en' ? 'Opening Balance' : 'Opening Balance 期初餘額'}</span>
                <MoneyInput
                  value={merged.opening_balance ?? null}
                  onChange={v => upd('opening_balance', v ?? 0)}
                  className="mt-1 block w-full px-2 py-1.5 bg-background border border-input rounded text-sm text-right"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground flex items-center justify-between">
                  <span>{i18n.language === 'en' ? 'Closing Balance' : 'Closing Balance 期末餘額'}</span>
                  {totals.closingMismatch && (
                    <button
                      type="button"
                      onClick={() => { setClosingManuallyEdited(false); upd('closing_balance', totals.computedClosing); }}
                      className="text-[10px] text-blue-600 underline"
                      title="Set to computed value (opening + deposits − withdrawals)"
                    >
                      use computed
                    </button>
                  )}
                </span>
                <MoneyInput
                  value={merged.closing_balance ?? null}
                  onChange={v => { setClosingManuallyEdited(true); upd('closing_balance', v ?? 0); }}
                  className="mt-1 block w-full px-2 py-1.5 bg-background border border-input rounded text-sm text-right"
                />
              </label>
            </div>
            {headerHasChanges && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={saveHeader}
                  disabled={saveHeaderMut.isPending}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs"
                >
                  {saveHeaderMut.isPending ? (i18n.language === 'en' ? 'Saving…' : '儲存中…') : (i18n.language === 'en' ? '💾 Save header changes' : '💾 儲存標題修改')}
                </button>
                <button
                  onClick={() => setHeaderEdits({})}
                  className="px-3 py-1.5 border rounded text-xs hover:bg-muted"
                >
                  {i18n.language === 'en' ? 'Discard' : '放棄'}
                </button>
              </div>
            )}
          </div>

          {/* Balance verification banner */}
          {(totals.closingMismatch || totals.mismatchCount > 0) && (
            <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs">
              <div className="font-bold text-red-800 dark:text-red-200 mb-1">⚠️ Balance discrepancy detected</div>
              {totals.closingMismatch && (
                <div className="text-red-700 dark:text-red-300">
                  Closing balance should be <span className="font-mono font-bold">{money(totals.computedClosing)}</span> based on
                  opening ({money(totals.opening)}) + deposits ({money(totals.dep)}) − withdrawals ({money(totals.wit)}),
                  but the statement shows <span className="font-mono font-bold">{money(totals.declaredClosing)}</span>.
                  Difference: <span className="font-mono font-bold">{money(totals.declaredClosing - totals.computedClosing)}</span>.
                  <button
                    type="button"
                    onClick={() => { setClosingManuallyEdited(false); upd('closing_balance', totals.computedClosing); }}
                    className="ml-2 bg-red-100 hover:bg-red-200 text-red-800 px-2 py-0.5 rounded border border-red-300"
                  >
                    Fix: use computed value
                  </button>
                </div>
              )}
              {totals.mismatchCount > 0 && (
                <div className="text-red-700 dark:text-red-300 mt-1">
                  {totals.mismatchCount} row{totals.mismatchCount === 1 ? '' : 's'} have a per-row balance that doesn't match the running total (highlighted below).
                </div>
              )}
            </div>
          )}
          {!totals.closingMismatch && totals.mismatchCount === 0 && transactions.length > 0 && (
            <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 p-2 text-xs text-green-700 dark:text-green-300">
              ✓ Balance verified: opening + deposits − withdrawals = closing, and every row's balance matches the running total.
            </div>
          )}

          {/* Transactions */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-sm">💳 Transactions ({transactions.length})</h3>
              <div className="text-xs text-muted-foreground">
                <span className="text-green-600 font-mono">+{money(totals.dep)}</span>
                <span className="mx-1">·</span>
                <span className="text-red-600 font-mono">-{money(totals.wit)}</span>
                <span className="mx-1">·</span>
                <span className="font-mono font-bold">Net {money(totals.net)}</span>
              </div>
            </div>

            {transactions.length === 0 ? (
              <div className="py-6 text-center border-2 border-dashed rounded">
                <div className="text-3xl mb-2">📝</div>
                <div className="font-medium text-sm">No transactions were extracted</div>
                <div className="text-xs text-muted-foreground mt-1 mb-3">
                  The system could not read this file automatically. Enter the transactions manually below.
                </div>
                <button
                  onClick={addRow}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90"
                >
                  + Add first row
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-1 pr-1 font-medium w-20">{i18n.language === 'en' ? 'Date' : '日期'}</th>
                      <th className="py-1 pr-1 font-medium">{i18n.language === 'en' ? 'Description' : '描述'}</th>
                      <th className="py-1 pr-1 font-medium text-right w-20">{i18n.language === 'en' ? 'Deposit' : '存入'}</th>
                      <th className="py-1 pr-1 font-medium text-right w-20">{i18n.language === 'en' ? 'Withdrawal' : '提取'}</th>
                      <th className="py-1 pr-1 font-medium text-right w-20">{i18n.language === 'en' ? 'Balance' : '餘額'}</th>
                      <th className="py-1 font-medium w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => {
                      const e = txEdits[tx.id] || {};
                      const date = e.transaction_date ?? tx.transaction_date;
                      const desc = e.description ?? tx.description;
                      const dep = e.deposit_amount ?? tx.deposit_amount;
                      const wit = e.withdrawal_amount ?? tx.withdrawal_amount;
                      const bal = e.balance ?? tx.balance;
                      const dirty = !!txEdits[tx.id];
                      const check = totals.rowChecks[tx.id];
                      const mismatch = check?.mismatch;
                      const upTx = (field: keyof Transaction, value: any) =>
                        setTxEdits(prev => ({ ...prev, [tx.id]: { ...prev[tx.id], [field]: value } }));
                      const isLocal = tx.id.startsWith('local-');
                      const rowBg =
                        mismatch ? 'bg-red-50 dark:bg-red-950/30' :
                        isLocal ? 'bg-blue-50 dark:bg-blue-950/20' :
                        dirty ? 'bg-yellow-50 dark:bg-yellow-900/20' : '';
                      return (
                        <tr key={tx.id} className={`border-b ${rowBg}`}
                            title={mismatch ? `Balance mismatch: expected ${money(check.expected)} but shows ${money(check.actual)}` : ''}>
                          <td className="py-1 pr-1">
                            <input
                              value={date || ''}
                              onChange={ev => upTx('transaction_date', ev.target.value)}
                              className="w-full px-1 py-0.5 bg-transparent border border-input rounded text-xs"
                            />
                          </td>
                          <td className="py-1 pr-1">
                            <input
                              value={desc || ''}
                              onChange={ev => upTx('description', ev.target.value)}
                              className="w-full px-1 py-0.5 bg-transparent border border-input rounded text-xs"
                            />
                          </td>
                          <td className="py-1 pr-1">
                            <MoneyInput
                              value={dep ?? 0}
                              onChange={v => upTx('deposit_amount', v ?? 0)}
                              className="w-full px-1 py-0.5 bg-transparent border border-input rounded text-xs text-right text-green-700"
                            />
                          </td>
                          <td className="py-1 pr-1">
                            <MoneyInput
                              value={wit ?? 0}
                              onChange={v => upTx('withdrawal_amount', v ?? 0)}
                              className="w-full px-1 py-0.5 bg-transparent border border-input rounded text-xs text-right text-red-700"
                            />
                          </td>
                          <td className="py-1 pr-1">
                            <MoneyInput
                              value={bal ?? null}
                              onChange={v => upTx('balance', v)}
                              className={`w-full px-1 py-0.5 bg-transparent border rounded text-xs text-right ${mismatch ? 'border-red-500 text-red-700' : 'border-input'}`}
                            />
                            {mismatch && (
                              <div className="text-[10px] text-red-600 text-right mt-0.5">
                                should be {money(check.expected)}
                              </div>
                            )}
                          </td>
                          <td className="py-1 text-center">
                            <button
                              onClick={() => {
                                if (tx.id.startsWith('local-')) {
                                  // Local row — just remove from local state
                                  setLocalRows(prev => prev.filter(r => r.id !== tx.id));
                                  setTxEdits(prev => { const n = { ...prev }; delete n[tx.id]; return n; });
                                } else if (confirm('Delete this transaction?')) {
                                  setDeletedTxIds(prev => new Set(prev).add(tx.id));
                                  deleteTxMut.mutate(tx.id);
                                }
                              }}
                              className="text-red-600 hover:text-red-800 text-xs"
                              title="Delete transaction"
                            >
                              🗑
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-300 bg-muted/30">
                    <tr>
                      <td colSpan={2} className="py-2 pr-1 font-bold text-xs">
                        {transactions.length} transaction{transactions.length === 1 ? '' : 's'}
                      </td>
                      <td className="py-2 pr-1 text-right font-mono font-bold text-green-700">{money(totals.dep)}</td>
                      <td className="py-2 pr-1 text-right font-mono font-bold text-red-700">{money(totals.wit)}</td>
                      <td className="py-2 pr-1 text-right font-mono font-bold text-xs">
                        <div>Opening: {money(totals.opening)}</div>
                        <div>Closing: {money(totals.computedClosing)}</div>
                      </td>
                      <td className="py-2"></td>
                    </tr>
                  </tfoot>
                </table>
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={addRow}
                    className="text-xs px-3 py-1.5 border border-blue-300 text-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 font-medium"
                    title="Add a row that OCR may have missed"
                  >
                    + Add Row
                  </button>
                </div>
              </div>
            )}

            {txDirtyCount > 0 && (
              <div className="mt-3 flex gap-2 items-center">
                <button
                  onClick={saveAllTxEdits}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs"
                >
                  💾 {i18n.language === 'en' ? `Save ${txDirtyCount} transaction edit${txDirtyCount === 1 ? '' : 's'}` : `儲存 ${txDirtyCount} 筆交易修改`}
                </button>
                <button
                  onClick={() => setTxEdits({})}
                  className="px-3 py-1.5 border rounded text-xs hover:bg-muted"
                >
                  {i18n.language === 'en' ? 'Discard changes' : '放棄修改'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer actions — sticky bar; pb-24 on the scroll container above prevents it hiding content */}
      <div className="rounded-lg border-2 border-primary bg-primary/5 p-4 sticky bottom-0 z-30 shadow-lg mt-2">
        {isDraft ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm">{i18n.language === 'en' ? 'Ready to save?' : '準備儲存？'}</h3>
              <p className="text-xs text-muted-foreground">
                {i18n.language === 'en'
                  ? <>Click <strong>Save to Database</strong> to confirm this statement. You can still edit it later.</>
                  : <>點擊<strong>儲存至數據庫</strong>確認此月結單。之後仍可編輯。</>}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (confirm(i18n.language === 'en'
                    ? 'Discard this statement? It will be moved to the Recycle Bin where it can be restored within 30 days.'
                    : '放棄此月結單？將移至回收站，可在30天內還原。')) {
                    discardMut.mutate();
                  }
                }}
                disabled={discardMut.isPending}
                className="px-4 py-2 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50 dark:hover:bg-red-950"
              >
                {discardMut.isPending
                  ? (i18n.language === 'en' ? 'Discarding…' : '放棄中…')
                  : (i18n.language === 'en' ? '🗑 Discard' : '🗑 放棄')}
              </button>
              <button
                onClick={saveAndConfirm}
                disabled={confirmMut.isPending || saveHeaderMut.isPending || createTxMut.isPending || transactions.length === 0}
                className="px-6 py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={transactions.length === 0 ? (i18n.language === 'en' ? 'Add at least one transaction before saving' : '儲存前請先新增至少一筆交易') : ''}
              >
                {confirmMut.isPending
                  ? (i18n.language === 'en' ? 'Saving…' : '儲存中…')
                  : (i18n.language === 'en' ? '✅ Save to Database' : '✅ 儲存至數據庫')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {i18n.language === 'en' ? 'This statement is already saved. Edits save instantly.' : '此月結單已儲存。編輯將即時保存。'}
            </p>
            <Link to="/bank-statements"
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
            >
              {i18n.language === 'en' ? '← Back to Bank Statements' : '← 返回銀行月結單'}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="mt-0.5 block w-full px-2 py-1.5 bg-background border border-input rounded text-xs"
      />
    </label>
  );
}
