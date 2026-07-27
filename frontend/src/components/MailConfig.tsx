import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Mail, Link, Trash2, Check } from 'lucide-react';

export default function MailConfig() {
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState('');
  const [jwt, setJwt] = useState('');
  const [sp, setSp] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: cfg } = useQuery({
    queryKey: ['mail-config'],
    queryFn: () => api('/mail/config'),
  });

  React.useEffect(() => {
    if (cfg?.base_url) setBaseUrl(cfg.base_url);
  }, [cfg]);

  const saveMut = useMutation({
    mutationFn: (body: any) => api('/mail/config', { method: 'PUT', body }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['mail-config'] });
      setSaved(true); setJwt('');
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => api('/mail/config', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mail-config'] }),
  });

  const connected = cfg?.configured && !cfg?.error;

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><Mail className="h-4 w-4" /> 企業郵箱 (Temp Email)</h3>
      <p className="text-sm text-muted-foreground">
        基於 <a href="https://github.com/dreamhunter2333/cloudflare_temp_email" target="_blank" className="text-primary hover:underline">Cloudflare Temp Email</a>，提供每個租戶獨立的企業郵箱。
      </p>

      {connected ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
            <Check className="h-4 w-4" /> 已連接
          </div>
          <div className="text-sm text-emerald-700">{cfg?.address}</div>
          <div className="text-xs text-emerald-600/70">{cfg?.base_url}</div>
          <button onClick={() => { if (confirm('移除郵箱設定？')) deleteMut.mutate(); }}
            className="text-xs text-red-600 hover:underline mt-1">移除</button>
        </div>
      ) : (
        <div className="space-y-3">
          <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
            placeholder="API Base URL (e.g. https://mail.example.com)" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
          <input value={jwt} onChange={e => setJwt(e.target.value)}
            placeholder="Address JWT" className="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono" />
          <input value={sp} onChange={e => setSp(e.target.value)}
            placeholder="Site Password (optional)" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
          <button onClick={() => saveMut.mutate({ base_url: baseUrl, jwt, site_password: sp })} disabled={!baseUrl || !jwt || saveMut.isPending}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:opacity-90 disabled:opacity-50">
            {saved ? '已儲存！' : '連接郵箱'}
          </button>
        </div>
      )}

      {cfg?.error && (
        <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">{cfg.error}</div>
      )}
    </div>
  );
}
