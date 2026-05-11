import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Users, Truck, FileText, FileSpreadsheet, TrendingUp, Calculator, CheckSquare, ArrowRight } from 'lucide-react';

export default function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: () => api('/customers?limit=1') });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => api('/suppliers?limit=1') });
  const { data: invoices } = useQuery({ queryKey: ['invoices'], queryFn: () => api('/invoices?limit=1') });
  const { data: quotations } = useQuery({ queryKey: ['quotations'], queryFn: () => api('/quotations?limit=1') });
  const { data: incomeData } = useQuery({ queryKey: ['income-statement'], queryFn: () => api('/bookkeeping/income-statement') });
  const { data: todosData } = useQuery({ queryKey: ['todos'], queryFn: () => api('/todos?status=pending') });

  const stats = [
    { key: 'customers', value: customers?.total || 0, icon: Users, color: 'text-blue-600' },
    { key: 'suppliers', value: suppliers?.total || 0, icon: Truck, color: 'text-green-600' },
    { key: 'invoices', value: invoices?.total || 0, icon: FileText, color: 'text-orange-600' },
    { key: 'quotations', value: quotations?.total || 0, icon: FileSpreadsheet, color: 'text-purple-600' },
  ];

  const pl = incomeData || {};

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('dashboard.welcome')}, {user?.name}</h2>
        <p className="text-muted-foreground mt-1">{t('dashboard.overview')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.key} className="bg-card border rounded-xl p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Icon className={`h-4 w-4 ${s.color}`} />
                {t(`dashboard.${s.key}`)}
              </div>
              <div className="text-2xl font-bold">{s.value}</div>
            </div>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-card border rounded-xl p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            {t('dashboard.profitLoss')}
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('dashboard.revenue')}</span>
              <span className="font-semibold text-green-600">HKD {(pl.revenue || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('dashboard.expenses')}</span>
              <span className="font-semibold text-red-600">HKD {(pl.expenses || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="font-semibold">{t('dashboard.netIncome')}</span>
              <span className={`font-bold ${(pl.net_income || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                HKD {(pl.net_income || 0).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

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
              { label: t('dashboard.addCustomer'), href: '/customers' },
              { label: t('dashboard.addSupplier'), href: '/suppliers' },
              { label: t('dashboard.createInvoice'), href: '/invoices' },
              { label: t('dashboard.createQuotation'), href: '/quotations' },
              { label: t('dashboard.importData'), href: '/import' },
              { label: t('dashboard.journalEntry'), href: '/bookkeeping' },
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
  );
}
