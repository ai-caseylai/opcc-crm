import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { MessageCircle, X, Send, Minimize2, Maximize2, Paperclip, Plus, Trash2, History } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export default function Chatbot() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; data: string; type: string } | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadSessions = async () => {
    try {
      const data = await api('/chat/sessions');
      setSessions(data.data || []);
    } catch {}
  };

  const loadSession = async (id: string) => {
    try {
      const data = await api(`/chat/sessions/${id}`);
      setSessionId(id);
      setMessages((data.messages || []).map((m: any) => ({ role: m.role, content: m.content })));
      setShowHistory(false);
    } catch {}
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api(`/chat/sessions/${id}`, { method: 'DELETE' });
      if (sessionId === id) {
        setSessionId('');
        setMessages([]);
      }
      loadSessions();
    } catch {}
  };

  const newChat = () => {
    setSessionId('');
    setMessages([]);
    setShowHistory(false);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setMessages(prev => [...prev, { role: 'assistant', content: '檔案太大，請上傳小於 5MB 的檔案。' }]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setAttachedFile({ name: file.name, data: base64, type: file.type });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !attachedFile) || busy) return;

    let content = text || `請分析附件檔案: ${attachedFile?.name}`;
    const userMsg: Message = { role: 'user', content: attachedFile ? `[附件: ${attachedFile.name}]\n${content}` : content };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const file = attachedFile;
    setAttachedFile(null);
    setBusy(true);

    try {
      const body: any = { message: content, history: messages, session_id: sessionId || undefined };
      if (file) body.file = { name: file.name, data: file.data, type: file.type };
      const data = await api('/chat', { method: 'POST', body });
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      if (data.session_id && !sessionId) {
        setSessionId(data.session_id);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  if (!open) {
    return (
      <button onClick={() => { setOpen(true); loadSessions(); }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:opacity-90 transition-all">
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className={`fixed right-6 z-50 bg-card border rounded-xl shadow-2xl transition-all duration-200 flex flex-col ${
      minimized ? 'bottom-6 w-72 h-12' : 'bottom-6 w-[420px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-6rem)]'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground rounded-t-xl flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          <span className="font-medium text-sm">AI 助理 (DeepSeek)</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { loadSessions(); setShowHistory(!showHistory); }}
            className="p-1 rounded hover:bg-primary-foreground/20" title="歷史記錄">
            <History className="h-4 w-4" />
          </button>
          <button onClick={newChat}
            className="p-1 rounded hover:bg-primary-foreground/20" title="新對話">
            <Plus className="h-4 w-4" />
          </button>
          <button onClick={() => setMinimized(!minimized)}
            className="p-1 rounded hover:bg-primary-foreground/20">
            {minimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </button>
          <button onClick={() => { setOpen(false); setMinimized(false); }}
            className="p-1 rounded hover:bg-primary-foreground/20">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {showHistory ? (
            /* Session history sidebar */
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">歷史對話</span>
                <button onClick={newChat} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <Plus className="h-3 w-3" /> 新對話
                </button>
              </div>
              {sessions.length === 0 && (
                <p className="text-xs text-muted-foreground text-center mt-4">尚無歷史記錄</p>
              )}
              {sessions.map(s => (
                <div key={s.id} onClick={() => loadSession(s.id)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer hover:bg-muted text-sm ${
                    sessionId === s.id ? 'bg-muted font-medium' : ''
                  }`}>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{s.title || '未命名對話'}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.updated_at || s.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button onClick={(e) => deleteSession(s.id, e)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive ml-2 flex-shrink-0">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground mt-8">
                    <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>你好！我是 AI 助理</p>
                    <p className="text-xs mt-1">Powered by DeepSeek · 可以上傳 Excel/CSV 檔案分析</p>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-sm whitespace-pre-wrap'
                        : 'bg-muted text-foreground rounded-bl-sm'
                    }`}>
                      {m.role === 'assistant' ? (
                        <div className="prose prose-sm max-w-none dark:prose-invert [&_table]:text-xs [&_table]:w-full [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_table]:border-collapse [&_th]:border [&_td]:border [&_th]:bg-muted/50 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        </div>
                      ) : m.content}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="flex justify-start">
                    <div className="bg-muted px-3 py-2 rounded-lg rounded-bl-sm text-sm text-muted-foreground">
                      <span className="animate-pulse">...</span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              {attachedFile && (
                <div className="px-3 pt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Paperclip className="h-3 w-3" />
                  <span className="truncate flex-1">{attachedFile.name}</span>
                  <button onClick={() => setAttachedFile(null)} className="text-destructive hover:underline">移除</button>
                </div>
              )}
              <div className="border-t p-3 flex gap-2 flex-shrink-0">
                <input type="file" ref={fileInputRef} onChange={handleFile}
                  accept=".pdf,.xlsx,.xls,.csv,.txt,.png,.jpg" className="hidden" />
                <button onClick={() => fileInputRef.current?.click()} disabled={busy}
                  className="p-2 border rounded-md hover:bg-muted disabled:opacity-40" title="上傳檔案 (PDF, Excel, CSV)">
                  <Paperclip className="h-4 w-4" />
                </button>
                <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder="問任何問題... (Cmd+Enter 發送)" disabled={busy} rows={1}
                  className="flex-1 px-3 py-2 border rounded-md bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
                <button onClick={send} disabled={busy || (!input.trim() && !attachedFile)}
                  className="p-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-40">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
