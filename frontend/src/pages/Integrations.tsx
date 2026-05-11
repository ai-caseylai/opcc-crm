import React from 'react';
import { Link, Brain, Mail } from 'lucide-react';
import MailConfig from '../components/MailConfig';

function LlmConfig() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Cloudflare Workers AI 已預設啟用（Llama 3.1 8B + Function Calling）。</p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {[
          { label: '聊天模型', value: '@cf/meta/llama-3.1-8b-instruct' },
          { label: '視覺/OCR', value: '@cf/unum/uform-gen2-qwen-500m' },
          { label: 'Function Calling', value: '✅ 支援' },
          { label: '狀態', value: '✅ 已連接' },
        ].map(f => (
          <div key={f.label} className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
            <span className="text-xs text-muted-foreground">{f.label}</span>
            <span className="text-xs font-medium ml-auto truncate">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, desc, children }: { icon: any; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b">
        <Icon className="h-5 w-5 text-primary" />
        <div><h3 className="font-semibold">{title}</h3><p className="text-xs text-muted-foreground">{desc}</p></div>
      </div>
      {children}
    </div>
  );
}

export default function Integrations() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">整合 Integrations</h2>
        <p className="text-muted-foreground mt-1">LLM · 郵箱 · WorkBuddy 連線設定</p>
      </div>

      <Section icon={Brain} title="LLM API 設定" desc="Cloudflare Workers AI · Llama 3.1 · Function Calling">
        <LlmConfig />
      </Section>

      <Section icon={Mail} title="郵箱設定" desc="Cloudflare Temp Email 企業郵箱">
        <MailConfig />
      </Section>

      <Section icon={Link} title="WorkBuddy 連線資訊" desc="Manifest URL 與技能清單">
        <code className="block bg-muted px-4 py-2 rounded text-sm break-all">
          https://opcc-crm.techforliving.net/api/workbuddy/manifest
        </code>
        <p className="text-xs text-muted-foreground">43 個技能，支援 JWT / API Key / X-API-Key 三種認證</p>
      </Section>
    </div>
  );
}
