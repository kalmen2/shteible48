import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
export default function SaveCard() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [status] = useState('loading');
  const [message] = useState('Redirecting you to Stripe to save your card...');

  useEffect(() => {
    if (!token) {
      window.location.href = '/save-card/error?reason=invalid';
      return;
    }

    const go = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/payments/public/save-card-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            successPath: '/save-card/success',
            cancelPath: '/save-card/error?reason=cancel',
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
        const reason = isExpired ? 'invalid' : 'error';
        window.location.href = `/save-card/error?reason=${encodeURIComponent(reason)}`;
      }
    };

    go();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md w-full rounded-xl bg-white shadow-sm border border-slate-200 p-6 text-center space-y-3">
        <h1 className="text-xl font-semibold text-slate-900">Save Your Card</h1>
        <p className="text-sm text-slate-600">
          {status === 'loading' ? 'Preparing your secure Stripe session...' : message}
        </p>
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
