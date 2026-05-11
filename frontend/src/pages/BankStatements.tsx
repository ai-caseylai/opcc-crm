import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Upload, Eye, Trash2, Landmark } from 'lucide-react';

export default function BankStatements() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [stmtYear, setStmtYear] = useState(new Date().getFullYear());
  const [stmtMonth, setStmtMonth] = useState(new Date().getMonth() + 1);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['bank-statements'],
    queryFn: () => api('/bank-statements'),
  });

  const uploadMut = useMutation({
    mutationFn: (body: any) => api('/bank-statements/upload', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bank-statements'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/bank-statements/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bank-statements'] }),
  });

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      uploadMut.mutate({
        file_name: file.name, file_type: file.type, file_data: base64,
        bank_name: bankName, account_number: accountNumber,
        statement_year: stmtYear, statement_month: stmtMonth,
      });
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const statements = (data?.data || []) as any[];

  const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('bank.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('bank.desc')}</p>
      </div>

      {/* Upload */}
      <div className="bg-card border rounded-xl p-6 space-y-4">
        <h3 className="font-semibold">{t('bank.upload')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">{t('bank.bankName')}</label>
            <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="HSBC / 恒生"
              className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('bank.accountNo')}</label>
            <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="123-456-789"
              className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('bank.year')}</label>
            <input type="number" value={stmtYear} onChange={e => setStmtYear(parseInt(e.target.value))}
              className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('bank.month')}</label>
            <select value={stmtMonth} onChange={e => setStmtMonth(parseInt(e.target.value))}
              className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5">
              {months.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
            </select>
          </div>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
          <Upload className="h-4 w-4" /> {uploading ? '...' : t('bank.uploadBtn')}
          <input type="file" accept="image/*,.pdf" onChange={handleUpload} className="hidden" />
        </label>
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
              <div key={s.id} className="flex items-center justify-between border rounded-md px-4 py-3">
                <div className="space-y-0.5 min-w-0">
                  <div className="text-sm font-medium truncate">{s.file_name || 'Statement'}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {s.bank_name && <span className="font-medium">{s.bank_name}</span>}
                    {s.account_number && <span>{s.account_number}</span>}
                    <span>{s.statement_year}-{String(s.statement_month).padStart(2,'0')}</span>
                    {s.closing_balance != null && (
                      <span className={`font-mono ${s.closing_balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        HKD {s.closing_balance.toLocaleString()}
                      </span>
                    )}
                    {s.ocr_text && s.ocr_text.length > 30 && <span className="text-blue-600">OCR ✓</span>}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0 ml-2">
                  <a href={`/api/bank-statements/${s.id}/file`} target="_blank" className="p-1.5 hover:bg-muted rounded"><Eye className="h-4 w-4" /></a>
                  <button onClick={() => { if (confirm(t('common.confirmDelete'))) deleteMut.mutate(s.id); }} className="p-1.5 hover:bg-muted rounded text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
