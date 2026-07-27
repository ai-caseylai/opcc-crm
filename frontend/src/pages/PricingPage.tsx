import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import {
  Check, Zap, Rocket, Building2, Crown, Cloud, Mail, Shield, ArrowRight,
} from 'lucide-react';

interface Plan {
  id: string;
  plan_key: 'starter' | 'growth' | 'business' | 'enterprise';
  name_zh: string;
  name_en: string;
  monthly_price: number;
  skill_allowlist: string[];
  limits: { invoices_per_month: number; storage_gb: number; api_tokens: number; users: number };
  features: string[];
}

const PLAN_ICONS: Record<string, React.ElementType> = {
  starter: Zap,
  growth: Rocket,
  business: Building2,
  enterprise: Crown,
};

const PLAN_COLORS: Record<string, string> = {
  starter: 'border-slate-200 hover:border-amber-300',
  growth: 'border-slate-200 hover:border-blue-300',
  business: 'border-slate-200 hover:border-indigo-400',
  enterprise: 'border-slate-200 hover:border-purple-400',
};

const PLAN_BADGES: Record<string, { bg: string; text: string }> = {
  starter: { bg: 'bg-amber-50', text: 'text-amber-700' },
  growth: { bg: 'bg-blue-50', text: 'text-blue-700' },
  business: { bg: 'bg-indigo-50', text: 'text-indigo-700' },
  enterprise: { bg: 'bg-purple-50', text: 'text-purple-700' },
};

export default function PricingPage() {
  const { data, isLoading } = useQuery<{ plans: Plan[] }>({
    queryKey: ['plans'],
    queryFn: () => api('/plans'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const plans = data?.plans || [];
  const tierOrder = ['starter', 'growth', 'business', 'enterprise'];

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Header */}
      <div className="text-center space-y-3">
        <h2 className="text-3xl font-bold">OPCC 定價方案</h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          一人公司專屬 API 技能平台，對應 Xero 核心功能，按月訂閱、隨時升級。<br />
          所有方案均包含 Cloudflare 全球 CDN 加速與 Email Dash 基礎支援。
        </p>

        {/* Cloudflare badge */}
        <div className="inline-flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-full px-4 py-1.5 text-sm text-orange-700">
          <Cloud className="h-4 w-4" />
          Powered by Cloudflare Email Dash
        </div>
      </div>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {tierOrder.map((key) => {
          const plan = plans.find((p) => p.plan_key === key);
          if (!plan) return null;

          const Icon = PLAN_ICONS[key] || Zap;
          const badge = PLAN_BADGES[key] || { bg: 'bg-slate-50', text: 'text-slate-700' };
          const priceHKD = plan.monthly_price / 100;
          const isEnterprise = key === 'enterprise';

          return (
            <div
              key={plan.id}
              className={`relative bg-card border-2 rounded-2xl p-6 flex flex-col transition-all duration-200 ${PLAN_COLORS[key]} ${isEnterprise ? 'lg:scale-105 lg:shadow-lg' : ''}`}
            >
              {isEnterprise && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                  前海企業首選
                </div>
              )}

              {/* Icon + Name */}
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-lg ${badge.bg}`}>
                  <Icon className={`h-5 w-5 ${badge.text}`} />
                </div>
                <div>
                  <h3 className="font-bold text-sm">{plan.name_zh}</h3>
                  <p className="text-xs text-muted-foreground">{plan.name_en}</p>
                </div>
              </div>

              {/* Price */}
              <div className="mb-4">
                <span className="text-3xl font-bold">HK${priceHKD}</span>
                <span className="text-muted-foreground text-sm">/月</span>
              </div>

              {/* Cloudflare tier */}
              <div className="text-xs text-muted-foreground mb-4 flex items-center gap-1">
                <Mail className="h-3 w-3" />
                {key === 'starter' && 'Email Dash 基本路由'}
                {key === 'growth' && 'Email Dash + Email Worker'}
                {key === 'business' && 'Email Dash + Routing + R2'}
                {key === 'enterprise' && 'Email Dash 全功能 + 優先支援'}
              </div>

              {/* Skills count */}
              <div className="bg-muted/50 rounded-lg p-3 mb-4">
                <div className="text-2xl font-bold text-center">{plan.skill_allowlist.length}</div>
                <div className="text-xs text-muted-foreground text-center">API Skills</div>
              </div>

              {/* Limits */}
              <div className="text-xs text-muted-foreground space-y-1 mb-4">
                {plan.limits.invoices_per_month > 0 ? (
                  <div className="flex justify-between">
                    <span>發票/月</span>
                    <span className="font-medium text-foreground">{plan.limits.invoices_per_month}</span>
                  </div>
                ) : (
                  <div className="flex justify-between">
                    <span>發票</span>
                    <span className="font-medium text-foreground">無限</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>儲存空間</span>
                  <span className="font-medium text-foreground">{plan.limits.storage_gb}GB</span>
                </div>
                <div className="flex justify-between">
                  <span>API Token</span>
                  <span className="font-medium text-foreground">
                    {plan.limits.api_tokens <= 0 ? '無限' : plan.limits.api_tokens}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>用戶</span>
                  <span className="font-medium text-foreground">{plan.limits.users}</span>
                </div>
              </div>

              {/* Features */}
              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.slice(0, 5).map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
                {plan.features.length > 5 && (
                  <li className="text-xs text-muted-foreground pl-6">
                    +{plan.features.length - 5} 更多功能...
                  </li>
                )}
              </ul>

              {/* CTA */}
              <Link
                to="/subscription"
                className={`w-full py-2.5 rounded-lg text-sm font-medium text-center flex items-center justify-center gap-2 transition-colors ${
                  isEnterprise
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                {key === 'starter' ? '免費開始' : '選擇方案'}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          );
        })}
      </div>

      {/* Bottom note */}
      <div className="text-center text-sm text-muted-foreground space-y-1">
        <div className="flex items-center justify-center gap-2">
          <Shield className="h-4 w-4" />
          所有方案包含香港 OPC 合規儀表板基礎存取
        </div>
        <p>
          月費以港幣結算 · 可隨時升級或降級 · 14 天退款保證
        </p>
      </div>
    </div>
  );
}
