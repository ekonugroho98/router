// ADDON: saas-mt — Public claim page (customer enters email → gets activation code)
"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function ClaimPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-zinc-400">Loading...</div>}>
      <ClaimInner />
    </Suspense>
  );
}

function ClaimInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams?.get("token") || "";

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-6 py-4 text-sm text-red-400">
          Link tidak valid — token tidak ditemukan.
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/public/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal claim");
        setSubmitting(false);
        return;
      }
      setResult(data);
      setSubmitting(false);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const goToActivate = () => {
    router.push(`/customer/activate?code=${result.code}`);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 mb-4">
            <span className="text-3xl">🎁</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Claim Hermes Agent</h1>
          <p className="text-sm text-zinc-400 mt-1">Masukkan email untuk mendapatkan kode aktivasi</p>
        </div>

        {result ? (
          /* Success */
          <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-6 text-center">
            <div className="text-4xl mb-3">🎉</div>
            <h2 className="text-lg font-semibold text-green-400 mb-2">Berhasil!</h2>
            <p className="text-sm text-zinc-400 mb-4">
              Kode aktivasi kamu ({result.plan}, {result.durationDays} hari):
            </p>
            <div className="rounded-lg bg-zinc-950 border border-green-500/30 p-3 mb-4">
              <code className="text-lg font-mono text-green-400">{result.code}</code>
            </div>
            <button
              onClick={goToActivate}
              className="w-full rounded-lg bg-orange-600 hover:bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition"
            >
              Aktivasi Sekarang →
            </button>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleSubmit} className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-6">
            <div className="mb-4">
              <label className="block text-xs text-zinc-500 mb-1">Email</label>
              <input
                type="email"
                required
                placeholder="nama@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <p className="mt-1 text-[10px] text-zinc-600">Satu email hanya bisa claim 1 kali</p>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !email}
              className="w-full rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold text-white transition"
            >
              {submitting ? "Memproses..." : "Claim Kode Aktivasi"}
            </button>

            <p className="mt-4 text-center text-[10px] text-zinc-600">
              Sudah punya kode? <a href="/customer/activate" className="text-orange-500 hover:underline">Aktivasi di sini</a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
