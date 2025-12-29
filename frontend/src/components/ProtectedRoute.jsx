import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getToken } from "@/lib/auth";
import { base44 } from "@/api/base44Client";

export default function ProtectedRoute({ children }) {
  const token = getToken();
  const [checking, setChecking] = useState(Boolean(token));
  const [ok, setOk] = useState(Boolean(token));

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!token) {
        setChecking(false);
        setOk(false);
        return;
      }

      try {
        await base44.auth.getUser();
        if (!cancelled) {
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
  return children;
}
