import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import Chatbot from './Chatbot';
import {
  LayoutDashboard, Users, Truck, Package, FileText, FileSpreadsheet, Mail,
  Calculator, Upload, Settings, LogOut, Menu, X, MessageCircle, Calendar, Briefcase, FolderOpen, Plug, SlidersHorizontal, Landmark, Receipt, CheckSquare, Globe, CreditCard, Smartphone,
} from 'lucide-react';

const navGroups = [
  {
    label: '',
    items: [
      { to: '/', icon: LayoutDashboard, key: 'dashboard' },
    ],
  },
  {
    label: 'CRM',
    items: [
      { to: '/customers', icon: Users, key: 'customers' },
      { to: '/suppliers', icon: Truck, key: 'suppliers' },
    ],
  },
  {
    label: '銷售 Sales',
    items: [
      { to: '/products', icon: Package, key: 'products' },
      { to: '/services', icon: Briefcase, key: 'services' },
      { to: '/invoices', icon: FileText, key: 'invoices' },
      { to: '/quotations', icon: FileSpreadsheet, key: 'quotations' },
    ],
  },
  {
    label: '財務 Finance',
    items: [
      { to: '/bookkeeping', icon: Calculator, key: 'bookkeeping' },
      { to: '/bank-statements', icon: Landmark, key: 'bankStatements' },
      { to: '/expense-receipts', icon: Receipt, key: 'expenseReceipts' },
    ],
  },
  {
    label: '通訊',
    items: [
      { to: '/calendar', icon: Calendar, key: 'calendar' },
      { to: '/mail', icon: Mail, key: 'mail' },
      { to: '/messages', icon: MessageCircle, key: 'messages' },
    ],
  },
  {
    label: '工具 Tools',
    items: [
      { to: '/todos', icon: CheckSquare, key: 'todos' },
      { to: '/documents', icon: FolderOpen, key: 'documents' },
      { to: '/import', icon: Upload, key: 'import' },
    ],
  },
  {
    label: '',
    items: [
      { to: '/website-generator', icon: Globe, key: 'websiteGenerator' },
      { to: '/modules', icon: SlidersHorizontal, key: 'modules' },
      { to: '/payment', icon: CreditCard, key: 'payment' },
      { to: '/communication', icon: Smartphone, key: 'communication' },
      { to: '/integrations', icon: Plug, key: 'integrations' },
      { to: '/settings', icon: Settings, key: 'settings' },
    ],
  },
];

const languages = [
  { code: 'zh-Hant', label: '繁' },
  { code: 'zh-Hans', label: '简' },
  { code: 'en', label: 'EN' },
];

// Nav key → feature flag mapping
const NAV_FEATURE_MAP: Record<string, string> = {
  customers: 'customers',
  suppliers: 'suppliers',
  products: 'products',
  services: 'services',
  invoices: 'invoices',
  quotations: 'quotations',
  bookkeeping: 'bookkeeping',
  bankStatements: 'bankStatements',
  expenseReceipts: 'expenseReceipts',
  calendar: 'calendar',
  messages: 'messages',
  documents: 'documents',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user, logout, company } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  // React Query subscription: refetches when Modules page invalidates ['company']
  const { data: liveCompany } = useQuery({
    queryKey: ['company'],
    queryFn: () => api('/company'),
  });
  const activeCompany = liveCompany || company;

  // Parse features from live company data (or fallback to AuthContext)
  const features: Record<string, boolean> = React.useMemo(() => {
    try {
      const src = activeCompany?.features;
      if (src) return typeof src === 'string' ? JSON.parse(src) : src;
    } catch {}
    return {};
  }, [activeCompany]);

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-4 bg-background border-b">
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-md hover:bg-muted">
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <span className="font-bold text-primary">{activeCompany?.name || t('app.title')}</span>
        <div className="w-10" />
      </div>

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 z-50 h-full w-64 bg-card border-r transform transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} pt-16 lg:pt-0`}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b">
            <h1 className="text-xl font-bold text-primary">{activeCompany?.name || t('app.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{activeCompany?.domain || user?.company_name || user?.name}</p>
          </div>
          {/* Language toggle — 繁 | 简 | EN */}
          <div className="px-3 py-2 flex gap-1">
            {languages.map((l) => {
              const active = i18n.language === l.code;
              return (
                <button key={l.code} onClick={() => i18n.changeLanguage(l.code)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}>
                  {l.label}
                </button>
              );
            })}
          </div>
          <nav className="flex-1 p-4 space-y-0.5 overflow-y-auto">
            {navGroups.map((group, gi) => {
              const visibleItems = group.items.filter(item => {
                const featKey = NAV_FEATURE_MAP[item.key];
                if (!featKey) return true;
                return features[featKey] !== false;
              });
              // Skip labelled groups with no visible items
              if (group.label && visibleItems.length === 0) return null;
              return (
                <div key={gi}>
                  {group.label && (
                    <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-3 pt-3 pb-1">
                      {group.label}
                    </div>
                  )}
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.to;
                    return (
                      <Link key={item.to} to={item.to} onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}`}>
                        <Icon className="h-4 w-4" />
                        <span>{t(`nav.${item.key}`)}</span>
                      </Link>
                    );
                  })}
                  {gi < navGroups.length - 1 && group.label && visibleItems.length > 0 && (
                    <div className="mx-3 mt-2 border-b border-border/50" />
                  )}
                </div>
              );
            })}
          </nav>
          <div className="p-4 border-t space-y-3">
            <div className="text-sm text-muted-foreground">{user?.email}</div>
            <button onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full px-3 py-2 rounded-md hover:bg-muted">
              <LogOut className="h-4 w-4" /> {t('nav.logout')}
            </button>
          </div>
        </div>
      </aside>

      <main className="lg:pl-64 pt-16 lg:pt-0 min-h-screen">
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
      <Chatbot />
    </div>
  );
}
