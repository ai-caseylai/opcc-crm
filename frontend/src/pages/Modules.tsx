import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { ToggleLeft, ToggleRight } from 'lucide-react';

const MODULES = [
  { key: 'customers', label: '客戶 Customers', desc: '客戶資料庫管理' },
  { key: 'suppliers', label: '供應商 Suppliers', desc: '供應商資料庫管理' },
  { key: 'products', label: '產品 Products', desc: '產品目錄與庫存' },
  { key: 'services', label: '服務 Services', desc: '服務項目與預約' },
  { key: 'invoices', label: '發票 Invoices', desc: '開立與管理銷售發票' },
  { key: 'quotations', label: '報價單 Quotations', desc: '建立報價單並可轉換為發票' },
  { key: 'bookkeeping', label: '記帳 Bookkeeping', desc: '雙式記帳、試算表與損益表' },
  { key: 'bankStatements', label: '銀行月結單 Bank Statements', desc: '上傳及管理銀行月結單' },
  { key: 'expenseReceipts', label: '消費單據 Expense Receipts', desc: '上傳及管理消費收據' },
  { key: 'calendar', label: '日曆 Calendar', desc: '排程、事件與約會管理' },
  { key: 'messages', label: '訊息 Messages', desc: 'Telegram / WhatsApp 客戶通訊' },
  { key: 'documents', label: '公司文件 Documents', desc: 'BR 商業登記 / CI 公司註冊證書' },
];

export default function Modules() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: company } = useQuery({ queryKey: ['company'], queryFn: () => api('/company') });

  const [features, setFeatures] = useState<Record<string, boolean>>({});
  React.useEffect(() => {
    if (company?.features) {
      const f = typeof company.features === 'string' ? JSON.parse(company.features) : company.features;
      setFeatures(f || {});
    }
  }, [company]);

  const toggle = async (key: string) => {
    const next = { ...features, [key]: !features[key] };
    setFeatures(next);
    // Persist to server
    await api('/company', { method: 'PUT', body: { features: JSON.stringify(next) } });
    // Force-refetch so Layout + FeatureGuard update immediately
    queryClient.setQueryData(['company'], (old: any) => ({ ...(old || {}), features: next }));
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">{t('modules.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('modules.desc')}</p>
      </div>

      <div className="bg-card border rounded-xl p-6">
        <div className="grid grid-cols-1 gap-2">
          {MODULES.map((m) => {
            const on = features[m.key] !== false;
            const Icon = on ? ToggleRight : ToggleLeft;
            return (
              <button key={m.key} onClick={() => toggle(m.key)}
                className={`flex items-center gap-4 p-4 rounded-lg border text-left transition-colors ${
                  on ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'
                }`}>
                <Icon className={`h-6 w-6 flex-shrink-0 ${on ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${on ? 'text-foreground' : 'text-muted-foreground'}`}>{m.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{m.desc}</div>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  {on ? '啟用' : '停用'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
