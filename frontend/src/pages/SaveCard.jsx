import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
export default function SaveCard() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const isRetry = params.get('retry') === '1' || params.get('stripe') === 'cancel';
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [cardStatus, setCardStatus] = useState({
    loading: true,
    hasCard: false,
    card: null,
    name: '',
  });

  useEffect(() => {
    if (!token) {
      window.location.href = '/save-card/error?reason=invalid';
    }
  }, [token]);

  useEffect(() => {
    let alive = true;
    const loadCardStatus = async () => {
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE_URL}/payments/public/save-card-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.message || 'Unable to verify save-card token');
        }
        if (!alive) return;
        setCardStatus({
          loading: false,
          hasCard: Boolean(data?.hasCard),
          card: data?.card || null,
          name: data?.name || '',
        });
      } catch (err) {
        const msg = String(err?.message || '').toLowerCase();
        const isInvalid = msg.includes('expired') || msg.includes('invalid');
        if (isInvalid) {
          window.location.href = '/save-card/error?reason=invalid';
          return;
        }
        if (!alive) return;
        setCardStatus({
          loading: false,
          hasCard: false,
          card: null,
          name: '',
        });
      }
    };
    loadCardStatus();
    return () => {
      alive = false;
    };
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
        {cardStatus.loading ? (
          <p className="text-sm text-slate-600">Checking your current card status...</p>
        ) : cardStatus.hasCard ? (
          <div className="text-left rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-1">
            <p className="text-sm text-blue-900 font-medium">A card is already on file.</p>
            {cardStatus.name ? (
              <p className="text-xs text-slate-700">Name: {cardStatus.name}</p>
            ) : null}
            {cardStatus.card ? (
              <p className="text-xs text-slate-700">
                {cardStatus.card.brand} ending in {cardStatus.card.last4} (exp{' '}
                {String(cardStatus.card.expMonth).padStart(2, '0')}/{cardStatus.card.expYear})
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            {isRetry
              ? 'Checkout was canceled. Click below to continue and enter your card details.'
              : 'Click below to securely enter your card details.'}
          </p>
        )}
        <button
          type="button"
          onClick={startCheckout}
          disabled={status === 'loading' || cardStatus.loading}
          className="inline-flex items-center justify-center rounded-lg bg-blue-900 text-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {status === 'loading'
            ? 'Opening Checkout...'
            : cardStatus.hasCard
              ? 'Update Card'
              : 'Enter Card Details'}
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
