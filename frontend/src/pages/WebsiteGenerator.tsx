import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Globe, Copy, Check, Download, ChevronDown, ChevronUp, Trash2, Eye, Clock } from 'lucide-react';

export default function WebsiteGenerator() {
  const queryClient = useQueryClient();
  const [webHtml, setWebHtml] = useState('');
  const [webPreview, setWebPreview] = useState(false);
  const [webCopied, setWebCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [promptLoaded, setPromptLoaded] = useState(false);
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);

  // Fetch default prompt once
  useQuery({
    queryKey: ['website-default-prompt'],
    queryFn: async () => {
      const data = await api('/company/website/default-prompt');
      setPromptText(data.prompt);
      setPromptLoaded(true);
      return data;
    },
    enabled: !promptLoaded,
  });

  // Fetch version history
  const { data: versionsData, isLoading: versionsLoading } = useQuery({
    queryKey: ['website-versions'],
    queryFn: async () => {
      const data = await api('/company/website/versions');
      return data as { data: { id: string; version_number: number; company_name: string; prompt: string; created_at: string }[] };
    },
  });

  // Fetch single version HTML
  const { data: versionDetail } = useQuery({
    queryKey: ['website-version', viewVersionId],
    queryFn: async () => {
      const data = await api(`/company/website/versions/${viewVersionId}`);
      return data as { data: { html: string; version_number: number; company_name: string } };
    },
    enabled: !!viewVersionId,
  });

  // Show version in preview
  React.useEffect(() => {
    if (versionDetail?.data?.html) {
      setWebHtml(versionDetail.data.html);
      setWebPreview(true);
    }
  }, [versionDetail]);

  const genWebsite = useMutation({
    mutationFn: () => api('/company/website', {
      method: 'POST',
      body: JSON.stringify({ customPrompt: promptText }),
      headers: { 'Content-Type': 'application/json' },
    }),
    onSuccess: (data: any) => {
      setWebHtml(data.html);
      setWebPreview(true);
      queryClient.invalidateQueries({ queryKey: ['website-versions'] });
    },
  });

  const deleteVersion = useMutation({
    mutationFn: (id: string) => api(`/company/website/versions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['website-versions'] });
      if (viewVersionId) setViewVersionId(null);
    },
  });

  const versions = versionsData?.data || [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">公司網站生成器</h2>
        <p className="text-muted-foreground mt-1">用 AI 根據公司資料自動生成一頁式公司網站，每次生成自動存檔</p>
      </div>

      <div className="bg-card border rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
            <Globe className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h3 className="font-semibold">DeepSeek AI 生成</h3>
            <p className="text-sm text-muted-foreground">讀取你在「設定」中填寫的公司資料，自動生成包含 Hero、服務、聯絡表單的完整網站</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            { label: '語言', value: '繁體中文' },
            { label: '設計', value: '現代簡約風格' },
            { label: '響應式', value: '手機/平板/桌面' },
            { label: '輸出', value: 'HTML 單檔案' },
            { label: '圖標', value: 'Font Awesome CDN' },
            { label: '區塊', value: 'Hero + 關於 + 服務 + 聯絡 + Footer' },
          ].map((f) => (
            <div key={f.label} className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
              <span className="text-xs text-muted-foreground">{f.label}</span>
              <span className="text-xs font-medium ml-auto">{f.value}</span>
            </div>
          ))}
        </div>

        {/* Prompt editor toggle */}
        <button
          onClick={() => setShowPrompt(!showPrompt)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full"
        >
          {showPrompt ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {showPrompt ? '隱藏 Prompt 編輯器' : '自訂 Prompt（點擊展開）'}
        </button>

        {showPrompt && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              公司資料會自動填入 {`{name}, {tagline}, {address}, {phone}, {email}, {website}, {bank}`} 佔位符
            </p>
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={12}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Loading default prompt..."
            />
          </div>
        )}

        <button onClick={() => genWebsite.mutate()} disabled={genWebsite.isPending}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 w-full justify-center">
          <Globe className="h-4 w-4" /> {genWebsite.isPending ? 'AI 生成中，請稍候...' : '生成公司網站'}
        </button>

        {genWebsite.isError && (
          <p className="text-sm text-destructive">生成失敗，請檢查公司資料是否已填寫。</p>
        )}
      </div>

      {/* Preview */}
      {webPreview && (
        <div className="bg-card border rounded-xl overflow-hidden flex flex-col" style={{ height: '75vh' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <h3 className="font-bold text-sm">網站預覽</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => { navigator.clipboard.writeText(webHtml); setWebCopied(true); setTimeout(() => setWebCopied(false), 2000); }}
                className="flex items-center gap-1 text-xs bg-card px-3 py-1.5 rounded border hover:bg-accent">
                {webCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {webCopied ? '已複製' : '複製 HTML'}
              </button>
              <a href={`data:text/html;charset=utf-8,${encodeURIComponent(webHtml)}`} download="index.html"
                className="flex items-center gap-1 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90">
                <Download className="h-3 w-3" /> 下載 HTML
              </a>
            </div>
          </div>
          <iframe srcDoc={webHtml} className="flex-1 w-full border-0" title="Website Preview" />
        </div>
      )}

      {/* Version History */}
      <div className="bg-card border rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold">版本歷史</h3>
          <span className="text-xs text-muted-foreground">({versions.length} 個版本)</span>
        </div>

        {versionsLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">載入中...</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">尚未生成任何版本</p>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id}
                className={`flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors ${viewVersionId === v.id ? 'border-primary bg-primary/5' : ''}`}
                onClick={() => setViewVersionId(v.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold bg-muted px-2 py-1 rounded">v{v.version_number}</span>
                  <div>
                    <p className="text-sm font-medium">{v.company_name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteVersion.mutate(v.id); }}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
