import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  CreditCard, CheckCircle2, AlertTriangle, ArrowUpCircle, RefreshCw,
  HardDrive, FileText, Key, Users, Calendar, Zap,
} from 'lucide-react';

interface SubscriptionData {
  subscription: {
    id: string;
    user_id: string;
    plan_id: string;
    status: string;
    started_at: string;
    plan_key: string;
    name_zh: string;
    name_en: string;
    monthly_price: number;
    skill_allowlist: string[];
    limits: { invoices_per_month: number; storage_gb: number; api_tokens: number; users: number };
    features: string[];
  } | null;
}

interface UsageData {
  usage: {
    invoices_this_month: number;
    invoices_limit: number;
    storage_bytes: number;
    storage_gb_limit: number;
    api_tokens: number;
    api_tokens_limit: number;
    users_limit: number;
  };
  plan_key: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const TIER_BADGE: Record<string, string> = {
  starter: 'bg-amber-100 text-amber-700',
  growth: 'bg-blue-100 text-blue-700',
  business: 'bg-indigo-100 text-indigo-700',
  enterprise: 'bg-purple-100 text-purple-700',
};

export default function SubscriptionPage() {
  const queryClient = useQueryClient();
  const [changingPlan, setChangingPlan] = useState(false);

  const { data: subData, isLoading: subLoading } = useQuery<SubscriptionData>({
    queryKey: ['subscription'],
    queryFn: () => api('/plans/subscription'),
  });

  const { data: usageData, isLoading: usageLoading } = useQuery<UsageData>({
    queryKey: ['subscription-usage'],
    queryFn: () => api('/plans/subscription/usage'),
    refetchInterval: 30000,
  });

  const changePlan = useMutation({
    mutationFn: (plan_key: string) =>
      api('/plans/subscription', { method: 'POST', body: JSON.stringify({ plan_key }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['subscription-usage'] });
      setChangingPlan(false);
    },
  });

  if (subLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const sub = subData?.subscription;
  const usage = usageData?.usage;
  const priceHKD = sub ? sub.monthly_price / 100 : 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" />
          我的訂閱
        </h2>
        <p className="text-muted-foreground mt-1">管理你的 OPCC 方案與用量</p>
      </div>

      {/* Current Plan Card */}
      {sub ? (
        <div className="bg-card border rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`px-3 py-1 rounded-full text-sm font-medium ${TIER_BADGE[sub.plan_key] || 'bg-slate-100'}`}>
                {sub.name_zh}
              </div>
              <span className="text-sm text-muted-foreground">{sub.name_en}</span>
            </div>
            <span className="text-2xl font-bold">HK${priceHKD}<span className="text-sm text-muted-foreground font-normal">/月</span></span>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <Calendar className="h-4 w-4" />
            訂閱開始：{new Date(sub.started_at).toLocaleDateString('zh-HK')}
            {sub.status === 'active' && (
              <span className="flex items-center gap-1 text-green-600 ml-2">
                <CheckCircle2 className="h-4 w-4" />
                生效中
              </span>
            )}
          </div>

          {/* Usage */}
          {usage && !usageLoading && (
            <div className="space-y-3 bg-muted/30 rounded-xl p-4 mb-4">
              <h4 className="text-sm font-semibold">本月用量</h4>
              <UsageBar
                icon={FileText}
                label="發票"
                used={usage.invoices_this_month}
                limit={usage.invoices_limit}
                unit="張"
              />
              <UsageBar
                icon={HardDrive}
                label="儲存空間"
                used={usage.storage_bytes}
                limit={usage.storage_gb_limit * 1024 * 1024 * 1024}
                unit=""
                format={formatBytes}
              />
              <UsageBar
                icon={Key}
                label="API Token"
                used={usage.api_tokens}
                limit={usage.api_tokens_limit}
                unit="個"
              />
            </div>
          )}

          {/* Features */}
          <div className="mb-4">
            <h4 className="text-sm font-semibold mb-2">可用 Skills ({sub.skill_allowlist.length})</h4>
            <div className="flex flex-wrap gap-1.5">
              {sub.skill_allowlist.slice(0, 12).map((s) => (
                <span key={s} className="text-xs bg-muted px-2 py-1 rounded-md font-mono">{s}</span>
              ))}
              {sub.skill_allowlist.length > 12 && (
                <span className="text-xs text-muted-foreground px-2 py-1">
                  +{sub.skill_allowlist.length - 12} more
                </span>
              )}
            </div>
          </div>

          {/* Change plan */}
          <div className="border-t pt-4">
            {!changingPlan ? (
              <button
                onClick={() => setChangingPlan(true)}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ArrowUpCircle className="h-4 w-4" />
                升級或變更方案
              </button>
            ) : (
              <div>
                <p className="text-sm font-medium mb-3">選擇新方案：</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['starter', 'growth', 'business', 'enterprise'] as const).map((key) => (
                    <button
                      key={key}
                      onClick={() => changePlan.mutate(key)}
                      disabled={changePlan.isPending || key === sub.plan_key}
                      className={`p-3 rounded-lg border text-sm text-left transition-colors ${
                        key === sub.plan_key
                          ? 'border-primary bg-primary/5 cursor-not-allowed'
                          : 'hover:border-primary/50 hover:bg-muted/50'
                      }`}
                    >
                      <div className="font-medium capitalize">{key}</div>
                      <div className="text-xs text-muted-foreground">
                        HK${({ starter: 120, growth: 240, business: 399, enterprise: 599 })[key]}/月
                      </div>
                      {key === sub.plan_key && (
                        <span className="text-xs text-primary">目前方案</span>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setChangingPlan(false)}
                  className="text-xs text-muted-foreground hover:underline mt-2"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-card border rounded-2xl p-12 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">你尚未有任何訂閱方案</p>
          <a href="/pricing" className="btn-primary inline-flex items-center gap-2">
            <Zap className="h-4 w-4" />
            查看方案
          </a>
        </div>
      )}

      {/* Available Plans */}
      <div className="text-center">
        <a href="/pricing" className="text-sm text-primary hover:underline flex items-center justify-center gap-1">
          <RefreshCw className="h-3 w-3" />
          查看所有方案比較
        </a>
      </div>
    </div>
  );
}

// ── Usage Bar ──
function UsageBar({
  icon: Icon,
  label,
  used,
  limit,
  unit,
  format,
}: {
  icon: React.ElementType;
  label: string;
  used: number;
  limit: number;
  unit: string;
  format?: (v: number) => string;
}) {
  const isUnlimited = limit <= 0;
  const pct = isUnlimited ? 0 : Math.min(100, (used / limit) * 100);
  const displayUsed = format ? format(used) : used.toString();
  const displayLimit = isUnlimited ? '∞' : format ? format(limit) : `${limit}${unit ? ` ${unit}` : ''}`;

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <span className="text-xs tabular-nums">
          {displayUsed} / {displayLimit}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-green-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
