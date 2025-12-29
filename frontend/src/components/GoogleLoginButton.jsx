import React from "react";
import { signInWithGoogle } from "@/lib/firebase";
import { base44 } from "@/api/base44Client";

export default function GoogleLoginButton({ onSuccess, onError }) {
  const handleGoogleLogin = async () => {
    try {
      const { idToken } = await signInWithGoogle();
      const result = await base44.auth.loginWithGoogle({ idToken });
      if (onSuccess) onSuccess(result);
    } catch (err) {
      if (onError) onError(err);
      else alert(err.message);
    }
  };

  return (
    <button
      type="button"
      onClick={handleGoogleLogin}
      style={{
        background: "#fff",
        color: "#444",
        border: "1px solid #ccc",
        borderRadius: 4,
        padding: "10px 20px",
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <img src="https://developers.google.com/identity/images/g-logo.png" alt="Google" style={{ width: 20, height: 20 }} />
      Sign in with Google
    </button>
  );
}
