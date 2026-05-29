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

      {/* Telegram Bot Setup */}
      <TelegramSetupCard
        endpointUrl={endpointUrl}
        copy={copy}
        copying={copying}
        isWelcome={isWelcome}
        onConfigured={load}
      />

      {/* SSH Access */}
      {data.ssh && (
        <SshAccessCard ssh={data.ssh} copy={copy} copying={copying} />
      )}

      {/* Container Resources */}
      {data.ssh?.container && (
        <ContainerResourcesCard container={data.ssh.container} />
      )}
    </div>
  );
}

function TelegramSetupCard({ endpointUrl, copy, copying, isWelcome, onConfigured }) {
  const [tg, setTg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [botToken, setBotToken] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetch("/api/customer/telegram")
      .then((r) => r.json())
      .then((d) => { setTg(d); setLoading(false); if (isWelcome && !d.configured) setShowForm(true); })
      .catch(() => setLoading(false));
  }, [isWelcome]);

  const save = async () => {
    setError(""); setSuccess(""); setSaving(true);
    try {
      const res = await fetch("/api/customer/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, ownerId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setSaving(false); return; }
      setSuccess(data.message);
      setTg({ configured: true, botUsername: data.botUsername, ownerId, status: "configured" });
      setShowForm(false);
      setBotToken(""); setOwnerId("");
      setSaving(false);
      onConfigured?.();
    } catch (e) { setError(e.message); setSaving(false); }
  };

  const remove = async () => {
    if (!confirm("Remove Telegram bot configuration?")) return;
    await fetch("/api/customer/telegram", { method: "DELETE" });
    setTg(null); setShowForm(false); setSuccess("");
  };

  if (loading) return null;

  // Bot configured — show status
  if (tg?.configured && !showForm) {
    return (
      <section className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">Telegram Bot</h2>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(true)} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800">Reconfigure</button>
            <button onClick={remove} className="rounded border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-900/30">Remove</button>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-md bg-zinc-950 border border-zinc-800 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/20 text-lg">🤖</div>
          <div className="flex-1">
            <div className="text-sm font-medium text-zinc-200">@{tg.botUsername || "your-bot"}</div>
            <div className="text-[10px] text-zinc-500">Owner ID: {tg.ownerId} · Status: <span className={tg.status === "active" ? "text-green-400" : "text-yellow-400"}>{tg.status}</span></div>
          </div>
          <a href={`https://t.me/${tg.botUsername}`} target="_blank" rel="noopener" className="rounded bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-medium">Open in Telegram</a>
        </div>
        {success && <div className="mt-2 text-xs text-green-400">{success}</div>}
      </section>
    );
  }

  // Setup form
  return (
    <section className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-6">
      <h2 className="mb-1 text-sm font-semibold text-zinc-300">
        {isWelcome ? "🚀 Setup Telegram Bot" : "Telegram Bot Setup"}
      </h2>
      <p className="mb-4 text-xs text-zinc-500">
        Connect a Telegram bot so you can chat with your AI assistant directly from Telegram.
      </p>

      {/* Step 1 */}
      <div className="mb-4 rounded-md bg-zinc-950 border border-zinc-800 p-4">
        <div className="mb-2 text-xs font-semibold text-zinc-300">Step 1: Create bot via @BotFather</div>
        <ol className="space-y-1 text-xs text-zinc-400 list-decimal list-inside">
          <li>Open Telegram, search <strong>@BotFather</strong></li>
          <li>Send <code className="bg-zinc-800 px-1 rounded">/newbot</code></li>
          <li>Choose a name and username for your bot</li>
          <li>Copy the <strong>Bot Token</strong> (looks like <code className="bg-zinc-800 px-1 rounded">7123456789:AAF8_xxx...</code>)</li>
        </ol>
      </div>

      {/* Step 2 */}
      <div className="mb-4 rounded-md bg-zinc-950 border border-zinc-800 p-4">
        <div className="mb-2 text-xs font-semibold text-zinc-300">Step 2: Get your Chat ID</div>
        <ol className="space-y-1 text-xs text-zinc-400 list-decimal list-inside">
          <li>Open Telegram, search <strong>@userinfobot</strong></li>
          <li>Send any message</li>
          <li>Copy the <strong>Id</strong> number (e.g. <code className="bg-zinc-800 px-1 rounded">1433257992</code>)</li>
        </ol>
      </div>

      {/* Step 3: Input */}
      <div className="mb-3 text-xs font-semibold text-zinc-300">Step 3: Connect your bot</div>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[10px] text-zinc-500">Bot Token</label>
          <input
            type="text"
            placeholder="7123456789:AAF8_xxx-xxxxxxxxxxxxxxxxxxxxxxxx"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            disabled={saving}
            className="w-full rounded-md bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-zinc-500">Your Telegram Chat ID</label>
          <input
            type="text"
            placeholder="1433257992"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            disabled={saving}
            className="w-full rounded-md bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
      </div>

      {error && <div className="mt-3 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">{error}</div>}
      {success && <div className="mt-3 rounded-md bg-green-500/10 border border-green-500/30 px-3 py-2 text-xs text-green-400">{success}</div>}

      <div className="mt-4 flex gap-2">
        <button
          onClick={save}
          disabled={saving || !botToken || !ownerId}
          className="rounded-md bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition"
        >
          {saving ? "Verifying..." : "Activate Bot"}
        </button>
        {!isWelcome && tg?.configured && (
          <button onClick={() => setShowForm(false)} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-900">Cancel</button>
        )}
      </div>

      <div className="mt-4 border-t border-zinc-800 pt-4">
        <div className="text-[10px] text-zinc-600">
          Need help? Read the <a href="https://docs.cortex-ai.my.id/setup/telegram-bot" target="_blank" className="text-orange-500 hover:underline">setup guide</a> with screenshots.
        </div>
      </div>
    </section>
  );
}

function SshAccessCard({ ssh, copy, copying }) {
  const sshCmd = ssh.port
    ? `ssh -p ${ssh.port} ${ssh.user}@${ssh.host}`
    : `ssh ${ssh.user}@${ssh.host}`;

  return (
    <section className="mt-4 rounded-xl bg-zinc-900/80 border border-zinc-800 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">SSH Access</h2>
        <span className="text-[10px] text-zinc-500">Container: {ssh.container}</span>
      </div>

      <div className="space-y-3">
        {/* SSH Command */}
        <div>
          <label className="mb-1 block text-[10px] text-zinc-500">Connect Command</label>
          <div className="flex items-center gap-2 rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 font-mono text-sm">
            <code className="flex-1 truncate text-zinc-200">{sshCmd}</code>
            <button
              onClick={() => copy(sshCmd, "ssh-cmd")}
              className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              {copying === "ssh-cmd" ? "✓" : "Copy"}
            </button>
          </div>
        </div>

        {/* Password */}
        <div>
          <label className="mb-1 block text-[10px] text-zinc-500">Password</label>
          <div className="flex items-center gap-2 rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 font-mono text-sm">
            <code className="flex-1 text-zinc-200">{ssh.password}</code>
            <button
              onClick={() => copy(ssh.password, "ssh-pass")}
              className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              {copying === "ssh-pass" ? "✓" : "Copy"}
            </button>
          </div>
        </div>

        {ssh.port && (
          <div className="text-[10px] text-zinc-600">
            Port: {ssh.port} · User: {ssh.user} · Host: {ssh.host}
          </div>
        )}
      </div>
    </section>
  );
}

function ContainerResourcesCard({ container }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchStats = () => {
      fetch("/api/customer/container-stats")
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setStats(d); else setError(true); })
        .catch(() => setError(true));
    };
    fetchStats();
    const interval = setInterval(fetchStats, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (error || !stats) return null;

  const diskPct = stats.disk?.pct ? parseInt(stats.disk.pct) : 0;
  const diskColor = diskPct >= 90 ? "bg-red-500" : diskPct >= 70 ? "bg-yellow-500" : "bg-green-500";

  return (
    <section className="mt-4 rounded-xl bg-zinc-900/80 border border-zinc-800 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">Container Resources</h2>
        <span className="text-[10px] text-zinc-600">Updated: {stats.updatedAt ? new Date(stats.updatedAt).toLocaleTimeString() : "-"}</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* Memory */}
        <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Memory</div>
          <div className="text-lg font-semibold text-blue-400">{stats.memory || "-"}</div>
        </div>

        {/* CPU */}
        <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">CPU Time</div>
          <div className="text-lg font-semibold text-green-400">{stats.cpuSeconds != null ? `${stats.cpuSeconds}s` : "-"}</div>
          <div className="text-[10px] text-zinc-600">{stats.processes || 0} processes</div>
        </div>

        {/* Disk */}
        <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Disk</div>
          <div className="text-lg font-semibold text-yellow-400">{stats.disk?.used || "-"} / {stats.disk?.total || "-"}</div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div className={`h-full ${diskColor} transition-all`} style={{ width: `${Math.min(100, diskPct)}%` }} />
          </div>
        </div>
      </div>
    </section>
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
