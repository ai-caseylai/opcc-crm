import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import Chatbot from './Chatbot';
import CookieConsent from './CookieConsent';
import FirmClientSwitcher from './FirmClientSwitcher';
import {
  LayoutDashboard, Users, Truck, Package, FileText, FileSpreadsheet, Mail,
  Calculator, Upload, Settings, LogOut, Menu, X, MessageCircle, Calendar, Briefcase, FolderOpen, Plug, SlidersHorizontal, Landmark, Receipt, CheckSquare, Globe, CreditCard, Smartphone, HardDrive, ShoppingCart, ClipboardList, AlertCircle, BookOpen, ChevronLeft, ChevronRight, Building2, Shield, Tag, Bot,
} from 'lucide-react';

const navGroups = [
  {
    label: '',
    items: [
      { to: '/', icon: LayoutDashboard, key: 'dashboard' },
      { to: '/compliance', icon: Shield, key: 'compliance', hidden: true },
      { to: '/file-storage', icon: HardDrive, key: 'fileStorage' },
      { to: '/expense-receipts', icon: Bot, key: 'telegramBills' },
      { to: '/ai-memory', icon: BookOpen, key: 'aiMemory' },
    ],
  },
  {
    label: '文件處理',
    items: [
      { to: '/bank-statements', icon: Landmark, key: 'bankStatements' },
      { to: '/expense-receipts', icon: Receipt, key: 'expenseReceipts' },
    ],
  },
  {
    label: '會計',
    items: [
      { to: '/bookkeeping', icon: Calculator, key: 'bookkeeping' },
    ],
  },
  {
    label: '客戶',
    hidden: true,
    items: [
      { to: '/customers', icon: Users, key: 'customers' },
      { to: '/suppliers', icon: Truck, key: 'suppliers' },
      { to: '/invoices', icon: FileText, key: 'invoices' },
      { to: '/quotations', icon: FileSpreadsheet, key: 'quotations' },
    ],
  },
  {
    label: '銷售',
    hidden: true,
    items: [
      { to: '/products', icon: Package, key: 'products' },
      { to: '/services', icon: Briefcase, key: 'services' },
      { to: '/purchase-orders', icon: ShoppingCart, key: 'purchaseOrders' },
      { to: '/service-orders', icon: ClipboardList, key: 'serviceOrders' },
    ],
  },
  {
    label: '通訊',
    hidden: true,
    items: [
      { to: '/calendar', icon: Calendar, key: 'calendar' },
      { to: '/messages', icon: MessageCircle, key: 'messages' },
      { to: '/mail', icon: Mail, key: 'mail' },
    ],
  },
  {
    label: '工具',
    hidden: true,
    items: [
      { to: '/todos', icon: CheckSquare, key: 'todos' },
      { to: '/documents', icon: FolderOpen, key: 'documents' },
    ],
  },
  {
    label: '會計師樓',
    items: [
      { to: '/firm/manage', icon: Building2, key: 'firmManagement' },
    ],
  },
  {
    label: '',
    items: [
      { to: '/settings', icon: Settings, key: 'settings' },
    ],
  },
  {
    label: '',
    hidden: true,
    items: [
      { to: '/pricing', icon: Tag, key: 'pricing' },
      { to: '/subscription', icon: CreditCard, key: 'subscription' },
      { to: '/website-generator', icon: Globe, key: 'websiteGenerator' },
      { to: '/card-generator', icon: CreditCard, key: 'cardGenerator' },
      { to: '/modules', icon: SlidersHorizontal, key: 'modules' },
      { to: '/payment', icon: CreditCard, key: 'payment' },
      { to: '/communication', icon: Smartphone, key: 'communication' },
      { to: '/integrations', icon: Plug, key: 'integrations' },
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
  fileStorage: 'fileStorage',
  purchaseOrders: 'purchaseOrders',
  serviceOrders: 'serviceOrders',
  compliance: 'compliance',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user, logout, company, activeClient, isFirmUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Mobile states
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [chatMobileOpen, setChatMobileOpen] = React.useState(false);

  // Desktop states
  const [sidebarDesktopOpen, setSidebarDesktopOpen] = React.useState(true);
  const [chatDesktopOpen, setChatDesktopOpen] = React.useState(true);
  const [chatWidth, setChatWidth] = React.useState(420);
  const [showAll, setShowAll] = React.useState(false);

  // Resize handler for chat panel
  const resizingRef = React.useRef(false);
  const startXRef = React.useRef(0);
  const startWidthRef = React.useRef(0);

  const handleResizeStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = chatWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = startXRef.current - ev.clientX;
      const newWidth = Math.max(280, Math.min(800, startWidthRef.current + delta));
      setChatWidth(newWidth);
    };
    const handleUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [chatWidth]);

  // React Query subscription: refetches when Modules page invalidates ['company']
  const { data: liveCompany } = useQuery({
    queryKey: ['company'],
    queryFn: () => api('/company'),
  });
  const activeCompany = liveCompany || company;

  const { data: fileIssues } = useQuery({
    queryKey: ['file-storage-issues'],
    queryFn: () => api('/file-storage/issues'),
    refetchInterval: 60000,
  });
  const issueCount = (fileIssues?.issues as number) || 0;

  // Parse features from live company data (or fallback to AuthContext)
  const features: Record<string, boolean> = React.useMemo(() => {
    try {
      const src = activeCompany?.features;
      if (src) return typeof src === 'string' ? JSON.parse(src) : src;
    } catch {}
    return {};
  }, [activeCompany]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const sidebarCollapsed = !sidebarDesktopOpen;

  const renderSidebarContent = (collapsed: boolean) => (
    <div className="flex flex-col h-full">
      {/* Company header */}
      {collapsed ? (
        <div className="border-b flex justify-center w-16 py-3">
          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
            {(activeCompany?.name || 'O').charAt(0)}
          </div>
        </div>
      ) : (
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold text-primary">
            {activeClient?.display_name || activeClient?.company_name || activeCompany?.name || t('app.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeClient ? (activeCompany?.name || user?.company_name || 'Firm') : (activeCompany?.domain || user?.company_name || user?.name)}
          </p>
        </div>
      )}

      {/* Language toggle — hidden when collapsed */}
      {!collapsed && (
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
      )}

      {/* Firm client switcher */}
      {!collapsed && <FirmClientSwitcher />}

      {/* Navigation */}
      <nav className={`flex-1 space-y-0.5 overflow-y-auto ${collapsed ? 'p-0' : 'p-2'}`}>
        {navGroups.map((group, gi) => {
          const visibleItems = group.items.filter(item => {
            if ((item as any).hidden && !showAll) return false;
            if (item.key === 'firmManagement') return isFirmUser;
            const featKey = NAV_FEATURE_MAP[item.key];
            if (!featKey) return true;
            return features[featKey] !== false;
          });
          if (group.label && visibleItems.length === 0) return null;
          if ((group as any).hidden && !showAll) return null;
          return (
            <div key={gi}>
              {group.label && !collapsed && (
                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-3 pt-3 pb-1">
                  {group.label}
                </div>
              )}
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.to;
                return (
                  <Link key={item.to} to={item.to} onClick={() => setSidebarOpen(false)}
                    title={collapsed ? t(`nav.${item.key}`) : undefined}
                    className={`relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                      collapsed ? 'justify-center px-0 w-16 h-10' : ''
                    } ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}`}>
                    <Icon className={`flex-shrink-0 ${collapsed ? 'h-5 w-5' : 'h-4 w-4'}`} />
                    {!collapsed && <span className="flex-1">{t(`nav.${item.key}`)}</span>}
                    {!collapsed && item.key === 'fileStorage' && issueCount > 0 && (
                      <span className="flex items-center gap-0.5 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                        <AlertCircle className="h-2.5 w-2.5" />
                        {issueCount}
                      </span>
                    )}
                    {collapsed && item.key === 'fileStorage' && issueCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                        {issueCount > 9 ? '9+' : issueCount}
                      </span>
                    )}
                  </Link>
                );
              })}
              {!collapsed && gi < navGroups.length - 1 && group.label && visibleItems.length > 0 && (
                <div className="mx-3 mt-2 border-b border-border/50" />
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      {collapsed ? (
        <div className="border-t flex justify-center w-16 py-2">
          <button onClick={handleLogout}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" title={t('nav.logout')}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="p-4 border-t space-y-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)}
              className="rounded border-muted-foreground/30" />
            顯示全部功能
          </label>
          <div className="text-sm text-muted-foreground">{user?.email}</div>
          <button onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full px-3 py-2 rounded-md hover:bg-muted">
            <LogOut className="h-4 w-4" /> {t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ====== MOBILE HEADER ====== */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-4 bg-background border-b">
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-md hover:bg-muted">
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <span className="font-bold text-primary">{activeCompany?.name || t('app.title')}</span>
        <button onClick={() => setChatMobileOpen(!chatMobileOpen)} className="p-2 rounded-md hover:bg-muted">
          <MessageCircle className="h-5 w-5" />
        </button>
      </div>

      {/* ====== MOBILE: Sidebar overlay ====== */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`lg:hidden fixed top-0 left-0 z-50 h-full w-64 bg-card border-r transform transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} pt-16`}>
        {renderSidebarContent(false)}
      </aside>

      {/* ====== MOBILE: Chat overlay ====== */}
      {chatMobileOpen && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setChatMobileOpen(false)} />
          <div className="lg:hidden fixed inset-0 z-50 pt-16 bg-background slide-in-right">
            <Chatbot onClose={() => setChatMobileOpen(false)} className="h-full" />
          </div>
        </>
      )}

      {/* ====== DESKTOP 3-PANEL LAYOUT ====== */}
      <div className="hidden lg:grid lg:h-screen" style={{ gridTemplateColumns: `${sidebarDesktopOpen ? 256 : 64}px 1fr ${chatDesktopOpen ? chatWidth : 0}px` }}>

        {/* LEFT: Sidebar */}
        <aside className="bg-card border-r flex flex-col relative panel-transition overflow-y-auto overflow-x-hidden">
          <div className={sidebarDesktopOpen ? 'w-[256px]' : 'w-[64px]'} style={{ minWidth: sidebarDesktopOpen ? 256 : 64 }}>
            {renderSidebarContent(sidebarCollapsed)}
          </div>
          {/* Collapse toggle */}
          <button
            onClick={() => setSidebarDesktopOpen(!sidebarDesktopOpen)}
            className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 bg-card border rounded-full flex items-center justify-center hover:bg-muted shadow-sm cursor-pointer"
            title={sidebarDesktopOpen ? '收合側欄' : '展開側欄'}>
            {sidebarDesktopOpen
              ? <ChevronLeft className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </aside>

        {/* CENTER: Main content */}
        <main className="min-w-0 overflow-y-auto overflow-x-hidden">
          <div className="p-6">
            {children}
          </div>
        </main>

        {/* RIGHT: Chat panel */}
        <aside className={`bg-card overflow-hidden flex flex-col relative ${chatDesktopOpen ? 'border-l' : ''}`}>
          {/* Resize handle */}
          {chatDesktopOpen && (
            <div
              onMouseDown={handleResizeStart}
              className="absolute top-0 left-[-3px] w-[7px] h-full cursor-col-resize hover:bg-primary/30 z-10 group"
              title="拖曳調整寬度"
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/40 group-hover:text-primary text-xs select-none">⇔</div>
            </div>
          )}
          <div className="h-full" style={{ width: chatWidth }}>
            <Chatbot onClose={() => setChatDesktopOpen(false)} className="h-full" />
          </div>
        </aside>
      </div>

      {/* Desktop chat reopen button (when closed) */}
      {!chatDesktopOpen && (
        <button
          onClick={() => setChatDesktopOpen(true)}
          className="hidden lg:flex fixed right-0 top-1/2 -translate-y-1/2 z-30 w-6 h-12 items-center justify-center bg-card border rounded-l-md hover:bg-muted cursor-pointer shadow-sm"
          title="展開 AI 對話">
          <MessageCircle className="h-4 w-4" />
        </button>
      )}

      {/* ====== MOBILE: Main content ====== */}
      <div className="lg:hidden pt-16 min-h-screen">
        <div className="p-6 w-full">
          {children}
        </div>
      </div>
      <CookieConsent />
    </div>
  );
}
