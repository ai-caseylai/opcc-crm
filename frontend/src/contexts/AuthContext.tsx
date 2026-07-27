import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  company_name?: string;
  firm_id?: string;
  firm_role?: string;
}

interface CompanyInfo {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo_url?: string;
  domain?: string;
}

interface ClientInfo {
  id: string;
  client_user_id: string;
  display_name?: string;
  company_name?: string;
  user_name?: string;
  email?: string;
  status?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  company: CompanyInfo | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, company?: string) => Promise<void>;
  logout: () => void;
  firmClients: ClientInfo[];
  activeClient: ClientInfo | null;
  switchClient: (clientId: string | null) => void;
  isFirmUser: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [firmClients, setFirmClients] = useState<ClientInfo[]>([]);
  const [activeClient, setActiveClient] = useState<ClientInfo | null>(null);

  const isFirmUser = !!(user?.firm_id);

  // Domain detection
  useEffect(() => {
    const host = window.location.hostname;
    fetch(`/api/company/by-domain?host=${host}`)
      .then(r => r.json())
      .then(data => {
        if (data && data.name) {
          setCompany(data);
          document.title = data.name + ' CRM';
        }
      })
      .catch(() => {});
  }, []);

  // Restore session from localStorage
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      const u = JSON.parse(savedUser) as User;
      setUser(u);
      // Restore active client
      const savedClientJson = localStorage.getItem('activeClient');
      if (savedClientJson && u.firm_id) {
        try { setActiveClient(JSON.parse(savedClientJson)); } catch {}
      }
    }
    setLoading(false);
  }, []);

  // Fetch firm clients when user has firm membership
  useEffect(() => {
    if (!token || !user?.firm_id) {
      setFirmClients([]);
      setActiveClient(null);
      return;
    }
    api('/firms/my-clients')
      .then(data => {
        const clients = data.data || [];
        setFirmClients(clients);
        // If activeClient is stale (no longer in list), clear it
        const saved = localStorage.getItem('activeClient');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (clients.some((c: ClientInfo) => c.id === parsed.id)) {
              setActiveClient(parsed);
            } else {
              localStorage.removeItem('activeClient');
              setActiveClient(null);
            }
          } catch { localStorage.removeItem('activeClient'); }
        }
      })
      .catch(() => {});
  }, [token, user?.firm_id]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }, []);

  const register = useCallback(async (email: string, password: string, name: string, company?: string) => {
    const data = await api('/auth/register', {
      method: 'POST',
      body: { email, password, name, company_name: company },
    });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('activeClient');
    setToken(null);
    setUser(null);
    setActiveClient(null);
    setFirmClients([]);
  }, []);

  const switchClient = useCallback((clientId: string | null) => {
    if (!clientId) {
      localStorage.removeItem('activeClient');
      setActiveClient(null);
      return;
    }
    const client = firmClients.find(c => c.id === clientId);
    if (client) {
      localStorage.setItem('activeClient', JSON.stringify(client));
      setActiveClient(client);
    }
  }, [firmClients]);

  return (
    <AuthContext.Provider value={{
      user, token, loading, company, login, register, logout,
      firmClients, activeClient, switchClient, isFirmUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
