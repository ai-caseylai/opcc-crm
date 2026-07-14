/**
 * AdminApplications.tsx
 * Admin-only page to view and approve/reject company applications.
 * Route: /admin/applications
 * Only visible to users with role === 'admin'
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface Application {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  message: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

interface ApproveResult {
  success: boolean;
  email: string;
  temp_password: string;
  message: string;
}

export default function AdminApplications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [approvedCreds, setApprovedCreds] = useState<{ email: string; temp_password: string; company: string } | null>(null);

  // Redirect non-admins
  if (user && user.role !== 'admin') {
    navigate('/');
    return null;
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-applications', filter],
    queryFn: () => api(`/admin/applications${filter !== 'all' ? `?status=${filter}` : ''}`),
    refetchInterval: 30000,
  });

  const applications: Application[] = (data as any)?.data || [];

  const approveMut = useMutation({
    mutationFn: (appId: string) => api(`/admin/applications/${appId}/approve`, { method: 'POST' }),
    onSuccess: (res: any, appId) => {
      queryClient.invalidateQueries({ queryKey: ['admin-applications'] });
      const app = applications.find(a => a.id === appId);
      setApprovedCreds({
        email: res.email,
        temp_password: res.temp_password,
        company: app?.company_name || '',
      });
    },
    onError: (err: any) => alert(`Failed to approve: ${err?.message || 'Unknown error'}`),
  });

  const rejectMut = useMutation({
    mutationFn: (appId: string) => api(`/admin/applications/${appId}/reject`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-applications'] }),
    onError: (err: any) => alert(`Failed to reject: ${err?.message || 'Unknown error'}`),
  });

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
      approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
      rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    };
    return `inline-block px-2 py-0.5 rounded text-xs font-medium ${map[status] || ''}`;
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Applications</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Review and approve company applications. Approved companies get a Supervisor account automatically.
        </p>
      </div>

      {/* Approved credentials popup */}
      {approvedCreds && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-semibold text-green-800 dark:text-green-300 mb-1">
                ✅ {approvedCreds.company} — Account Created
              </div>
              <p className="text-sm text-green-700 dark:text-green-400 mb-3">
                Share these login credentials with the company supervisor. They must change their password on first login.
              </p>
              <div className="bg-white dark:bg-green-900/20 rounded-lg p-3 font-mono text-sm space-y-1 border border-green-200">
                <div>Email: <strong>{approvedCreds.email}</strong></div>
                <div>Temporary Password: <strong>{approvedCreds.temp_password}</strong></div>
                <div>Login URL: <strong>https://1ef6f9fa.opcc-crm.pages.dev/login</strong></div>
              </div>
            </div>
            <button
              onClick={() => setApprovedCreds(null)}
              className="text-green-600 hover:text-green-800 ml-4 text-lg"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm capitalize border-b-2 transition-colors ${
              filter === f
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading applications...</div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          Failed to load applications. Make sure you are logged in as admin.
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && applications.length === 0 && (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <div className="text-4xl mb-3">📋</div>
          <p className="font-medium">No {filter === 'all' ? '' : filter} applications</p>
          <p className="text-sm text-muted-foreground mt-1">
            {filter === 'pending'
              ? 'New applications will appear here when companies apply.'
              : 'No applications match this filter.'}
          </p>
        </div>
      )}

      {/* Applications list */}
      <div className="space-y-3">
        {applications.map(app => (
          <div
            key={app.id}
            className="border border-border rounded-xl p-4 bg-card"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-base">{app.company_name}</span>
                  <span className={statusBadge(app.status)}>{app.status}</span>
                </div>
                <div className="text-sm text-muted-foreground space-y-0.5">
                  <div>👤 {app.contact_name}</div>
                  <div>✉️ {app.email}</div>
                  {app.phone && <div>📞 {app.phone}</div>}
                  {app.message && (
                    <div className="mt-2 text-sm bg-muted/50 rounded p-2 italic">
                      "{app.message}"
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Applied: {new Date(app.created_at).toLocaleString()}
                  {app.reviewed_at && ` · Reviewed: ${new Date(app.reviewed_at).toLocaleString()}`}
                </div>
              </div>

              {/* Actions */}
              {app.status === 'pending' && (
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => {
                      if (confirm(`Approve ${app.company_name}? This will create a Supervisor account and email credentials to ${app.email}.`)) {
                        approveMut.mutate(app.id);
                      }
                    }}
                    disabled={approveMut.isPending}
                    className="bg-green-600 text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {approveMut.isPending ? 'Approving...' : '✓ Approve'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Reject application from ${app.company_name}?`)) {
                        rejectMut.mutate(app.id);
                      }
                    }}
                    disabled={rejectMut.isPending}
                    className="border border-red-300 text-red-600 px-4 py-1.5 rounded-md text-sm font-medium hover:bg-red-50 disabled:opacity-50"
                  >
                    ✗ Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
