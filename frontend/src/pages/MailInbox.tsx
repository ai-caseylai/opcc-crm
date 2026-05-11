import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Mail, ArrowLeft, Send, RefreshCw } from 'lucide-react';

export default function MailInbox() {
  const queryClient = useQueryClient();
  const [viewId, setViewId] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const { data: cfg } = useQuery({
    queryKey: ['mail-config'],
    queryFn: () => api('/mail/config'),
  });

  const { data: inbox, isLoading } = useQuery({
    queryKey: ['mail-inbox'],
    queryFn: () => api('/mail/inbox?limit=50'),
    enabled: !!cfg?.configured,
    refetchInterval: 30000,
  });

  const { data: detail } = useQuery({
    queryKey: ['mail-detail', viewId],
    queryFn: () => api(`/mail/inbox/${viewId}`),
    enabled: !!viewId,
  });

  const sendMut = useMutation({
    mutationFn: (data: any) => api('/mail/send', { method: 'POST', body: data }),
    onSuccess: () => { setComposing(false); setTo(''); setSubject(''); setBody(''); },
  });

  const handleSend = () => {
    if (!to || !subject) return;
    sendMut.mutate({ to_mail: to, to_name: '', subject, content: body, is_html: false });
  };

  if (!cfg?.configured) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <Mail className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
        <h2 className="text-xl font-bold mb-2">尚未設定郵箱</h2>
        <p className="text-muted-foreground mb-4">請先在「整合」頁面設定 Cloudflare Temp Email</p>
        <a href="/integrations" className="text-primary hover:underline text-sm">前往設定 →</a>
      </div>
    );
  }

  const mails = inbox?.results || [];

  if (viewId && detail) {
    return (
      <div className="space-y-4 max-w-3xl">
        <button onClick={() => setViewId(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> 返回收件箱
        </button>
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-bold">{detail.subject}</h2>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-2">
              <span>{detail.sender}</span>
              <span>{detail.created_at}</span>
            </div>
          </div>
          <div className="border-t pt-4">
            {detail.html ? (
              <div dangerouslySetInnerHTML={{ __html: detail.html }} className="prose prose-sm max-w-none" />
            ) : (
              <pre className="text-sm whitespace-pre-wrap font-sans">{detail.text}</pre>
            )}
          </div>
          {detail.attachments?.length > 0 && (
            <div className="border-t pt-3">
              <p className="text-sm font-medium mb-2">附件 ({detail.attachments.length})</p>
              <div className="flex flex-wrap gap-2">
                {detail.attachments.map((a: any, i: number) => (
                  <span key={i} className="text-xs bg-muted px-2 py-1 rounded">{a.filename} ({a.size} bytes)</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">收件箱</h2>
          <p className="text-muted-foreground mt-1 text-sm">{cfg?.address || '...'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ['mail-inbox'] })}
            className="p-2 hover:bg-muted rounded"><RefreshCw className="h-4 w-4" /></button>
          <button onClick={() => setComposing(true)}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm hover:opacity-90">
            <Send className="h-4 w-4" /> 寫信
          </button>
        </div>
      </div>

      {/* Compose */}
      {composing && (
        <div className="bg-card border rounded-xl p-4 space-y-3">
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="收件人 Email" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="主旨" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder="內容..." className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setComposing(false)} className="px-4 py-2 border rounded-md text-sm">取消</button>
            <button onClick={handleSend} disabled={!to || !subject || sendMut.isPending}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:opacity-90 disabled:opacity-50">
              {sendMut.isPending ? '發送中...' : '發送'}
            </button>
          </div>
        </div>
      )}

      {/* Mail list */}
      {isLoading ? <p className="text-sm text-muted-foreground text-center py-8">載入中...</p> :
       mails.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">收件箱為空</p> : (
        <div className="space-y-1">
          {mails.map((m: any) => (
            <div key={m.id} onClick={() => setViewId(m.id)}
              className="bg-card border rounded-lg px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">{m.subject || '(無主旨)'}</span>
                <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">{m.created_at}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground truncate">{m.sender}</span>
                {m.attachments?.length > 0 && <span className="text-xs bg-muted px-1 rounded">📎 {m.attachments.length}</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-1 truncate">{m.text?.substring(0, 100)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
