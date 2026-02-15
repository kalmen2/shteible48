import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
export default function SaveCard() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const isRetry = params.get('retry') === '1' || params.get('stripe') === 'cancel';
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      window.location.href = '/save-card/error?reason=invalid';
    }
  }, [token]);

  const startCheckout = async () => {
    if (!token || status === 'loading') return;
    setStatus('loading');
    setMessage('Preparing your secure Stripe session...');
    try {
      const res = await fetch(`${API_BASE_URL}/payments/public/save-card-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          successPath: '/save-card/success',
          cancelPath: `/save-card?token=${encodeURIComponent(token)}&retry=1`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        throw new Error(data?.message || 'Failed to start Stripe session');
      }
      window.location.href = data.url;
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      const isExpired = msg.includes('expired') || msg.includes('invalid');
      if (isExpired) {
        window.location.href = '/save-card/error?reason=invalid';
        return;
      }
      setStatus('error');
      setMessage('Could not start secure checkout. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md w-full rounded-xl bg-white shadow-sm border border-slate-200 p-6 text-center space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Save Your Card</h1>
        <p className="text-sm text-slate-600">
          {isRetry
            ? 'Checkout was canceled. Click below to continue and enter your card details.'
            : 'Click below to securely enter your card details with Stripe.'}
        </p>
        <button
          type="button"
          onClick={startCheckout}
          disabled={status === 'loading'}
          className="inline-flex items-center justify-center rounded-lg bg-blue-900 text-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {status === 'loading' ? 'Opening Checkout...' : 'Enter Card Details'}
        </button>
        {status === 'loading' && (
          <div className="w-full flex justify-center pt-2">
            <div className="h-10 w-10 rounded-full border-4 border-blue-900 border-t-transparent animate-spin" />
          </div>
        )}
        {status === 'error' && <p className="text-sm text-red-600">{message}</p>}
      </div>
    </div>
  );
}
