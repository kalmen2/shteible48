import { CheckCircle } from 'lucide-react';

export default function SaveCardSuccess() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 px-4">
      <div className="max-w-md w-full rounded-2xl bg-white shadow-lg border border-slate-200 p-8 text-center space-y-4">
        <div className="flex justify-center">
          <div className="h-14 w-14 rounded-full bg-green-50 text-green-700 flex items-center justify-center border border-green-100">
            <CheckCircle className="h-8 w-8" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Card Saved Successfully</h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          Thank you! Your card has been saved securely. If you have any questions about upcoming charges
          or need to update your information, please reach out to the office.
        </p>
        <div className="text-xs text-slate-500">
          You may safely close this page.
        </div>
      </div>
    </div>
  );
}
