import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { MessageCircle, Send, Phone, Bot, Plus, Search, User, Hash } from 'lucide-react';

export default function Messages() {
  const queryClient = useQueryClient();
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [channelFilter, setChannelFilter] = useState('');

  const { data: conversations } = useQuery({
    queryKey: ['conversations', channelFilter],
    queryFn: () => api(`/messaging/conversations?channel=${channelFilter}`),
    refetchInterval: 10000,
  });

  const { data: convDetail } = useQuery({
    queryKey: ['conversation', selectedConv],
    queryFn: () => api(`/messaging/conversations/${selectedConv}`),
    enabled: !!selectedConv,
  });

  const sendMut = useMutation({
    mutationFn: (body: { conversation_id: string; content: string }) =>
      api('/messaging/send', { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', selectedConv] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setReplyText('');
    },
  });

  const handleSend = () => {
    if (!replyText.trim() || !selectedConv) return;
    sendMut.mutate({ conversation_id: selectedConv, content: replyText });
  };

  const convs = conversations?.data || [];
  const messages = convDetail?.messages || [];
  const totalUnread = convs.reduce((s: number, c: any) => s + (c.unread_count || 0), 0);

  const channelIcon = (type: string) => {
    if (type === 'telegram') return <Bot className="h-3 w-3 text-blue-500" />;
    if (type === 'whatsapp') return <Phone className="h-3 w-3 text-green-500" />;
    return <Hash className="h-3 w-3" />;
  };

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">訊息 Messages</h2>
          <p className="text-muted-foreground mt-1">
            {totalUnread > 0 ? `${totalUnread} 則未讀訊息` : 'OpenClaw 通訊中心'}
          </p>
        </div>
        <div className="flex gap-2">
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}
            className="px-3 py-1.5 border rounded-md bg-background text-xs">
            <option value="">全部頻道</option>
            <option value="telegram">Telegram</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </div>
      </div>

      <div className="flex gap-4 h-full">
        {/* Conversation list */}
        <div className="w-80 bg-card border rounded-xl overflow-hidden flex flex-col shrink-0">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
              <input placeholder="搜尋對話..." className="w-full pl-7 pr-3 py-1.5 text-xs border rounded-md bg-background" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {convs.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">未有對話</div>
            ) : convs.map((c: any) => (
              <button key={c.id} onClick={() => setSelectedConv(c.id)}
                className={`w-full text-left p-3 border-b hover:bg-muted/50 transition-colors ${selectedConv === c.id ? 'bg-muted' : ''}`}>
                <div className="flex items-center gap-2">
                  {channelIcon(c.channel_type)}
                  <span className="font-medium text-sm truncate">{c.contact_name || c.contact_phone || c.external_id}</span>
                  {c.unread_count > 0 && (
                    <span className="ml-auto bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">{c.unread_count}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.last_message_preview || c.subject}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 bg-card border rounded-xl overflow-hidden flex flex-col">
          {!selectedConv ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>選擇對話開始</p>
              </div>
            </div>
          ) : (
            <>
              <div className="p-3 border-b flex items-center gap-2">
                {channelIcon(convDetail?.channel_type)}
                <span className="font-medium text-sm">{convDetail?.contact_name || convDetail?.contact_phone || convDetail?.external_id}</span>
                <span className="text-xs text-muted-foreground ml-auto">{convDetail?.channel_type}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((m: any) => (
                  <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${
                      m.direction === 'outbound'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}>
                      <div>{m.content}</div>
                      <div className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {m.status && ` · ${m.status}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t flex gap-2">
                <input value={replyText} onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                  placeholder="輸入訊息..." className="flex-1 px-3 py-2 border rounded-md bg-background text-sm" />
                <button onClick={handleSend} disabled={sendMut.isPending || !replyText.trim()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90 disabled:opacity-50">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
