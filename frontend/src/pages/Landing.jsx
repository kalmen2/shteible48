import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { signInWithGoogle } from '@/lib/firebase';
import { getUser } from '@/lib/auth';

export default function Landing() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const navigateByUser = (user) => {
    const role = String(user?.role || '').toLowerCase();
    const memberId = String(user?.member_id || '').trim();
    const guestId = String(user?.guest_id || '').trim();
    if (role === 'member' && memberId) {
      navigate(`/MemberDetail?id=${encodeURIComponent(memberId)}`, { replace: true });
      return;
    }
    if (role === 'guest' && guestId) {
      navigate(`/GuestDetail?id=${encodeURIComponent(guestId)}`, { replace: true });
      return;
    }
    navigate('/Members', { replace: true });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const out = await base44.auth.login({ email, password });
      navigateByUser(out?.user);
    } catch (err) {
      setError(err?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const continueWithGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      const { idToken } = await signInWithGoogle();
      const out = await base44.auth.loginWithGoogle({ idToken });
      if (out?.requiresPasswordSetup) {
        setNeedsPasswordSetup(true);
      } else {
        navigateByUser(out?.user);
      }
    } catch (err) {
      setError(err?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const submitPasswordSetup = async (e) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const out = await base44.auth.setPassword({ password: newPassword });
      const user = out?.user || getUser();
      setNeedsPasswordSetup(false);
      navigateByUser(user);
    } catch (err) {
      setError(err?.message || 'Failed to set password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-blue-900">Synagogue Harmony</h1>
          <p className="text-slate-600 mt-2">Sign in to manage members, guests, and billing.</p>
        </div>

        <Card className="border-blue-100 shadow-lg">
          <CardHeader>
            <CardTitle className="text-blue-900">
              {needsPasswordSetup ? 'Set Password' : 'Login'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {needsPasswordSetup ? (
              <form className="mt-4 space-y-4" onSubmit={submitPasswordSetup}>
                <div className="text-sm text-slate-600">
                  First-time sign in successful. Set a password for future email/password login.
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>

                {error ? <div className="text-sm text-red-600">{error}</div> : null}

                <Button
                  className="w-full bg-blue-900 hover:bg-blue-800"
                  type="submit"
                  disabled={loading}
                >
                  {loading ? 'Please wait...' : 'Save Password'}
                </Button>
              </form>
            ) : (
              <form className="mt-4 space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>

                {error ? <div className="text-sm text-red-600">{error}</div> : null}

                <Button
                  className="w-full bg-blue-900 hover:bg-blue-800"
                  type="submit"
                  disabled={loading}
                >
                  {loading ? 'Please wait...' : 'Login'}
                </Button>

                <Button
                  className="w-full border-blue-200 text-blue-900 hover:bg-blue-50"
                  variant="outline"
                  type="button"
                  disabled={loading}
                  onClick={continueWithGoogle}
                >
                  Continue with Google
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
