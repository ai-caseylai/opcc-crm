/**
 * AdminCompanyView.tsx
 * Read-only view of a company's data for platform admin.
 * Route: /admin/company/:userId
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import {
  ChevronLeft, Building2, Users, FileText, Truck, Calculator,
  Landmark, Download, Shield,
} from 'lucide-react';

export default function AdminCompanyView() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const en = i18n.language === 'en';

  if (user?.role !== 'admin') {
    return <div className="p-8 text-center text-muted-foreground">{en ? 'Admin access required.' : '需要管理員權限。'}</div>;
  }

  const { data: summary, isLoading } = useQuery({
    queryKey: ['admin-company', userId],
    queryFn: () => api(`/admin/tenants/${userId}/summary`),
    enabled: !!userId,
  });

  const companyUser = (summary as any)?.user;
  const counts: Record<string, number> = (summary as any)?.counts || {};

  const handleExport = async () => {
    try {
      const data = await api(`/admin/tenants/${userId}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${companyUser?.company_name || userId}_export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(en ? 'Export failed: ' + (err?.message || 'unknown') : '導出失敗');
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {en ? 'Loading company data...' : '載入公司資料...'}
      </div>
    );
  }

  if (!companyUser) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {en ? 'Company not found.' : '找不到公司。'}
      </div>
    );
  }

  const statCards = [
    { label: en ? 'Customers' : '客戶', value: counts.customers || 0, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
    { label: en ? 'Suppliers' : '供應商', value: counts.suppliers || 0, icon: Truck, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/30' },
    { label: en ? 'Invoices' : '發票', value: counts.invoices || 0, icon: FileText, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30' },
    { label: en ? 'Quotations' : '報價單', value: counts.quotations || 0, icon: Calculator, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30' },
    { label: en ? 'Journal Entries' : '日記帳', value: counts.journal_entries || 0, icon: Calculator, color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-950/30' },
    { label: en ? 'Products' : '產品', value: counts.products || 0, icon: Building2, color: 'text-pink-600', bg: 'bg-pink-50 dark:bg-pink-950/30' },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {en ? 'Back to Admin Dashboard' : '返回管理面板'}
      </button>

      {/* Company Header */}
      <div className="bg-card border rounded-xl p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">{companyUser.company_name || companyUser.name}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{companyUser.email}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                  companyUser.role === 'supervisor' ? 'bg-blue-100 text-blue-700' :
                  companyUser.role === 'admin' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{companyUser.role}</span>
                <span className="text-xs text-muted-foreground">
                  {en ? 'Created' : '建立於'}: {companyUser.created_at?.slice(0, 10)}
                </span>
                <span className="text-xs text-muted-foreground">
                  ID: <span className="font-mono">{companyUser.id}</span>
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-muted"
          >
            <Download className="h-4 w-4" />
            {en ? 'Export Data' : '導出數據'}
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map(s => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.bg}`}>
            <div className="flex items-center gap-2 mb-2">
              <s.icon className={`h-4 w-4 ${s.color}`} />
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
            <div className="text-2xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Info Note */}
      <div className="bg-muted/50 border rounded-lg p-4 flex items-start gap-3">
        <Shield className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">
            {en ? 'Read-only view' : '唯讀模式'}
          </p>
          <p>
            {en
              ? 'This is a summary of the company\'s data. Use the Export button to download a full JSON backup. To make changes, ask the company supervisor to do it from their account.'
              : '這是公司數據的摘要。使用導出按鈕下載完整的 JSON 備份。如需變更，請聯繫公司管理員從他們的帳戶進行。'}
          </p>
        </div>
      </div>

      {/* Danger Zone: Deregister */}
      <div className="border-2 border-red-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-red-700 mb-1">
          {en ? 'Danger Zone' : '危險區域'}
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          {en
            ? 'Deregistering a company permanently deletes all their data: invoices, bank statements, customers, suppliers, journal entries, files, and staff accounts. This cannot be undone.'
            : '取消註冊將永久刪除公司所有數據：發票、銀行月結單、客戶、供應商、日記帳、文件及員工帳戶。此操作無法撤銷。'}
        </p>
        <DeregisterButton userId={userId!} companyName={companyUser.company_name || companyUser.name} />
      </div>
    </div>
  );
}

function DeregisterButton({ userId, companyName }: { userId: string; companyName: string }) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const en = i18n.language === 'en';
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (confirmText !== companyName) return;
    setDeleting(true);
    try {
      const res = await api(`/admin/tenants/${userId}`, { method: 'DELETE' }) as any;
      alert(res.message || 'Company deregistered.');
      navigate('/');
    } catch (err: any) {
      alert(en ? 'Failed: ' + (err?.message || 'unknown') : '失敗：' + (err?.message || '未知'));
    }
    setDeleting(false);
  };

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="px-4 py-2 border-2 border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50"
      >
        {en ? 'Deregister This Company' : '取消註冊此公司'}
      </button>
    );
  }

  return (
    <div className="bg-red-50 dark:bg-red-950/20 rounded-lg p-4 space-y-3">
      <p className="text-sm text-red-800 dark:text-red-300 font-medium">
        {en
          ? `Type "${companyName}" to confirm permanent deletion:`
          : `輸入「${companyName}」以確認永久刪除：`}
      </p>
      <input
        value={confirmText}
        onChange={e => setConfirmText(e.target.value)}
        placeholder={companyName}
        className="w-full border border-red-300 rounded-md px-3 py-2 text-sm bg-background"
      />
      <div className="flex gap-2">
        <button
          onClick={handleDelete}
          disabled={confirmText !== companyName || deleting}
          className="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-40"
        >
          {deleting
            ? (en ? 'Deleting...' : '刪除中...')
            : (en ? 'Permanently Delete All Data' : '永久刪除所有數據')}
        </button>
        <button
          onClick={() => { setConfirming(false); setConfirmText(''); }}
          className="px-4 py-2 border rounded-md text-sm hover:bg-muted"
        >
          {en ? 'Cancel' : '取消'}
        </button>
      </div>
    </div>
  );
}
