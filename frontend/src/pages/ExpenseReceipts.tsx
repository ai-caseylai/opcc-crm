import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, WORKER_API_BASE } from '../lib/api';
import { tr } from '../lib/i18nHelpers';
import { Trash2, Download, Search, Pencil } from 'lucide-react';

// Download receipt PDF via authenticated fetch (same as Invoices page)
async function downloadReceiptPDF(receiptId: string, receiptNumber: string) {
  const token = localStorage.getItem('token') || '';
  const activeClientJson = localStorage.getItem('activeClient');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  try { const c = JSON.parse(activeClientJson || '{}'); if (c?.id) headers['X-Active-Client'] = c.id; } catch {}
  try {
    const res = await fetch(`${WORKER_API_BASE}/pdf/invoice/${receiptId}`, { headers });
    if (!res.ok) { alert('PDF generation failed — please try again.'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Receipt_${receiptNumber}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    alert('Could not download PDF. Please check your connection.');
  }
}

export default function ExpenseReceipts() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Receipts from File Storage (invoices table, receipt_number IS NOT NULL)
  const { data: receiptsData, isLoading } = useQuery({
    queryKey: ['invoices-receipts', search, statusFilter],
    queryFn: () => api(`/invoices?doc_type=receipt&limit=200${statusFilter ? `&status=${statusFilter}` : ''}${search ? `&q=${search}` : ''}`),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/invoices/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices-receipts'] }),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/invoices/${id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices-receipts'] }),
  });

  const receipts = (receiptsData as any)?.data || [];

  const statusLabel = (s: string) => {
    const labels: Record<string, string> = {
      draft: tr('Draft', '草稿', '草稿'),
      sent: tr('Sent', '已發出', '已发出'),
      paid: tr('Confirmed', '已確認', '已确认'),
      overdue: tr('Overdue', '逾期', '逾期'),
      cancelled: tr('Cancelled', '已取消', '已取消'),
    };
    return labels[s] || s;
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-700',
      sent: 'bg-blue-100 text-blue-700',
      paid: 'bg-green-100 text-green-700',
      overdue: 'bg-red-100 text-red-700',
      cancelled: 'bg-gray-100 text-gray-500',
    };
    return `px-2 py-0.5 rounded-full text-xs font-medium ${colors[s] || 'bg-gray-100 text-gray-600'}`;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{tr('Receipts', 'Receipts', 'Receipts')}</h2>
          <p className="text-muted-foreground text-sm mt-1">{tr('Manage payment receipts', '管理付款收據', '管理付款收据')}</p>
        </div>
      </div>

      {/* Search + filter bar — same layout as Invoices */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 p-3 border-b">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr("Search receipts...", "搜尋收據…", "搜索收据…")}
              className="w-full pl-8 pr-3 py-1.5 border rounded-md bg-background text-sm"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border rounded-md bg-background text-sm"
          >
            <option value="">{tr('All Status', '全部狀態', '全部状态')}</option>
            <option value="draft">{tr('Draft', '草稿', '草稿')}</option>
            <option value="paid">{tr('Confirmed', '已確認', '已确认')}</option>
            <option value="cancelled">{tr('Cancelled', '已取消', '已取消')}</option>
          </select>
        </div>

        {/* Table — mirrors Invoices exactly */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground text-sm">{tr('Loading...', '載入中…', '载入中…')}</div>
        ) : receipts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">{tr('No receipt records', '未有收據記錄', '未有收据记录')}</p>
            <p className="text-xs mt-2">
              Upload receipt PDFs through{' '}
              <a href="/file-storage" className="text-primary underline">File Storage</a>{' '}
              — they will appear here automatically.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3">{tr('Receipt No.', '收據號碼', '收据号码')}</th>
                <th className="text-left p-3 hidden md:table-cell">{tr('Payer', '付款方', '付款方')}</th>
                <th className="text-left p-3">{tr('Status', '狀態', '状态')}</th>
                <th className="text-right p-3 hidden lg:table-cell">{tr('Amount', '金額', '金额')}</th>
                <th className="text-left p-3 hidden lg:table-cell">{tr('Date', '日期', '日期')}</th>
                <th className="text-right p-3">{tr('Actions', '操作', '操作')}</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((rec: any) => (
                <tr key={rec.id} className="border-b hover:bg-muted/30">
                  {/* Receipt number — show receipt_number if available, else strip REC- prefix */}
                  <td className="p-3 font-medium">
                    {rec.receipt_number || rec.invoice_number?.replace(/^REC-[A-Z0-9]+$/, '') || rec.invoice_number}
                  </td>
                  {/* Payer name */}
                  <td className="p-3 hidden md:table-cell">
                    {rec.vendor_name || rec.customer_name || '-'}
                  </td>
                  {/* Status badge */}
                  <td className="p-3">
                    <span className={statusBadge(rec.status)}>{statusLabel(rec.status)}</span>
                  </td>
                  {/* Amount */}
                  <td className="p-3 text-right hidden lg:table-cell font-mono">
                    {rec.currency || 'HKD'} {Number(rec.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  {/* Date */}
                  <td className="p-3 hidden lg:table-cell text-muted-foreground">{rec.issue_date}</td>
                  {/* Actions */}
                  <td className="p-3 text-right">
                    <button
                      onClick={() => navigate(`/invoices/review/${rec.id}`)}
                      className="p-1 hover:bg-muted rounded mr-1"
                      title={tr("Edit", "編輯", "编辑")}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => downloadReceiptPDF(rec.id, rec.receipt_number || rec.invoice_number)}
                      className="p-1 hover:bg-muted rounded mr-1"
                      title={tr("Download PDF", "下載 PDF", "下载 PDF")}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    {rec.status === 'draft' && (
                      <button
                        onClick={() => updateStatus.mutate({ id: rec.id, status: 'paid' })}
                        className="text-xs text-green-600 hover:underline mr-2"
                      >
                        {tr('Confirm Payment', '確認收款', '确认收款')}
                      </button>
                    )}
                    <button
                      onClick={() => { if (confirm(tr('Delete this receipt?', '確定刪除此收據?', '确定删除此收据?'))) deleteMut.mutate(rec.id); }}
                      className="p-1 hover:bg-muted rounded text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Info tip */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
        <b>Tip:</b> {tr('To upload a receipt PDF, use', '上傳收據 PDF，請使用', '上传收据 PDF，请使用')} {' '}
        <a href="/file-storage" className="underline font-medium">File Storage</a>.
        The system automatically identifies it as a receipt and shows it here.
      </div>
    </div>
  );
}
