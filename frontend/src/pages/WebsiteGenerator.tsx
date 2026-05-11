import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Globe, Copy, Check, Download } from 'lucide-react';

export default function WebsiteGenerator() {
  const [webHtml, setWebHtml] = useState('');
  const [webPreview, setWebPreview] = useState(false);
  const [webCopied, setWebCopied] = useState(false);

  const genWebsite = useMutation({
    mutationFn: () => api('/company/website', { method: 'POST' }),
    onSuccess: (data: any) => { setWebHtml(data.html); setWebPreview(true); },
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">公司網站生成器</h2>
        <p className="text-muted-foreground mt-1">用 AI 根據公司資料自動生成一頁式公司網站</p>
      </div>

      <div className="bg-card border rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
            <Globe className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h3 className="font-semibold">Llama 3.1 AI 生成</h3>
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

        <button onClick={() => genWebsite.mutate()} disabled={genWebsite.isPending}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 w-full justify-center">
          <Globe className="h-4 w-4" /> {genWebsite.isPending ? 'AI 生成中，請稍候...' : '生成公司網站'}
        </button>

        {genWebsite.isError && (
          <p className="text-sm text-destructive">生成失敗，請檢查公司資料是否已填寫。</p>
        )}
      </div>

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
    </div>
  );
}
