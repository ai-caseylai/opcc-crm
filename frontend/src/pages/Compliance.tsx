import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  Shield, CheckCircle2, AlertTriangle, XCircle, MinusCircle,
  Clock, Bell, ExternalLink, ChevronDown, ChevronUp, RefreshCw,
  Building2, Receipt, Users, ShieldAlert, Briefcase, Sparkles
} from 'lucide-react';

// ── Types ──
interface ComplianceItem {
  id: string;
  category: string;
  industry: string;
  title_zh: string;
  title_en?: string;
  description_zh?: string;
  is_required: boolean;
  has_deadline: boolean;
  deadline_field?: string;
  action_url?: string;
  action_label_zh?: string;
  sort_order: number;
  member_status: 'compliant' | 'pending' | 'overdue' | 'not_applicable';
  notes?: string;
  completed_at?: string;
}

interface Reminder {
  id: string;
  date_type: string;
  date_value: string;
  reminder_days: string;
}

interface ComplianceData {
  stats: { compliant: number; pending: number; overdue: number; not_applicable: number; total: number };
  categories: Record<string, ComplianceItem[]>;
  checklist: ComplianceItem[];
  company_info?: { br_number?: string; br_expiry_date?: string; ci_number?: string; industry?: string; employee_count?: number; fiscal_year_end?: string; secretary_name?: string; auditor_name?: string };
  upcoming_reminders: Reminder[];
}

// ── Helpers ──
const CATEGORY_NAMES: Record<string, { zh: string; icon: React.ElementType; color: string }> = {
  company: { zh: '公司基本', icon: Building2, color: 'text-blue-600' },
  tax: { zh: '稅務', icon: Receipt, color: 'text-orange-600' },
  employment: { zh: '僱傭相關', icon: Users, color: 'text-purple-600' },
  privacy: { zh: '資料私隱', icon: ShieldAlert, color: 'text-teal-600' },
  industry: { zh: '行業特定', icon: Briefcase, color: 'text-indigo-600' },
};

const DATE_TYPE_NAMES: Record<string, string> = {
  br_expiry: '商業登記證到期',
  annual_return: '周年申報表',
  tax_filing_deadline: '利得稅報稅死線',
  audit_deadline: '審計死線',
  mpf_due: 'MPF 供款',
  insurance_expiry: '勞工保險到期',
  custom: '自訂',
};

function daysLeft(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function statusBadge(status: string) {
  switch (status) {
    case 'compliant': return { icon: CheckCircle2, label: '合規', cls: 'bg-green-100 text-green-700' };
    case 'overdue': return { icon: XCircle, label: '逾期', cls: 'bg-red-100 text-red-700' };
    case 'not_applicable': return { icon: MinusCircle, label: '不適用', cls: 'bg-gray-100 text-gray-500' };
    default: return { icon: AlertTriangle, label: '待處理', cls: 'bg-amber-100 text-amber-700' };
  }
}

// ── Main Page ──
export default function Compliance() {
  const queryClient = useQueryClient();
  const [expandedCategory, setExpandedCategory] = useState<string | null>('company');

  const { data, isLoading, isError } = useQuery<ComplianceData>({
    queryKey: ['compliance'],
    queryFn: () => api('/compliance'),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/compliance/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['compliance'] }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-16">
        <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">無法載入合規資料，請稍後再試</p>
      </div>
    );
  }

  const { stats, categories, upcoming_reminders, company_info } = data!;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            合規儀表板
          </h2>
          <p className="text-muted-foreground mt-1">
            {company_info?.industry ? `行業：${company_info.industry}` : '追蹤你的合規狀態，確保唔會錯過任何死線'}
          </p>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['compliance'] })}
          className="btn-outline flex items-center gap-2 text-sm"
        >
          <RefreshCw className="h-4 w-4" />
          更新
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="合規" value={stats.compliant} color="text-green-600" bg="bg-green-50" icon={CheckCircle2} />
        <StatCard label="待處理" value={stats.pending} color="text-amber-600" bg="bg-amber-50" icon={AlertTriangle} />
        <StatCard label="逾期" value={stats.overdue} color="text-red-600" bg="bg-red-50" icon={XCircle} />
        <StatCard label="不適用" value={stats.not_applicable} color="text-gray-500" bg="bg-gray-50" icon={MinusCircle} />
      </div>

      {/* Upcoming Deadlines */}
      {upcoming_reminders.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="font-semibold text-red-800 flex items-center gap-2 mb-3">
            <Bell className="h-4 w-4" />
            即將到期提醒
          </h3>
          <div className="space-y-2">
            {upcoming_reminders.map((r) => {
              const d = daysLeft(r.date_value);
              return (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-red-500" />
                    <span className="font-medium">{DATE_TYPE_NAMES[r.date_type] || r.date_type}</span>
                    <span className="text-muted-foreground">{r.date_value}</span>
                  </div>
                  <span className={`font-bold ${d <= 30 ? 'text-red-600' : d <= 60 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                    {d} 天
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Checklist by Category */}
      <div className="space-y-3">
        {Object.entries(categories).map(([catKey, items]) => {
          const cat = CATEGORY_NAMES[catKey] || { zh: catKey, icon: Briefcase, color: 'text-gray-600' };
          const CatIcon = cat.icon;
          const isExpanded = expandedCategory === catKey;
          const doneCount = items.filter((i: ComplianceItem) => i.member_status === 'compliant').length;
          return (
            <div key={catKey} className="bg-card border rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedCategory(isExpanded ? null : catKey)}
                className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <CatIcon className={`h-5 w-5 ${cat.color}`} />
                  <div className="text-left">
                    <h3 className="font-semibold">{cat.zh}</h3>
                    <p className="text-xs text-muted-foreground">{doneCount}/{items.length} 已完成</p>
                  </div>
                </div>
                {isExpanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
              </button>

              {isExpanded && (
                <div className="border-t divide-y">
                  {items.map((item) => (
                    <ComplianceRow
                      key={item.id}
                      item={item}
                      onStatusChange={(status) => updateStatus.mutate({ id: item.id, status })}
                      loading={updateStatus.isPending}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* BR / CI Info */}
      {company_info && (
        <div className="bg-muted/30 rounded-xl p-4 text-sm">
          <h4 className="font-semibold mb-2">公司基本資料</h4>
          <div className="grid grid-cols-2 gap-2 text-muted-foreground">
            {company_info.br_number && <div>BR No.: <span className="text-foreground font-medium">{company_info.br_number}</span></div>}
            {company_info.br_expiry_date && <div>BR 到期：<span className="text-foreground">{company_info.br_expiry_date}</span></div>}
            {company_info.ci_number && <div>CI No.: <span className="text-foreground font-medium">{company_info.ci_number}</span></div>}
            {company_info.secretary_name && <div>公司秘書：<span className="text-foreground">{company_info.secretary_name}</span></div>}
            {company_info.auditor_name && <div>審計師：<span className="text-foreground">{company_info.auditor_name}</span></div>}
            <div>年結日：<span className="text-foreground">{company_info.fiscal_year_end || '03-31'}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stat Card ──
function StatCard({ label, value, color, bg, icon: Icon }: { label: string; value: number; color: string; bg: string; icon: React.ElementType }) {
  return (
    <div className={`${bg} rounded-xl p-3 text-center`}>
      <Icon className={`h-5 w-5 mx-auto mb-1 ${color}`} />
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ── Compliance Row ──
function ComplianceRow({ item, onStatusChange, loading }: { item: ComplianceItem; onStatusChange: (s: string) => void; loading: boolean }) {
  const badge = statusBadge(item.member_status);
  const BadgeIcon = badge.icon;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="p-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            onClick={() => onStatusChange(item.member_status === 'compliant' ? 'pending' : 'compliant')}
            disabled={loading}
            className={`flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
              item.member_status === 'compliant'
                ? 'bg-green-500 border-green-500 text-white'
                : 'border-gray-300 hover:border-green-400'
            }`}
          >
            {item.member_status === 'compliant' && <CheckCircle2 className="h-3.5 w-3.5" />}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`font-medium text-sm ${item.member_status === 'compliant' ? 'line-through text-muted-foreground' : ''}`}>
                {item.title_zh}
              </span>
              {item.is_required && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">必須</span>}
            </div>
            {item.description_zh && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.description_zh}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>
            <BadgeIcon className="h-3 w-3" />
            {badge.label}
          </span>
          {item.action_url && (
            <a href={item.action_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {(item.description_zh || item.notes) && (
            <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-2 ml-8 text-xs text-muted-foreground space-y-1 bg-muted/50 p-3 rounded-lg">
          {item.description_zh && <p>{item.description_zh}</p>}
          {item.notes && <p className="text-foreground">備註：{item.notes}</p>}
          {item.action_label_zh && item.action_url && (
            <a href={item.action_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
              {item.action_label_zh} <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <div className="flex gap-2 pt-1">
            {(['compliant', 'pending', 'not_applicable'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onStatusChange(s)}
                disabled={loading || item.member_status === s}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  item.member_status === s
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'hover:bg-muted'
                }`}
              >
                {s === 'compliant' ? '✓ 合規' : s === 'pending' ? '⚠ 待處理' : '− 不適用'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
