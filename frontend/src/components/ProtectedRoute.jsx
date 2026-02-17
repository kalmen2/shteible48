import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getToken, getUser } from '@/lib/auth';
import { base44 } from '@/api/base44Client';

export default function ProtectedRoute({ children }) {
  const location = useLocation();
  const token = getToken();
  const [checking, setChecking] = useState(Boolean(token));
  const [ok, setOk] = useState(Boolean(token));
  const [user, setUser] = useState(getUser());

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!token) {
        setChecking(false);
        setOk(false);
        return;
      }

      try {
        const me = await base44.auth.getUser();
        if (!cancelled) {
          setUser(me || null);
          setOk(true);
          setChecking(false);
        }
      } catch {
        if (!cancelled) {
          setOk(false);
          setChecking(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) return <Navigate to="/" replace />;
  if (checking) return null;
  if (!ok) return <Navigate to="/" replace />;
  const role = String(user?.role || '').toLowerCase();
  if (role === 'member') {
    const memberId = String(user?.member_id || '').trim();
    if (!memberId) return <Navigate to="/" replace />;
    const params = new URLSearchParams(location.search);
    const currentId = String(params.get('id') || '');
    const isMemberDetail = location.pathname.toLowerCase() === '/memberdetail';
    if (!(isMemberDetail && currentId === memberId)) {
      return <Navigate to={`/MemberDetail?id=${encodeURIComponent(memberId)}`} replace />;
    }
  }
  if (role === 'guest') {
    const guestId = String(user?.guest_id || '').trim();
    if (!guestId) return <Navigate to="/" replace />;
    const params = new URLSearchParams(location.search);
    const currentId = String(params.get('id') || '');
    const isGuestDetail = location.pathname.toLowerCase() === '/guestdetail';
    if (!(isGuestDetail && currentId === guestId)) {
      return <Navigate to={`/GuestDetail?id=${encodeURIComponent(guestId)}`} replace />;
    }
  }
  return children;
}
