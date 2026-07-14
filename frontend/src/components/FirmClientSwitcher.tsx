import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Building2, ChevronDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export default function FirmClientSwitcher() {
  const { isFirmUser, firmClients, activeClient, switchClient } = useAuth();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  if (!isFirmUser) return null;

  const handleSwitch = (client: { id: string } | null) => {
    setOpen(false);
    if (client) {
      switchClient(client.id);
    } else {
      switchClient(null);
    }
    // Invalidate all data queries to reload with new client context
    queryClient.invalidateQueries();
  };

  return (
    <div className="relative px-3 mb-2">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm border bg-background hover:bg-muted transition-colors">
        <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left truncate text-xs">
          {activeClient?.display_name || activeClient?.company_name || 'Select Client'}
        </span>
        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-card border rounded-lg shadow-lg max-h-96 overflow-y-auto">
            {firmClients.map((client) => (
              <button key={client.id}
                onClick={() => handleSwitch(client)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${
                  activeClient?.id === client.id ? 'bg-primary/10 font-medium text-primary' : ''
                }`}>
                <div className="truncate">{client.display_name || client.company_name || client.user_name}</div>
                {client.email && <div className="text-[10px] text-muted-foreground truncate">{client.email}</div>}
              </button>
            ))}
            {activeClient && (
              <>
                <div className="border-t" />
                <button onClick={() => handleSwitch(null)}
                  className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
                  Firm Overview
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
