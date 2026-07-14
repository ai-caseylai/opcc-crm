import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

export default function Register() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side validation to give friendly messages BEFORE hitting the API
    if (!name.trim()) { setError('Please enter your name.'); return; }
    if (!email.trim() || !email.includes('@')) { setError('Please enter a valid email address.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (!/[A-Z]/.test(password)) { setError('Password must contain at least one uppercase letter (A-Z).'); return; }
    if (!/[a-z]/.test(password)) { setError('Password must contain at least one lowercase letter (a-z).'); return; }
    if (!/\d/.test(password)) { setError('Password must contain at least one number (0-9).'); return; }

    setBusy(true);
    try {
      await register(email, password, name, company);
      navigate('/');
    } catch (err: any) {
      // Handle every possible error shape:
      // - string: "some message"
      // - {error: "message"} from our API
      // - {message: "message"} from fetch errors
      // - {issues: [...]} from Zod validation
      // - Response object
      // - anything else → stringify
      let msg = '';
      if (typeof err === 'string') {
        msg = err;
      } else if (err?.error && typeof err.error === 'string') {
        msg = err.error;
      } else if (err?.message && typeof err.message === 'string') {
        msg = err.message;
      } else if (err?.issues && Array.isArray(err.issues)) {
        // Zod validation errors
        msg = err.issues.map((i: any) => i.message || i.path?.join('.') || 'Validation error').join('. ');
      } else if (err?.success === false && err?.error) {
        // {success: false, error: {...}} shape
        msg = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
      } else {
        try { msg = JSON.stringify(err); } catch { msg = String(err); }
        // If the stringified version is just "{}" or similar, use a fallback
        if (msg === '{}' || msg === '""') msg = '';
      }
      setError(msg || t('auth.registerFailed') || 'Registration failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold text-center text-primary mb-2">{t('app.title')}</h1>
        <p className="text-center text-muted-foreground mb-6">{t('auth.registerTitle')}</p>
        <form onSubmit={handleSubmit} className="space-y-4 bg-card p-6 rounded-lg border shadow-sm">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">{t('auth.name')}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-input"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('auth.email')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-input"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('auth.company') || 'Company'} (optional)</label>
            <input
              type="text"
              value={company}
              onChange={e => setCompany(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('auth.password')} (≥8, uppercase, lowercase, number)</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-input"
              required
              minLength={8}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? '⏳ Registering…' : `🔐 ${t('auth.register')}`}
          </button>
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.hasAccount') || 'Already have an account?'}{' '}
            <Link to="/login" className="text-primary hover:underline">
              {t('auth.login')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
