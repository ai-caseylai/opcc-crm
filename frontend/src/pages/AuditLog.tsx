/**
 * AuditLog.tsx
 * Shows all accounting-sensitive actions for Supervisor/Accountant.
 * Staff cannot access this page.
 * Route: /audit-log
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface AuditEntry {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: string | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  login:               { label: 'Login',                color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' },
  failed_login:        { label: 'Failed Login',         color: 'text-red-600 bg-red-50 dark:bg-red-900/30' },
  upload:              { label: 'Upload',               color: 'text-green-600 bg-green-50 dark:bg-green-900/30' },
  delete:              { label: 'Delete',               color: 'text-red-600 bg-red-50 dark:bg-red-900/30' },
  soft_delete:         { label: 'Moved to Bin',         color: 'text-orange-600 bg-orange-50 dark:bg-orange-900/30' },
  import:              { label: 'Import',               color: 'text-purple-600 bg-purple-50 dark:bg-purple-900/30' },
  update:              { label: 'Edit',                 color: 'text-yellow-700 bg-yellow-50 dark:bg-yellow-900/30' },
  confirm_match:       { label: 'Confirm Match',        color: 'text-teal-600 bg-teal-50 dark:bg-teal-900/30' },
  unlink_match:        { label: 'Unlink Match',         color: 'text-gray-600 bg-gray-100 dark:bg-gray-800' },
  supervisor_override: { label: 'Supervisor Approval',  color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30' },
  create_user:         { label: 'Create User',          color: 'text-green-700 bg-green-50 dark:bg-green-900/30' },
  role_change:         { label: 'Role Change',          color: 'text-purple-700 bg-purple-50 dark:bg-purple-900/30' },
  auto_categorize:     { label: 'Auto-Categorize',      color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' },
};

export default function AuditLog() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [filterAction, setFilterAction] = useState('');
  const limit = 50;

  // Block staff
  if (user && ['staff', 'viewer'].includes(user.role)) {
    navigate('/');
    return null;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', page, filterAction],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String((page - 1) * limit) });
      if (filterAction) params.set('action', filterAction);
      return api(`/audit?${params}`);
    },
  });

  const entries: AuditEntry[] = (data as any)?.entries || [];
  const total: number = (data as any)?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const exportCSV = () => {
    const headers = ['Date/Time', 'User', 'Email', 'Action', 'Entity Type', 'Entity ID', 'Details'];
    const rows = entries.map(e => [
      e.created_at,
      e.user_name,
      e.user_email,
      e.action,
      e.entity_type,
      e.entity_id || '',
      e.changes ? JSON.stringify(JSON.parse(e.changes)) : '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Audit Log</h2>
          <p className="text-sm text-muted-foreground mt-1">
            All accounting-sensitive actions. Retained for 7 years per HK tax regulations.
          </p>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 border border-border px-4 py-2 rounded-md text-sm hover:bg-muted"
        >
          ↓ Export CSV
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={filterAction}
          onChange={e => { setFilterAction(e.target.value); setPage(1); }}
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-background"
        >
          <option value="">All Actions</option>
          {Object.entries(ACTION_LABELS).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground self-center">
          {total.toLocaleString()} total entries
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading audit log...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <div className="text-3xl mb-2">📋</div>
          <p className="text-muted-foreground text-sm">No audit entries yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Actions will appear here as users interact with the system.</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">Date / Time</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">User</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Action</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const actionInfo = ACTION_LABELS[e.action] || { label: e.action, color: 'text-gray-600 bg-gray-100' };
                  let details = '';
                  try {
                    if (e.changes) {
                      const parsed = JSON.parse(e.changes);
                      if (parsed.filename) details = parsed.filename;
                      else if (parsed.email) details = parsed.email;
                      else if (parsed.name) details = parsed.name;
                      else details = Object.entries(parsed).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(', ');
                    }
                  } catch { details = e.changes || ''; }

                  return (
                    <tr key={e.id} className={`border-t border-border ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap font-mono text-xs">
                        {new Date(e.created_at).toLocaleString('en-HK', { hour12: false })}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-xs">{e.user_name}</div>
                        <div className="text-muted-foreground text-xs">{e.user_email}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionInfo.color}`}>
                          {actionInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">
                        {e.entity_type.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">
                        {details}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 border border-border rounded text-sm disabled:opacity-40 hover:bg-muted"
          >
            ← Previous
          </button>
          <span className="px-3 py-1 text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 border border-border rounded text-sm disabled:opacity-40 hover:bg-muted"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
