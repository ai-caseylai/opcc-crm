import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { LogIn } from 'lucide-react';
import ForcePasswordChange from '../components/ForcePasswordChange';

export default function Login() {
  const { t } = useTranslation();
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  React.useEffect(() => { if (user && !mustChangePassword) navigate('/'); }, [user, navigate, mustChangePassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result: any = await login(email, password);
      // Check if the API returned must_change_password flag
      if (result?.must_change_password) {
        setMustChangePassword(true);
      } else {
        navigate('/');
      }
    }
    catch (err: any) { setError(err.message || t('auth.loginFailed')); }
    finally { setBusy(false); }
  };

  return (
    <>
      {/* Force password change modal — shown on top of everything */}
      {mustChangePassword && (
        <ForcePasswordChange onComplete={() => { setMustChangePassword(false); navigate('/'); }} />
      )}

      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-primary">{t('app.title')}</h1>
            <p className="text-muted-foreground mt-2">{t('auth.loginTitle')}</p>
          </div>
          <form onSubmit={handleSubmit} className="bg-card border rounded-xl p-6 space-y-4">
            {error && <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">{error}</div>}
            <div>
              <label className="block text-sm font-medium mb-1">{t('auth.email')}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full px-3 py-2 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="you@company.com" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('auth.password')}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className="w-full px-3 py-2 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="••••••••" />
            </div>
            <button type="submit" disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
              <LogIn className="h-4 w-4" /> {busy ? t('auth.loggingIn') : t('auth.login')}
            </button>
            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{' '}
              <Link to="/apply" className="text-primary hover:underline">Apply here</Link>
            </p>
          </form>
        </div>
      </div>
    </>
  );
}
