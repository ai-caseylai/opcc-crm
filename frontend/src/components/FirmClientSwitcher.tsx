import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Building2, Plus, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { tr } from '../lib/i18nHelpers';

export default function CompanySwitcher() {
  const { user, isFirmUser, firmClients, activeClient, switchClient } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Show for firm users and for accountant/supervisor roles
  const showCompanySelector = isFirmUser || ['admin', 'supervisor', 'accountant'].includes(user?.role || '');

  if (!showCompanySelector) return null;

  const clients = isFirmUser ? (firmClients || []) : [];
  const filtered = search.trim()
    ? clients.filter(c =>
        (c.display_name || c.company_name || '').toLowerCase().includes(search.toLowerCase()) ||
        (c.email || '').toLowerCase().includes(search.toLowerCase()))
    : clients;

  const handleSwitch = (client: { id: string } | null) => {
    setOpen(false);
    setSearch('');
    if (client) {
      switchClient(client.id);
    } else {
      switchClient(null);
    }
    queryClient.invalidateQueries();
  };

  const canCreateClient = ['admin', 'supervisor', 'accountant'].includes(user?.role || '');

  return (
    <div className="relative px-3 mb-2">
      <div className="flex items-center gap-1">
        <button onClick={() => setOpen(!open)}
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md text-sm border bg-background hover:bg-muted transition-colors">
          <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left truncate text-xs">
            {activeClient?.display_name || activeClient?.company_name || tr('Select company', '選擇公司', '选择公司')}
          </span>
        </button>
        {canCreateClient && (
          <button onClick={() => navigate('/new-client')}
            className="px-2 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition flex items-center gap-1 shrink-0"
            title={tr('New client company', '新增客戶公司', '新增客户公司')}>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tr('New', '新增', '新增')}</span>
          </button>
        )}
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch(''); }} />
          <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-card border rounded-lg shadow-lg max-h-96 overflow-hidden flex flex-col">
            {isFirmUser && clients.length > 0 && (
              <div className="p-2 border-b">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50">
                  <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={tr('Search company...', '搜尋公司...', '搜寻公司...')}
                    className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>
            )}
            <div className="overflow-y-auto max-h-64">
              {filtered.map((client) => (
                <button key={client.id}
                  onClick={() => handleSwitch(client)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${
                    activeClient?.id === client.id ? 'bg-primary/10 font-medium text-primary' : ''
                  }`}>
                  <div className="truncate">{client.display_name || client.company_name || client.user_name}</div>
                  {client.email && <div className="text-[10px] text-muted-foreground truncate">{client.email}</div>}
                </button>
              ))}
              {search && filtered.length === 0 && (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                  {tr('No matching company', '無匹配公司', '无匹配公司')}
                </div>
              )}
            </div>
            {activeClient && (
              <>
                <div className="border-t" />
                <button onClick={() => handleSwitch(null)}
                  className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
                  {tr('Firm Overview', '會計師樓總覽', '会计师楼总览')}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
