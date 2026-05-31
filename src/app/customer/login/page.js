// ADDON: saas-mt — Customer login page (email + Google OAuth)
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { isPortalDomain, portalLink } from "@/lib/customer/portalLinks";

export default function CustomerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleResponse = useCallback(async (response) => {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/customer/google-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: response.credential }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        setSubmitting(false);
        return;
      }
      if (data.isNew && data.apiKey) {
        try { sessionStorage.setItem("cortex_first_key", JSON.stringify(data.apiKey)); } catch {}
        router.push(portalLink("/customer/dashboard") + "?welcome=1");
      } else {
        router.push(portalLink("/customer/dashboard"));
      }
    } catch (err) {
      setError(err?.message || String(err));
      setSubmitting(false);
    }
  }, [router]);

  // Load Google Sign-In script
  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    window._handleGoogleCredential = handleGoogleResponse;

    if (document.getElementById("google-gsi-script")) return;
    const script = document.createElement("script");
    script.id = "google-gsi-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.google?.accounts?.id?.initialize({
        client_id: clientId,
        callback: handleGoogleResponse,
      });
      const btnEl = document.getElementById("google-signin-btn");
      if (btnEl) {
        window.google?.accounts?.id?.renderButton(btnEl, {
          theme: "filled_black",
          size: "large",
          width: "100%",
          text: "signin_with",
          shape: "rectangular",
        });
      }
    };
    document.head.appendChild(script);
  }, [handleGoogleResponse]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/customer/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      router.push(portalLink("/customer/dashboard"));
    } catch (err) {
      setError(err?.message || String(err));
      setSubmitting(false);
    }
  };

  const hasGoogle = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-gradient-to-br from-orange-500 to-orange-700 mb-3">
            <span className="text-xl font-black">C</span>
          </div>
          <h1 className="text-2xl font-bold">Masuk</h1>
          <p className="text-sm text-zinc-400 mt-1">Masuk ke akun Cortex AI kamu</p>
        </div>

        <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-6">
          {/* Google Sign-In */}
          {hasGoogle && (
            <>
              <div id="google-signin-btn" className="mb-4 flex justify-center" />
              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-800" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-zinc-900 px-3 text-zinc-500">atau</span>
                </div>
              </div>
            </>
          )}

          {/* Email/Password form */}
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Email</label>
              <input
                type="email"
                autoComplete="email"
                autoFocus={!hasGoogle}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-700 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Password</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-700 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed py-3 text-sm font-semibold transition"
            >
              {submitting ? "Masuk..." : "Masuk"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500">
          Belum punya akun?{" "}
          <a href={isPortalDomain() ? "/register" : "/customer/signup"} className="text-orange-500 hover:underline">
            Daftar
          </a>
        </p>
      </div>
    </div>
  );
}
