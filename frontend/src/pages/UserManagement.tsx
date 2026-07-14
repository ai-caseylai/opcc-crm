/**
 * UserManagement.tsx
 * For Supervisors and Accountants to create/manage Staff and Viewer accounts.
 * Place in: frontend/src/pages/UserManagement.tsx
 * Route: /settings/users  (add to App.tsx under Settings)
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

export default function UserManagement() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'staff' as 'staff' | 'viewer' });
  const [error, setError] = useState('');
  const [newCreds, setNewCreds] = useState<{ email: string; temp_password: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['staff-users'],
    queryFn: () => api('/auth/staff'),
  });

  const staff: StaffUser[] = (data as any)?.data || [];

  const createMut = useMutation({
    mutationFn: (body: typeof form) => api('/auth/staff', { method: 'POST', body }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['staff-users'] });
      setShowCreate(false);
      setForm({ name: '', email: '', role: 'staff' });
      setNewCreds({ email: res.user_id ? form.email : '', temp_password: res.temp_password });
    },
    onError: (err: any) => setError(err?.message || 'Failed to create account'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: any) => api(`/auth/staff/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-users'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/auth/staff/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-users'] }),
  });

  const roleBadge = (role: string) => {
    const map: Record<string, string> = {
      staff: 'bg-blue-100 text-blue-700',
      viewer: 'bg-gray-100 text-gray-600',
      accountant: 'bg-purple-100 text-purple-700',
      supervisor: 'bg-green-100 text-green-700',
    };
    return `inline-block px-2 py-0.5 rounded text-xs font-medium ${map[role] || 'bg-gray-100 text-gray-600'}`;
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">User Management</h2>
          <p className="text-sm text-muted-foreground">Create and manage staff accounts for your company.</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setError(''); }}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90"
        >
          + Add Staff
        </button>
      </div>

      {/* New credentials popup */}
      {newCreds && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 rounded-lg p-4">
          <div className="font-medium text-green-800 dark:text-green-300 mb-2">✅ Account Created</div>
          <p className="text-sm text-green-700 dark:text-green-400 mb-2">
            Share these credentials with the new staff member. They will be required to change their password on first login.
          </p>
          <div className="bg-white dark:bg-green-900/30 rounded-md p-3 font-mono text-sm space-y-1">
            <div>Email: <strong>{newCreds.email}</strong></div>
            <div>Temporary Password: <strong>{newCreds.temp_password}</strong></div>
          </div>
          <button onClick={() => setNewCreds(null)} className="mt-3 text-xs text-green-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Create staff form */}
      {showCreate && (
        <div className="border border-border rounded-lg p-4 bg-muted/30">
          <h3 className="font-medium mb-3">New Staff Account</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Full Name</label>
                <input type="text" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Jane Smith"
                  className="w-full border border-border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Email</label>
                <input type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="jane@company.com"
                  className="w-full border border-border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Role</label>
              <select value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value as 'staff' | 'viewer' }))}
                className="border border-border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="staff">Staff — can upload and process documents</option>
                <option value="viewer">Viewer — read-only access</option>
              </select>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => createMut.mutate(form)}
                disabled={!form.name || !form.email || createMut.isPending}
                className="bg-primary text-primary-foreground px-4 py-1.5 rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {createMut.isPending ? 'Creating...' : 'Create Account'}
              </button>
              <button onClick={() => setShowCreate(false)}
                className="border border-border px-4 py-1.5 rounded text-sm hover:bg-muted">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Staff list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : staff.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <div className="text-3xl mb-2">👥</div>
          <p className="text-sm text-muted-foreground">No staff accounts yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Click "Add Staff" to create the first one.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Email</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Role</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(s => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.email}</td>
                  <td className="px-4 py-3"><span className={roleBadge(s.role)}>{s.role}</span></td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      <select
                        defaultValue={s.status}
                        onChange={e => updateMut.mutate({ id: s.id, status: e.target.value })}
                        className="border border-border rounded px-2 py-1 text-xs bg-background"
                      >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                      </select>
                      <button
                        onClick={() => {
                          if (confirm(`Delete ${s.name}'s account? This cannot be undone.`)) {
                            deleteMut.mutate(s.id);
                          }
                        }}
                        className="text-red-600 hover:text-red-800 text-xs border border-red-200 px-2 py-1 rounded hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
