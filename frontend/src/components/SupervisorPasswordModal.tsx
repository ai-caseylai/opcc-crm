/**
 * SupervisorPasswordModal.tsx
 * Shows a password popup when Staff tries to delete something.
 * Supervisor must enter their password to authorize the deletion.
 * 
 * Place in: frontend/src/components/SupervisorPasswordModal.tsx
 * 
 * Usage:
 *   const [supModal, setSupModal] = useState<{ show: boolean; onConfirm: () => void } | null>(null);
 * 
 *   // Instead of calling deleteMut.mutate() directly:
 *   setSupModal({ show: true, onConfirm: () => deleteMut.mutate(id) });
 * 
 *   // In JSX:
 *   {supModal?.show && (
 *     <SupervisorPasswordModal
 *       onConfirm={supModal.onConfirm}
 *       onCancel={() => setSupModal(null)}
 *     />
 *   )}
 */
import { useState } from 'react';
import { api } from '../lib/api';

interface Props {
  onConfirm: () => void;
  onCancel: () => void;
  action?: string; // e.g. "delete this bank statement"
}

export default function SupervisorPasswordModal({ onConfirm, onCancel, action = 'perform this action' }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) { setError('Please enter the supervisor password.'); return; }
    setError('');
    setLoading(true);

    try {
      await api('/auth/verify-supervisor-password', {
        method: 'POST',
        body: { password },
      });
      // Password verified — proceed with the action
      onConfirm();
      onCancel();
    } catch (err: any) {
      setError(err?.message || 'Incorrect password. Please try again.');
    }
    setLoading(false);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <div className="text-center mb-5">
          <div className="text-4xl mb-2">🔐</div>
          <h3 className="font-bold text-lg">Supervisor Approval Required</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Enter the Supervisor password to {action}.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Supervisor Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter supervisor password"
              autoFocus
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 rounded-md px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {loading ? 'Verifying...' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 border border-border rounded-md py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
