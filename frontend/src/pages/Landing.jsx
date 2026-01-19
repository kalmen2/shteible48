import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { signInWithGoogle } from '@/lib/firebase';

export default function Landing() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await base44.auth.login({ email, password });
      navigate('/Members');
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
      await base44.auth.loginWithGoogle({ idToken });
      navigate('/Members');
    } catch (err) {
      setError(err?.message || 'Failed');
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
            <CardTitle className="text-blue-900">Login</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
