/**
 * Apply.tsx — Application form for new companies
 * Replaces the open registration page.
 * Place in: frontend/src/pages/Apply.tsx
 * Route: /apply  (add to App.tsx)
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export default function Apply() {
  const [form, setForm] = useState({
    company_name: '', contact_name: '', email: '', phone: '', message: '',
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api('/auth/apply', { method: 'POST', body: form });
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit application. Please try again.');
    }
    setLoading(false);
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-2xl font-bold mb-2">Application Received!</h1>
          <p className="text-muted-foreground mb-6">
            Thank you for applying to Tech Connect SME. Our team will review your application and
            send your login details to <strong>{form.email}</strong> within 1 business day.
          </p>
          <Link to="/login" className="text-primary hover:underline text-sm">
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">Apply for Tech Connect SME</h1>
          <p className="text-muted-foreground text-sm mt-2">
            Submit your application and we'll set up your account within 1 business day.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-card border border-border rounded-xl p-6 shadow-sm">
          <div>
            <label className="block text-sm font-medium mb-1">Company Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.company_name} onChange={set('company_name')}
              placeholder="Your company name" required
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Contact Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.contact_name} onChange={set('contact_name')}
              placeholder="Your full name" required
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email <span className="text-red-500">*</span></label>
            <input type="email" value={form.email} onChange={set('email')}
              placeholder="your@email.com" required
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input type="tel" value={form.phone} onChange={set('phone')}
              placeholder="+852 1234 5678"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Message (optional)</label>
            <textarea value={form.message} onChange={set('message')}
              placeholder="Tell us about your business needs..."
              rows={3}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 rounded-md px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {loading ? 'Submitting...' : 'Submit Application'}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
