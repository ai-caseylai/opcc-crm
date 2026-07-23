import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Users, Truck, FileText, FileSpreadsheet, TrendingUp, Calculator, CheckSquare, ArrowRight, Landmark, Receipt, Package } from 'lucide-react';
import AdminDashboard from './AdminDashboard';
import { tr } from '../lib/i18nHelpers';

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  // Admin gets a completely different dashboard
  if (user?.role === 'admin') return <AdminDashboard />;

  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: () => api('/customers?limit=1') });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => api('/suppliers?limit=1') });
  const { data: invoices } = useQuery({ queryKey: ['invoices'], queryFn: () => api('/invoices?limit=1') });
  const { data: quotations } = useQuery({ queryKey: ['quotations'], queryFn: () => api('/quotations?limit=1') });
  const { data: todosData } = useQuery({ queryKey: ['todos'], queryFn: () => api('/todos?status=pending') });
  const { data: dashData } = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard'), refetchInterval: 30000 });

  // Count distinct customers from confirmed invoices (not the customers table which auto-creates entries)
  const { data: invoiceCustomers } = useQuery({
    queryKey: ['invoice-customer-count'],
    queryFn: () => api('/invoices?limit=1'),
  });

  const crmStats = [
    { key: 'customers', value: customers?.total || 0, icon: Users, color: 'text-blue-600', label: tr('Clients', '客戶 Clients', '客户 Clients') },
    { key: 'suppliers', value: suppliers?.total || 0, icon: Truck, color: 'text-green-600', label: tr('Suppliers', '供應商 Suppliers', '供应商 Suppliers') },
    { key: 'invoices', value: invoices?.total || 0, icon: FileText, color: 'text-orange-600', label: tr('Invoices', '發票 Invoices', '发票 Invoices') },
    { key: 'quotations', value: quotations?.total || 0, icon: FileSpreadsheet, color: 'text-purple-600', label: tr('Quotations', '報價單 Quotations', '报价单 Quotations') },
  ];

  const d = dashData || {};

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('dashboard.welcome')}, {user?.name}</h2>
        <p className="text-muted-foreground mt-1">{t('dashboard.overview')}{d.source === 'bank' ? <span className="text-amber-600 text-xs ml-2">{tr('(Bank data estimate — please post auto-generated entries)', '（銀行數據估算 — 請執行自動產生分錄）', '（银行數據估算 — 請執行自动產生分錄）')}</span> : ''}</p>
      </div>

      {/* CRM stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {crmStats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.key} className="bg-card border rounded-xl p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Icon className={`h-4 w-4 ${s.color}`} />
                {(s as any).label || t(`dashboard.${s.key}`)}
              </div>
              <div className="text-2xl font-bold">{s.value}</div>
            </div>
          );
        })}
      </div>

      {/* Accounting snapshot */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {[
          { label: tr('Bank Cash', '銀行現金 Cash', '银行現金 Cash'), value: d.cash_balance, icon: Landmark, color: 'text-blue-600' },
          { label: tr('Accounts Receivable AR', '應收賬款 AR', '应收账款 AR'), value: d.ar_balance, icon: TrendingUp, color: 'text-amber-600' },
          { label: tr('Accounts Payable AP', '應付賬款 AP', '应付账款 AP'), value: d.ap_balance, icon: TrendingUp, color: 'text-red-600' },
          { label: tr('Revenue MTD', '本月收入 Revenue', '本月收入 Revenue'), value: d.revenue_mtd, icon: TrendingUp, color: 'text-green-600' },
          { label: tr('Expenses MTD', '本月支出 Expenses', '本月支出 Expenses'), value: d.expenses_mtd, icon: TrendingUp, color: 'text-red-600' },
          { label: tr('Net Income MTD', '本月淨利 Net Income', '本月净利 Net Income'), value: d.net_income_mtd, icon: Receipt, color: (d.net_income_mtd || 0) >= 0 ? 'text-green-600' : 'text-red-600' },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="bg-card border rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Icon className={`h-3 w-3 ${m.color}`} /> {m.label}
              </div>
              <div className={`text-sm font-bold ${m.color}`}>
                HKD {(m.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* P&L + Assets */}
        <div className="bg-card border rounded-xl p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {tr('Fixed Assets', '固定資產 Fixed Assets', '固定资产 Fixed Assets')}
            <a href="/fixed-assets" className="ml-auto text-xs text-primary hover:underline flex items-center gap-1">
              {tr('Manage', '管理', '管理')} <ArrowRight className="h-3 w-3" />
            </a>
          </h3>
          {d.fixed_assets && d.fixed_assets.count > 0 ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">資產數量</span><span>{d.fixed_assets.count}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">原值</span><span className="font-mono">HKD {d.fixed_assets.total_cost?.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">累計折舊</span><span className="font-mono text-red-600">HKD {d.fixed_assets.total_acc_depn?.toLocaleString()}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="font-medium">賬面淨值</span><span className="font-mono font-medium">HKD {d.fixed_assets.total_nbv?.toLocaleString()}</span></div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{tr('No fixed assets', '未有固定資產', '未有固定资产')}</p>
          )}
        </div>

        {/* To-dos + Quick Actions */}
        <div className="space-y-6">
          <div className="bg-card border rounded-xl p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-primary" />
              {t('todos.title')} <span className="text-sm font-normal text-muted-foreground">({(todosData?.data || []).length})</span>
              <a href="/todos" className="ml-auto text-xs text-primary hover:underline flex items-center gap-1">
                {t('common.viewAll')} <ArrowRight className="h-3 w-3" />
              </a>
            </h3>
            {(todosData?.data || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('todos.empty')}</p>
            ) : (
              <div className="space-y-1.5">
                {(todosData?.data || []).slice(0, 5).map((td: any) => (
                  <div key={td.id} className="flex items-center gap-2 text-sm py-1">
                    <span className={td.priority === 'high' ? 'text-red-500' : td.priority === 'low' ? 'text-green-500' : 'text-yellow-500'}>●</span>
                    <span className="flex-1 truncate">{td.title}</span>
                    {td.due_date && <span className="text-xs text-muted-foreground">{td.due_date}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-card border rounded-xl p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              {t('dashboard.quickActions')}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: tr('Add Customer', '新增客戶', '新增客户'), href: '/customers' },
                { label: tr('Add Supplier', '新增供應商', '新增供应商'), href: '/suppliers' },
                { label: tr('Create Invoice', '建立發票', '建立发票'), href: '/invoices' },
                { label: tr('Bookkeeping', '記帳', '记账'), href: '/bookkeeping' },
                { label: tr('Bank Statements', '銀行月結單', '银行月结单'), href: '/bank-statements' },
                { label: tr('Fixed Assets', '固定資產', '固定资产'), href: '/fixed-assets' },
              ].map((a) => (
                <a key={a.label} href={a.href}
                  className="text-center py-3 px-4 bg-muted rounded-lg text-sm hover:bg-accent transition-colors">
                  {a.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
