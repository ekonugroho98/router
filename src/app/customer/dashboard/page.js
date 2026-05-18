// ADDON: saas-mt — Customer dashboard (read-only usage view + API key management)
"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function CustomerDashboardPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-zinc-400">Loading...</div>}>
      <CustomerDashboardInner />
    </Suspense>
  );
}

function CustomerDashboardInner() {
  const router = useRouter();
  const search = useSearchParams();
  const isWelcome = search?.get("welcome") === "1";

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revealedKey, setRevealedKey] = useState(null); // {id, key} — shown once
  const [copying, setCopying] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/customer/me", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/customer/login");
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || `HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      setData(json);
      setLoading(false);
    } catch (e) {
      setError(e?.message || String(e));
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
    // If first-time signup, pull stored key from sessionStorage
    if (isWelcome && typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem("cortex_first_key");
        if (raw) {
          setRevealedKey(JSON.parse(raw));
          sessionStorage.removeItem("cortex_first_key");
        }
      } catch {}
    }
  }, [load, isWelcome]);

  const reveal = async (id) => {
    try {
      const res = await fetch(`/api/customer/api-keys/${id}/reveal`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || `HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      setRevealedKey(json);
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

  const regenerate = async (id) => {
    if (!confirm("Regenerate API key? The old key will stop working immediately.")) return;
    try {
      const res = await fetch(`/api/customer/api-keys/${id}/regenerate`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || `HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      setRevealedKey(json);
      load(); // refresh mask + lastUsedAt
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

  const copy = async (text, label) => {
    setCopying(label);
    try {
      await navigator.clipboard.writeText(text);
      setTimeout(() => setCopying(null), 1500);
    } catch {
      setCopying(null);
    }
  };

  const logout = async () => {
    await fetch("/api/customer/logout", { method: "POST" });
    router.replace("/customer/login");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-md bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { customer, apiKeys, usage, quotas, endpoint } = data;
  const primaryKey = apiKeys?.[0];
  const endpointUrl = endpoint?.startsWith("http") ? endpoint : `${window.location.origin}${endpoint || "/api/v1"}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Welcome, {customer.displayName || customer.email}</h1>
          <p className="text-xs text-zinc-500 mt-1">Plan: {customer.plan} · Member since {new Date(customer.createdAt).toLocaleDateString()}</p>
        </div>
        <button
          onClick={logout}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900"
        >
          Sign out
        </button>
      </header>

      {/* Welcome banner for new signups */}
      {isWelcome && revealedKey && (
        <div className="mb-6 rounded-lg bg-green-500/10 border border-green-500/30 p-4">
          <div className="text-sm font-semibold text-green-400">🎉 Account created!</div>
          <div className="mt-1 text-xs text-zinc-300">
            Your API key has been generated. <strong>Copy it now</strong> — it won&apos;t be shown again
            (you can always regenerate from below).
          </div>
        </div>
      )}

      {/* API endpoint card */}
      <section className="mb-4 rounded-xl bg-zinc-900/80 border border-zinc-800 p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">API Endpoint</h2>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 font-mono text-sm">
          <code className="flex-1 truncate text-zinc-200">{endpointUrl}</code>
          <button
            onClick={() => copy(endpointUrl, "endpoint")}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            {copying === "endpoint" ? "✓" : "Copy"}
          </button>
        </div>
      </section>

      {/* API key card */}
      <section className="mb-4 rounded-xl bg-zinc-900/80 border border-zinc-800 p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">API Key</h2>
          {primaryKey && (
            <div className="flex gap-2">
              <button
                onClick={() => reveal(primaryKey.id)}
                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                Reveal
              </button>
              <button
                onClick={() => regenerate(primaryKey.id)}
                className="rounded border border-orange-700 px-2 py-1 text-xs text-orange-400 hover:bg-orange-900/30"
              >
                Regenerate
              </button>
            </div>
          )}
        </div>

        {revealedKey ? (
          <div className="rounded-md bg-green-500/10 border border-green-500/30 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-green-400">
              ⚠️ Copy now — won&apos;t be shown again
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100">
                {revealedKey.key}
              </code>
              <button
                onClick={() => copy(revealedKey.key, "key")}
                className="rounded bg-green-600 hover:bg-green-500 px-3 py-1.5 text-xs font-medium"
              >
                {copying === "key" ? "✓ Copied" : "Copy"}
              </button>
            </div>
            <button
              onClick={() => setRevealedKey(null)}
              className="mt-2 text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              Hide
            </button>
          </div>
        ) : primaryKey ? (
          <div className="flex items-center gap-2 rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 font-mono text-sm">
            <code className="flex-1 text-zinc-500">{primaryKey.keyMasked}</code>
            <span className="text-[10px] text-zinc-600">Last used: {primaryKey.lastUsedAt ? new Date(primaryKey.lastUsedAt).toLocaleString() : "never"}</span>
          </div>
        ) : (
          <div className="text-xs text-zinc-500">No API key yet.</div>
        )}
      </section>

      {/* Usage quotas */}
      <section className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <QuotaCard
          label="Usage Today"
          used={quotas.daily.used}
          limit={quotas.daily.limit}
          percent={quotas.daily.percent}
          tokens={usage.today.promptTokens + usage.today.completionTokens}
        />
        <QuotaCard
          label="Usage This Month"
          used={quotas.monthly.used}
          limit={quotas.monthly.limit}
          percent={quotas.monthly.percent}
          tokens={usage.month.promptTokens + usage.month.completionTokens}
        />
      </section>

      {/* Quick setup */}
      <section className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-6">
        <h2 className="mb-2 text-sm font-semibold text-zinc-300">Quick Setup — Hermes Telegram Bot</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Run this on your VPS to auto-install Hermes connected to your API key:
        </p>
        <div className="flex items-center gap-2 rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 font-mono text-xs">
          <code className="flex-1 truncate text-zinc-300">
            curl -fsSL {endpointUrl.replace(/\/api\/v1$/, "")}/install-hermes.sh | bash
          </code>
          <button
            onClick={() => copy(`curl -fsSL ${endpointUrl.replace(/\/api\/v1$/, "")}/install-hermes.sh | bash`, "install")}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            {copying === "install" ? "✓" : "Copy"}
          </button>
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">Coming soon — script in active development.</p>
      </section>
    </div>
  );
}

function QuotaCard({ label, used, limit, percent, tokens }) {
  const pct = limit > 0 ? percent : 0;
  const isUnlimited = limit === 0;
  const isNearLimit = pct >= 80;
  const isOverLimit = pct >= 100;
  const barColor = isOverLimit ? "bg-red-500" : isNearLimit ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-6">
      <div className="mb-3 text-xs text-zinc-400">{label}</div>
      <div className="mb-2 text-2xl font-semibold">
        {used.toLocaleString()}
        <span className="ml-1 text-sm text-zinc-500">
          / {isUnlimited ? "∞" : limit.toLocaleString()} req
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
      <div className="mt-2 text-[10px] text-zinc-600">
        {tokens.toLocaleString()} tokens used
      </div>
    </div>
  );
}
