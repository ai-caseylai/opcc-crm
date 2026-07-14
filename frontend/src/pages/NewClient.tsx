import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { UserPlus, ArrowLeft, Copy, Check, AlertCircle } from 'lucide-react';

// Simple client onboarding: firm admin adds a new client company.
// Backend creates a users row + firm_clients link + seeds the HK COA for the new tenant.
// This replaces the "run SQL from PowerShell" workflow with a normal UI.
export default function NewClient() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    company_name: '',
    contact_email: '',
    contact_name: '',
    initial_password: '',
    permission_tier: 'higher' as 'normal' | 'higher',
  });
  const [result, setResult] = useState<{ user_id: string; email: string; password: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => api('/firms/my/clients', {
      method: 'POST',
      body: JSON.stringify(form),
    }) as Promise<{ user_id: string; client_id: string; success: boolean }>,
    onSuccess: (res) => {
      setResult({
        user_id: res.user_id,
        email: form.contact_email,
        password: form.initial_password,
      });
      qc.invalidateQueries({ queryKey: ['firm-clients'] });
    },
    onError: (err: any) => {
      alert(`Could not create client: ${err?.error || err?.message || 'unknown error'}`);
    },
  });

  const generatePassword = () => {
    // Simple readable password: prefix + 4 digits
    const words = ['sunny', 'happy', 'lucky', 'smart', 'quick', 'bright', 'clear', 'gentle'];
    const w = words[Math.floor(Math.random() * words.length)];
    const digits = Math.floor(1000 + Math.random() * 9000);
    setForm(f => ({ ...f, initial_password: `${w}-${digits}` }));
  };

  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const canSubmit = form.company_name.trim() && form.contact_email.trim() &&
                    form.initial_password.length >= 6 && !createMut.isPending;

  if (result) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950 p-6">
          <h1 className="text-lg font-bold text-green-900 dark:text-green-100 mb-3 flex items-center gap-2">
            ✓ Client created successfully
          </h1>
          <p className="text-sm text-green-800 dark:text-green-200 mb-4">
            Share these credentials with your client. They can log in immediately.
            The chart of accounts (HK) has been seeded for their tenant.
          </p>
          <div className="bg-white dark:bg-green-950/40 rounded border border-green-200 p-3 space-y-2 font-mono text-sm">
            <CredentialRow label="Company" value={form.company_name} copied={copied === 'Company'} onCopy={() => copy('Company', form.company_name)} />
            <CredentialRow label="Login Email" value={result.email} copied={copied === 'Login Email'} onCopy={() => copy('Login Email', result.email)} />
            <CredentialRow label="Password" value={result.password} copied={copied === 'Password'} onCopy={() => copy('Password', result.password)} />
            <CredentialRow label="Permission" value={form.permission_tier + ' tier'} copied={false} onCopy={() => {}} />
          </div>
          <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>Store this password safely — it will not be shown again. Advise the client to change it after first login.</span>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => { setResult(null); setForm({ company_name: '', contact_email: '', contact_name: '', initial_password: '', permission_tier: 'higher' }); }}
              className="px-4 py-2 border rounded text-sm"
            >
              Add another client
            </button>
            <button
              onClick={() => nav('/firm-management')}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium"
            >
              Back to firm management
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <Link to="/firm-management" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" /> Back to firm management
      </Link>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <UserPlus className="h-6 w-6" /> Add new client company
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create a new client tenant. They'll get a private data space seeded with the HK chart of accounts.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Company name *</label>
          <input
            value={form.company_name}
            onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
            placeholder="e.g. Acme Trading Limited"
            className="mt-1 block w-full px-3 py-2 border rounded"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Contact name</label>
            <input
              value={form.contact_name}
              onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
              placeholder="e.g. John Chan"
              className="mt-1 block w-full px-3 py-2 border rounded"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Login email *</label>
            <input
              type="email"
              value={form.contact_email}
              onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
              placeholder="acme@example.com"
              className="mt-1 block w-full px-3 py-2 border rounded"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Initial password * (at least 6 characters)</label>
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              value={form.initial_password}
              onChange={e => setForm(f => ({ ...f, initial_password: e.target.value }))}
              placeholder="Type or generate"
              className="flex-1 px-3 py-2 border rounded"
            />
            <button type="button" onClick={generatePassword} className="px-3 py-2 border rounded text-sm">
              Generate
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Permission tier</label>
          <div className="mt-1 flex gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={form.permission_tier === 'higher'}
                onChange={() => setForm(f => ({ ...f, permission_tier: 'higher' }))}
              />
              Higher — can delete, restore, permanently delete
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={form.permission_tier === 'normal'}
                onChange={() => setForm(f => ({ ...f, permission_tier: 'normal' }))}
              />
              Normal — read/write only, no delete
            </label>
          </div>
        </div>

        <div className="pt-2 flex justify-end gap-2">
          <button onClick={() => nav('/firm-management')} className="px-4 py-2 border rounded text-sm">
            Cancel
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={!canSubmit}
            className="px-6 py-2 bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {createMut.isPending ? 'Creating…' : 'Create client'}
          </button>
        </div>
      </div>

      <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
        <div className="font-medium mb-1">What happens when you click Create:</div>
        <ol className="list-decimal ml-5 space-y-0.5">
          <li>A new user account is created with the login email and password</li>
          <li>The client is linked to your firm so you can switch to them from the tenant dropdown</li>
          <li>The full HK chart of accounts is seeded for the new tenant</li>
          <li>You receive the credentials on screen to share with the client</li>
        </ol>
      </div>
    </div>
  );
}

function CredentialRow({ label, value, copied, onCopy }: {
  label: string; value: string; copied: boolean; onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-xs text-muted-foreground">{label}:</div>
      <div className="flex items-center gap-2">
        <div className="font-mono">{value}</div>
        <button
          onClick={onCopy}
          className="text-xs px-2 py-1 border rounded hover:bg-muted flex items-center gap-1"
          title="Copy"
        >
          {copied ? <><Check className="h-3 w-3 text-green-600" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
        </button>
      </div>
    </div>
  );
}
