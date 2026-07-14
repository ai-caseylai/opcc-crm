/**
 * ForcePasswordChange.tsx
 * Shown immediately after login when must_change_password = true
 * Blocks access to the app until password is changed.
 * Place in: frontend/src/components/ForcePasswordChange.tsx
 */
import { useState } from 'react';
import { api } from '../lib/api';

interface Props {
  onComplete: () => void;
}

export default function ForcePasswordChange({ onComplete }: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) { setError('Passwords do not match.'); return; }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      setError('Password must contain uppercase, lowercase, and a number.');
      return;
    }
    setLoading(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { new_password: newPassword },
      });
      onComplete();
    } catch (err: any) {
      setError(err?.message || 'Failed to change password. Please try again.');
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🔐</div>
          <h2 className="text-xl font-bold">Set Your Password</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Your account was created with a temporary password. Please set a new password to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Min 8 chars, upper + lower + number"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 rounded-md px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {loading ? 'Saving...' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
