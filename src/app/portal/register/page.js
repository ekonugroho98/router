// Cortex AI — Direct registration (Google OAuth + email/password)
"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { portalLink } from "@/lib/customer/portalLinks";

export default function PortalRegisterPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-zinc-400">Loading...</div>}>
      <RegisterInner />
    </Suspense>
  );
}

function RegisterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const plan = searchParams?.get("plan");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
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
      if (data.apiKey) {
        try { sessionStorage.setItem("cortex_first_key", JSON.stringify(data.apiKey)); } catch {}
      }
      if (plan && plan !== "free") {
        router.push("/pricing");
      } else {
        router.push("/dashboard?welcome=1");
      }
    } catch (err) {
      setError(err?.message || String(err));
      setSubmitting(false);
    }
  }, [router, plan]);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    window._handleGoogleCredential = handleGoogleResponse;

    if (document.getElementById("google-gsi-script")) {
      // Script already loaded, just re-render button
      window.google?.accounts?.id?.initialize({
        client_id: clientId,
        callback: handleGoogleResponse,
      });
      const btnEl = document.getElementById("google-signup-btn");
      if (btnEl) {
        btnEl.innerHTML = "";
        window.google?.accounts?.id?.renderButton(btnEl, {
          theme: "filled_black",
          size: "large",
          width: "100%",
          text: "signup_with",
          shape: "rectangular",
        });
      }
      return;
    }

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
      const btnEl = document.getElementById("google-signup-btn");
      if (btnEl) {
        window.google?.accounts?.id?.renderButton(btnEl, {
          theme: "filled_black",
          size: "large",
          width: "100%",
          text: "signup_with",
          shape: "rectangular",
        });
      }
    };
    document.head.appendChild(script);
  }, [handleGoogleResponse]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Password tidak cocok"); return; }
    if (password.length < 8) { setError("Password minimal 8 karakter"); return; }
    setSubmitting(true);

    try {
      const res = await fetch("/api/customer/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName: displayName || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        setSubmitting(false);
        return;
      }

      if (typeof window !== "undefined" && data?.apiKey?.key) {
        try { sessionStorage.setItem("cortex_first_key", JSON.stringify(data.apiKey)); } catch {}
      }

      // Email+password users need verification
      router.push("/verify-email");
    } catch (err) {
      setError(err?.message || String(err));
      setSubmitting(false);
    }
  };

  const hasGoogle = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 mb-4">
            <span className="text-2xl font-black">C</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Daftar Cortex AI</h1>
          <p className="text-sm text-zinc-400 mt-1">Buat akun gratis — Free Trial 3 hari</p>
        </div>

        <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-6 space-y-4">
          {/* Google Sign-Up */}
          {hasGoogle && (
            <>
              <div id="google-signup-btn" className="flex justify-center" />
              <div className="text-center text-[10px] text-zinc-600">
                Daftar via Google = email otomatis terverifikasi
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-800" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-zinc-900 px-3 text-zinc-500">atau daftar manual</span>
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
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                placeholder="nama@gmail.com"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-700 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Nama <span className="text-zinc-600">(opsional)</span>
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={submitting}
                placeholder="Nama tampilan"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-700 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                placeholder="Minimal 8 karakter"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-700 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Konfirmasi Password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={submitting}
                placeholder="Ulangi password"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-700 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed py-3 text-sm font-semibold text-white transition shadow-lg shadow-orange-600/20"
            >
              {submitting ? "Membuat akun..." : "Daftar dengan Email"}
            </button>

            <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3 space-y-1">
              <div className="text-[10px] text-zinc-500">
                Hanya email @gmail.com yang diperbolehkan.
              </div>
              <div className="text-[10px] text-zinc-500">
                Daftar via email memerlukan verifikasi OTP sebelum akun aktif.
              </div>
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500">
          Sudah punya akun?{" "}
          <a href="/login" className="text-orange-500 hover:underline">Masuk</a>
        </p>
        <p className="mt-2 text-center text-xs text-zinc-600">
          <a href="/" className="hover:text-orange-400">&larr; Kembali ke beranda</a>
        </p>
      </div>
    </div>
  );
}
