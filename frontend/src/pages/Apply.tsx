/**
 * Apply.tsx — Professional application form for new companies
 * Route: /apply
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export default function Apply() {
  const [form, setForm] = useState({
    company_name: '', contact_name: '', email: '', phone: '',
    br_number: '', industry: '', message: '',
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    if (!form.company_name.trim()) return 'Company name is required.';
    if (!form.contact_name.trim()) return 'Contact name is required.';
    if (!form.email.trim() || !form.email.includes('@')) return 'A valid email address is required.';
    if (form.phone && !/^[+\d\s()-]{6,20}$/.test(form.phone)) return 'Please enter a valid phone number.';
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
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
          <h1 className="text-2xl font-bold mb-2">Application Received</h1>
          <p className="text-muted-foreground mb-4">
            Thank you for applying to Tech Connect SME. Our team will review your application and
            send your login credentials to <strong>{form.email}</strong> within 1 business day.
          </p>
          <p className="text-xs text-muted-foreground mb-6">
            You will receive a temporary password that must be changed on first login.
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
      <div className="max-w-lg w-full">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">Apply for Tech Connect SME</h1>
          <p className="text-muted-foreground text-sm mt-2">
            AI-powered financial management for Hong Kong SMEs.
            Submit your application and we'll set up your account within 1 business day.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-card border border-border rounded-xl p-6 shadow-sm">
          {/* Company info */}
          <div>
            <label className="block text-sm font-medium mb-1">Company Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.company_name} onChange={set('company_name')}
              placeholder="e.g. ABC Trading Limited" required
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">BR Number</label>
              <input type="text" value={form.br_number} onChange={set('br_number')}
                placeholder="e.g. 12345678-000-00-00-0"
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
              <p className="text-[10px] text-muted-foreground mt-0.5">Business Registration number (optional)</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Industry</label>
              <select value={form.industry} onChange={set('industry')}
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">Select...</option>
                <option value="trading">Trading</option>
                <option value="professional_services">Professional Services</option>
                <option value="construction">Construction</option>
                <option value="food_beverage">Food & Beverage</option>
                <option value="retail">Retail</option>
                <option value="technology">Technology</option>
                <option value="manufacturing">Manufacturing</option>
                <option value="logistics">Logistics & Transport</option>
                <option value="education">Education</option>
                <option value="healthcare">Healthcare</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {/* Contact info */}
          <div className="border-t pt-4 mt-4">
            <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider font-medium">Contact Person</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Full Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.contact_name} onChange={set('contact_name')}
              placeholder="Your full name" required
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Email <span className="text-red-500">*</span></label>
              <input type="email" value={form.email} onChange={set('email')}
                placeholder="your@company.com" required
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={set('phone')}
                placeholder="+852 1234 5678"
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Additional Notes</label>
            <textarea value={form.message} onChange={set('message')}
              placeholder="Tell us about your accounting needs, current software, or any questions..."
              rows={3}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 rounded-md px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-primary text-primary-foreground rounded-md py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {loading ? 'Submitting...' : 'Submit Application'}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </form>

        <p className="text-center text-[10px] text-muted-foreground mt-4">
          By submitting, you agree to our{' '}
          <Link to="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
