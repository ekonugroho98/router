// Cortex AI — Direct registration (no redeem code needed)
// Signup -> auto Free Trial (3 days) -> redirect to dashboard or pricing
"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
  const plan = searchParams?.get("plan"); // optional: redirect to pricing after signup

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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

      // Store first API key for welcome banner
      if (typeof window !== "undefined" && data?.apiKey?.key) {
        try { sessionStorage.setItem("cortex_first_key", JSON.stringify(data.apiKey)); } catch {}
      }

      // If user came from a plan selection, go to pricing to complete purchase
      if (plan && plan !== "free") {
        router.push("/pricing");
      } else {
        router.push("/dashboard?welcome=1");
      }
    } catch (err) {
      setError(err?.message || String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 mb-4">
            <span className="text-2xl font-black">C</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Daftar Cortex AI</h1>
          <p className="text-sm text-zinc-400 mt-1">Buat akun gratis — langsung dapat Free Trial 3 hari</p>
        </div>

        <form onSubmit={onSubmit} className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-6 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Email</label>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              placeholder="nama@email.com"
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
            {submitting ? "Membuat akun..." : "Daftar Gratis"}
          </button>

          <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
            <div className="flex items-start gap-2">
              <span className="text-green-400 text-xs mt-0.5">&#10003;</span>
              <div className="text-xs text-zinc-400">
                <strong className="text-zinc-300">Free Trial 3 hari</strong> — 300 request/hari, akses semua model AI, termasuk Telegram bot.
                Upgrade ke Premium kapan saja.
              </div>
            </div>
          </div>
        </form>

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
