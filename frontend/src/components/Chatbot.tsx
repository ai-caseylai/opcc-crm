import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { MessageCircle, X, Send, Minimize2, Maximize2, Paperclip } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      const body: any = { message: content, history: messages };
      if (file) body.file = { name: file.name, data: file.data, type: file.type };
      const data = await api('/chat', { method: 'POST', body });
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:opacity-90 transition-all">
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className={`fixed right-6 z-50 bg-card border rounded-xl shadow-2xl transition-all duration-200 flex flex-col ${
      minimized ? 'bottom-6 w-72 h-12' : 'bottom-6 w-[380px] max-w-[calc(100vw-3rem)] h-[560px] max-h-[calc(100vh-6rem)]'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground rounded-t-xl flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          <span className="font-medium text-sm">AI 助理 (DeepSeek)</span>
        </div>
        <div className="flex items-center gap-1">
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
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-sm text-muted-foreground mt-8">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>你好！我是 AI 助理 👋</p>
                <p className="text-xs mt-1">Powered by DeepSeek · 可以上傳 Excel/CSV 檔案分析</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-muted text-foreground rounded-bl-sm'
                }`}>
                  {m.content}
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
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="問任何問題..." disabled={busy}
              className="flex-1 px-3 py-2 border rounded-md bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            <button onClick={send} disabled={busy || (!input.trim() && !attachedFile)}
              className="p-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
