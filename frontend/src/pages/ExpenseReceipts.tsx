import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Upload, Eye, Trash2, Receipt } from 'lucide-react';

const CATEGORIES = ['餐飲', '交通', '辦公', '租金', '水電', '薪金', '營銷', '其他'];

export default function ExpenseReceipts() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [vendorName, setVendorName] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['expense-receipts'],
    queryFn: () => api('/expense-receipts'),
  });

  const uploadMut = useMutation({
    mutationFn: (body: any) => api('/expense-receipts/upload', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expense-receipts'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/expense-receipts/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expense-receipts'] }),
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
        vendor_name: vendorName, amount: amount ? parseFloat(amount) : null,
        expense_date: expenseDate, category, description, payment_method: paymentMethod,
      });
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const receipts = (data?.data || []) as any[];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('expense.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('expense.desc')}</p>
      </div>

      {/* Receipts list */}
      <div className="bg-card border rounded-xl p-6 space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Receipt className="h-4 w-4" /> {t('expense.list')} ({receipts.length})
        </h3>
        {isLoading ? <p className="text-sm text-muted-foreground">{t('common.loading')}</p> :
         receipts.length === 0 ? <p className="text-sm text-muted-foreground">{t('expense.noData')}</p> : (
          <div className="space-y-2">
            {receipts.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between border rounded-md px-4 py-3">
                <div className="space-y-0.5 min-w-0">
                  <div className="text-sm font-medium truncate">{r.vendor_name || r.file_name || 'Receipt'}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {r.expense_date && <span>{r.expense_date}</span>}
                    {r.category && <span className="bg-muted px-1.5 py-0.5 rounded">{r.category}</span>}
                    {r.amount != null && <span className="font-mono font-medium text-foreground">HKD {r.amount.toLocaleString()}</span>}
                    {r.payment_method && <span>{r.payment_method}</span>}
                    {r.ocr_text && r.ocr_text.length > 30 && <span className="text-blue-600">OCR ✓</span>}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0 ml-2">
                  <a href={`/api/expense-receipts/${r.id}/file?token=${localStorage.getItem('token') || ''}`} target="_blank" className="p-1.5 hover:bg-muted rounded"><Eye className="h-4 w-4" /></a>
                  <button onClick={() => { if (confirm(t('common.confirmDelete'))) deleteMut.mutate(r.id); }} className="p-1.5 hover:bg-muted rounded text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
