import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { Plus, Trash2, X } from 'lucide-react';

export default function FirmManagement() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'staff' | 'clients' | 'assignments'>('staff');
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState('staff');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientDisplayName, setClientDisplayName] = useState('');

  const firmId = user?.firm_id;

  const { data: firmData } = useQuery({
    queryKey: ['firm'],
    queryFn: () => api('/firms/my'),
    enabled: !!firmId,
  });

  const { data: membersData } = useQuery({
    queryKey: ['firm-members', firmId],
    queryFn: () => api(`/firms/${firmId}/members`),
    enabled: !!firmId && user?.firm_role === 'admin',
  });

  const { data: clientsData } = useQuery({
    queryKey: ['firm-clients', firmId],
    queryFn: () => api(`/firms/${firmId}/clients`),
    enabled: !!firmId,
  });

  const { data: assignmentsData } = useQuery({
    queryKey: ['firm-assignments', firmId],
    queryFn: () => api(`/firms/${firmId}/assignments`),
    enabled: !!firmId && user?.firm_role === 'admin',
  });

  const addMemberMut = useMutation({
    mutationFn: (body: { email: string; role: string }) =>
      api(`/firms/${firmId}/members`, { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['firm-members'] });
      setShowAddStaff(false);
      setStaffEmail('');
    },
  });

  const removeMemberMut = useMutation({
    mutationFn: (memberId: string) =>
      api(`/firms/${firmId}/members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['firm-members'] }),
  });

  const addClientMut = useMutation({
    mutationFn: (body: { company_name: string; email: string; display_name?: string }) =>
      api(`/firms/${firmId}/clients`, { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['firm-clients'] });
      queryClient.invalidateQueries({ queryKey: ['firm'] });
      setShowAddClient(false);
      setClientName('');
      setClientEmail('');
      setClientDisplayName('');
    },
  });

  const archiveClientMut = useMutation({
    mutationFn: (clientId: string) =>
      api(`/firms/${firmId}/clients/${clientId}`, { method: 'PATCH', body: { status: 'archived' } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['firm-clients'] }),
  });

  const updateAssignmentsMut = useMutation({
    mutationFn: (body: { firm_member_id: string; firm_client_ids: string[] }) =>
      api(`/firms/${firmId}/assignments`, { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['firm-assignments'] }),
  });

  if (!firmId || user?.firm_role !== 'admin') {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Only firm administrators can access this page.
      </div>
    );
  }

  const members = membersData?.data || [];
  const clients = clientsData?.data || [];
  const assignments = assignmentsData?.data || [];

  // Build a map: memberId → set of clientIds
  const assignmentMap: Record<string, Set<string>> = {};
  for (const a of assignments) {
    if (!assignmentMap[a.firm_member_id]) assignmentMap[a.firm_member_id] = new Set();
    assignmentMap[a.firm_member_id].add(a.firm_client_id);
  }

  const tabs = [
    { id: 'staff' as const, label: 'Staff 職員' },
    { id: 'clients' as const, label: 'Clients 客戶' },
    { id: 'assignments' as const, label: 'Assignments 指派' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Firm Management 會計師行管理</h2>
        <p className="text-muted-foreground mt-1">{firmData?.firm?.name}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Staff Tab */}
      {tab === 'staff' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold">Staff Members</h3>
            <button onClick={() => setShowAddStaff(true)}
              className="flex items-center gap-1 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm">
              <Plus className="h-3.5 w-3.5" /> Add Staff
            </button>
          </div>

          {showAddStaff && (
            <div className="bg-card border rounded-lg p-4 space-y-3">
              <div className="flex gap-3">
                <input value={staffEmail} onChange={e => setStaffEmail(e.target.value)}
                  placeholder="Email address" className="flex-1 px-3 py-2 border rounded-md text-sm" />
                <select value={staffRole} onChange={e => setStaffRole(e.target.value)}
                  className="px-3 py-2 border rounded-md text-sm">
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
                <button onClick={() => addMemberMut.mutate({ email: staffEmail, role: staffRole })}
                  disabled={addMemberMut.isPending || !staffEmail}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-40">
                  Add
                </button>
                <button onClick={() => setShowAddStaff(false)}
                  className="px-3 py-2 border rounded-md text-sm"><X className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          <div className="bg-card border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3">Name</th>
                  <th className="text-left p-3">Email</th>
                  <th className="text-left p-3">Role</th>
                  <th className="text-left p-3">Status</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m: any) => (
                  <tr key={m.id} className="border-b hover:bg-muted/30">
                    <td className="p-3">{m.name}</td>
                    <td className="p-3 text-muted-foreground">{m.email}</td>
                    <td className="p-3 capitalize">{m.role}</td>
                    <td className="p-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${m.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button onClick={() => { if (confirm('Remove this member?')) removeMemberMut.mutate(m.id); }}
                        className="p-1 hover:bg-muted rounded text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan={5} className="text-center p-6 text-muted-foreground">No staff members</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Clients Tab */}
      {tab === 'clients' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold">Client Companies</h3>
            <button onClick={() => setShowAddClient(true)}
              className="flex items-center gap-1 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm">
              <Plus className="h-3.5 w-3.5" /> Add Client
            </button>
          </div>

          {showAddClient && (
            <div className="bg-card border rounded-lg p-4 space-y-3">
              <div className="flex gap-3">
                <input value={clientName} onChange={e => setClientName(e.target.value)}
                  placeholder="Company name *" className="flex-1 px-3 py-2 border rounded-md text-sm" />
                <input value={clientEmail} onChange={e => setClientEmail(e.target.value)}
                  placeholder="Email *" className="flex-1 px-3 py-2 border rounded-md text-sm" />
                <input value={clientDisplayName} onChange={e => setClientDisplayName(e.target.value)}
                  placeholder="Display name (optional)" className="flex-1 px-3 py-2 border rounded-md text-sm" />
                <button onClick={() => addClientMut.mutate({
                  company_name: clientName, email: clientEmail, display_name: clientDisplayName || undefined,
                })}
                  disabled={addClientMut.isPending || !clientName || !clientEmail}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-40">
                  Create
                </button>
                <button onClick={() => setShowAddClient(false)}
                  className="px-3 py-2 border rounded-md text-sm"><X className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          <div className="bg-card border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3">Company</th>
                  <th className="text-left p-3">Email</th>
                  <th className="text-left p-3">Display Name</th>
                  <th className="text-left p-3">Status</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c: any) => (
                  <tr key={c.id} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-medium">{c.company_name || c.user_name}</td>
                    <td className="p-3 text-muted-foreground">{c.email}</td>
                    <td className="p-3 text-muted-foreground">{c.display_name || '-'}</td>
                    <td className="p-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {c.status === 'active' && (
                        <button onClick={() => { if (confirm('Archive this client?')) archiveClientMut.mutate(c.id); }}
                          className="text-xs text-muted-foreground hover:text-destructive">Archive</button>
                      )}
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && (
                  <tr><td colSpan={5} className="text-center p-6 text-muted-foreground">No clients</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Assignments Tab */}
      {tab === 'assignments' && (
        <div className="space-y-4">
          <h3 className="font-semibold">Staff ↔ Client Assignments</h3>
          <p className="text-sm text-muted-foreground">Check which clients each staff member can access.</p>

          <div className="space-y-4">
            {members.filter((m: any) => m.is_active).map((member: any) => {
              const assigned = assignmentMap[member.id] || new Set();
              return (
                <div key={member.id} className="bg-card border rounded-lg p-4">
                  <div className="font-medium text-sm mb-2">{member.name} ({member.email})</div>
                  <div className="flex flex-wrap gap-2">
                    {clients.map((client: any) => {
                      const isAssigned = assigned.has(client.id);
                      return (
                        <label key={client.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border cursor-pointer transition-colors ${
                          isAssigned ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted'
                        }`}>
                          <input type="checkbox" checked={isAssigned}
                            onChange={() => {
                              const newIds = isAssigned
                                ? Array.from(assigned).filter(id => id !== client.id)
                                : [...Array.from(assigned), client.id];
                              updateAssignmentsMut.mutate({ firm_member_id: member.id, firm_client_ids: newIds });
                            }}
                            className="sr-only" />
                          {client.display_name || client.company_name || client.user_name}
                        </label>
                      );
                    })}
                  </div>
                  {clients.length === 0 && (
                    <p className="text-xs text-muted-foreground">No clients to assign. Add clients first.</p>
                  )}
                </div>
              );
            })}
            {members.length === 0 && (
              <p className="text-sm text-muted-foreground">Add staff members first.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
