// ADDON: saas-mt — Customer login page
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CustomerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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
      router.push("/customer/dashboard");
    } catch (err) {
      setError(err?.message || String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl bg-zinc-900/80 border border-zinc-800 p-8 shadow-2xl backdrop-blur">
        <h1 className="mb-1 text-2xl font-bold">Welcome back</h1>
        <p className="mb-6 text-sm text-zinc-400">Sign in to your Cortex AI Router account</p>

        <form onSubmit={onSubmit} className="space-y-4">
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
              className="w-full rounded-md bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
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
              className="w-full rounded-md bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed py-2 text-sm font-medium transition"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-500">
          Don&apos;t have an account?{" "}
          <a href="/customer/signup" className="text-orange-500 hover:underline">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}
