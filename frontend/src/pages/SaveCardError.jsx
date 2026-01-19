import { AlertTriangle } from 'lucide-react';

export default function SaveCardError() {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get('reason');
  const isCancelled = reason === 'cancel' || params.get('stripe') === 'cancel';
  const isInvalid = reason === 'invalid';

  const title = isCancelled
    ? 'Card Saving Cancelled'
    : isInvalid
      ? 'Save-Card Link Expired'
      : 'Unable to Save Card';

  const description = isCancelled
    ? 'You exited the Stripe checkout before finishing. To keep your card on file, please reopen the link or request a fresh one.'
    : isInvalid
      ? 'This save-card link is invalid or has expired. For security, links expire after one use or 24 hours. Please request a new link and try again.'
      : 'Something went wrong starting the secure card setup. Please try again or request a new link.';

  const mailtoHref = `mailto:?subject=${encodeURIComponent('Save-card link request')}&body=${encodeURIComponent('Hi, can you send me a new save-card link? Thank you.')}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-red-50 to-slate-100 px-4">
      <div className="max-w-md w-full rounded-2xl bg-white shadow-lg border border-red-100 p-8 text-center space-y-4">
        <div className="flex justify-center">
          <div className="h-14 w-14 rounded-full bg-red-50 text-red-700 flex items-center justify-center border border-red-100">
            <AlertTriangle className="h-8 w-8" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <a
            href={mailtoHref}
            className="inline-flex items-center justify-center rounded-lg bg-blue-900 text-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-blue-800 transition-colors"
          >
            Request new link
          </a>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors"
          >
            Back to site
          </a>
        </div>
        <div className="text-xs text-slate-500">If this keeps happening, please contact support.</div>
      </div>
    </div>
  );
}
