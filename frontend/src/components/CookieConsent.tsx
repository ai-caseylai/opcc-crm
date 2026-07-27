import React, { useState, useEffect } from 'react';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const accepted = localStorage.getItem('cookie-consent');
    if (!accepted) setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t shadow-lg p-4">
      <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground flex-1 min-w-0">
          This site uses essential cookies for authentication and security. No tracking or advertising cookies are used.
          By continuing, you accept our{' '}
          <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>.
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => { localStorage.setItem('cookie-consent', 'accepted'); setVisible(false); }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
