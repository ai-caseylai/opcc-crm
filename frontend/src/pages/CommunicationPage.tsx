import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Smartphone, Check, Plus, Trash2, Copy, Key } from 'lucide-react';

function WuzapiConfig() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: cfg } = useQuery({
    queryKey: ['wuzapi-config'],
    queryFn: async () => {
      const d = await api('/messaging/channels');
      const wa = (d.data || []).find((c: any) => c.channel_type === 'whatsapp' && c.is_active);
      if (wa) return await api(`/messaging/channels/${wa.id}`).catch(() => ({}));
      return null;
    },
  });

  React.useEffect(() => {
    if (cfg?.wuzapi_url) setUrl(cfg.wuzapi_url);
    if (cfg?.wuzapi_key) setKey(cfg.wuzapi_key);
  }, [cfg]);

  const saveMut = useMutation({
    mutationFn: async (body: any) => {
      if (cfg?.id) return api(`/messaging/channels/${cfg.id}`, { method: 'PUT', body });
      return api('/messaging/channels', { method: 'POST', body: { ...body, channel_type: 'whatsapp', name: 'WhatsApp WUZAPI' } });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['wuzapi-config'] }); setSaved(true); setTimeout(() => setSaved(false), 2000); },
  });

  const connected = !!(cfg?.wuzapi_url && cfg?.wuzapi_key);

  return (
    <div className="space-y-4">
      {connected ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-800"><Check className="h-4 w-4" /> 已連接</div>
          <div className="text-sm text-emerald-700">{cfg?.wuzapi_url}</div>
          <button onClick={() => { setUrl(''); setKey(''); saveMut.mutate({ wuzapi_url: '', wuzapi_key: '' }); }} className="text-xs text-red-600 hover:underline">移除</button>
        </div>
      ) : (
        <div className="space-y-3">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="WUZAPI URL" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
          <input value={key} onChange={e => setKey(e.target.value)} placeholder="API Key" type="password" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
          <p className="text-xs text-muted-foreground">WhatsApp Webhook: <code className="bg-muted px-1 rounded">/api/messaging/whatsapp/webhook/:channelId</code></p>
          <button onClick={() => saveMut.mutate({ wuzapi_url: url, wuzapi_key: key })} disabled={!url || !key || saveMut.isPending}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:opacity-90 disabled:opacity-50">{saved ? '已儲存' : '連接 WUZAPI'}</button>
        </div>
      )}
    </div>
  );
}

export default function CommunicationPage() {
  const queryClient = useQueryClient();
  const [tokenName, setTokenName] = useState('');
  const [tokenScopes, setTokenScopes] = useState('read');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wbKey, setWbKey] = useState<string | null>(null);
  const [wbKeyNew, setWbKeyNew] = useState<string | null>(null);

  useQuery({
    queryKey: ['wb-api-key'],
    queryFn: async () => { const data = await api('/wb/key'); if (data.api_key) setWbKey(data.api_key); return data; },
  });

  const genWbKey = useMutation({
    mutationFn: () => api('/wb/key', { method: 'POST' }),
    onSuccess: (data: any) => { setWbKeyNew(data.api_key); queryClient.invalidateQueries({ queryKey: ['wb-api-key'] }); },
  });

  const deleteWbKey = useMutation({
    mutationFn: () => api('/wb/key', { method: 'DELETE' }),
    onSuccess: () => { setWbKey(null); setWbKeyNew(null); queryClient.invalidateQueries({ queryKey: ['wb-api-key'] }); },
  });

  const { data: tokens } = useQuery({ queryKey: ['api-tokens'], queryFn: () => api('/workbuddy/tokens') });

  const createToken = useMutation({
    mutationFn: () => api('/workbuddy/tokens', { method: 'POST', body: { name: tokenName, scopes: tokenScopes } }),
    onSuccess: (data) => { setNewToken(data.token); setTokenName(''); queryClient.invalidateQueries({ queryKey: ['api-tokens'] }); },
  });

  const deleteToken = useMutation({
    mutationFn: (id: string) => api(`/workbuddy/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-tokens'] }),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">通訊整合</h2>
        <p className="text-muted-foreground mt-1">WhatsApp · WorkBuddy API</p>
      </div>

      {/* WhatsApp WUZAPI */}
      <div className="bg-card border rounded-xl p-6">
        <h3 className="font-semibold flex items-center gap-2 mb-3"><Smartphone className="h-4 w-4" /> WhatsApp (WUZAPI-CLI)</h3>
        <p className="text-sm text-muted-foreground mb-3">連接 <a href="https://github.com/wuzapi/wuzapi" target="_blank" className="text-primary hover:underline">WUZAPI</a> 以收發 WhatsApp 訊息</p>
        <WuzapiConfig />
      </div>

      {/* API Tokens */}
      <div className="bg-card border rounded-xl p-6 space-y-4">
        <h3 className="font-semibold flex items-center gap-2"><Key className="h-4 w-4" /> WorkBuddy API 令牌</h3>
        <div className="flex gap-3">
          <input value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="令牌名稱" className="flex-1 px-3 py-2 border rounded-md bg-background text-sm" />
          <select value={tokenScopes} onChange={(e) => setTokenScopes(e.target.value)} className="px-3 py-2 border rounded-md bg-background text-sm">
            <option value="read">Read</option><option value="read write">Read & Write</option>
          </select>
          <button onClick={() => createToken.mutate()} disabled={!tokenName || createToken.isPending}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:opacity-90 disabled:opacity-50">
            <Plus className="h-4 w-4" /> 建立
          </button>
        </div>
        {newToken && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <code className="text-xs break-all">{newToken}</code>
            <button onClick={() => { navigator.clipboard.writeText(newToken); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="text-xs text-primary hover:underline ml-2">{copied ? '已複製' : '複製'}</button>
          </div>
        )}
        <div className="space-y-1">
          {(tokens?.data || []).map((t: any) => (
            <div key={t.id} className="flex items-center justify-between border rounded-md px-3 py-2">
              <div><div className="text-sm">{t.name}</div><div className="text-xs text-muted-foreground">{t.scopes}</div></div>
              <button onClick={() => { if (confirm('刪除?')) deleteToken.mutate(t.id); }} className="p-1 hover:bg-muted rounded text-destructive"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      </div>

      {/* WorkBuddy API Key */}
      <div className="bg-card border rounded-xl p-6 space-y-3">
        <h3 className="font-semibold">WorkBuddy API Key</h3>
        <p className="text-xs text-muted-foreground">JWT 替代方案，帶 <code className="bg-muted px-1 rounded">X-API-Key</code> 頭</p>
        {wbKeyNew ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3"><code className="text-xs break-all">{wbKeyNew}</code></div>
        ) : wbKey ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{wbKey.substring(0, 12)}••••••••••••</span>
            <button onClick={() => { if (confirm('撤銷?')) deleteWbKey.mutate(); }} className="text-xs text-destructive hover:underline">撤銷</button>
          </div>
        ) : (
          <button onClick={() => genWbKey.mutate()} disabled={genWbKey.isPending}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90">{genWbKey.isPending ? '...' : '生成 API Key'}</button>
        )}
      </div>
    </div>
  );
}
