// ADDON: saas-mt — Customer activation page (redeem code → create account + setup bot)
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CustomerActivatePage() {
  const router = useRouter();
  const [step, setStep] = useState(1); // 1=code, 2=account, 3=telegram, 4=done
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [botToken, setBotToken] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { apiKey, botUsername, expiresAt }

  const formatCode = (val) => {
    const clean = val.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    return clean;
  };

  const activateCode = async () => {
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/customer/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setSubmitting(false); return; }
      setResult(data); // { plan, durationDays, quotaDailyLimit }
      setStep(2);
      setSubmitting(false);
    } catch (e) { setError(e.message); setSubmitting(false); }
  };

  const createAccount = async () => {
    setError(""); setSubmitting(true);
    if (password.length < 8) { setError("Password minimal 8 karakter"); setSubmitting(false); return; }
    try {
      const res = await fetch("/api/customer/activate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          email, password,
          displayName: displayName || null,
          botToken: botToken || null,
          ownerId: ownerId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setSubmitting(false); return; }
      setResult(data);
      if (typeof window !== "undefined" && data?.apiKey?.key) {
        try { sessionStorage.setItem("cortex_first_key", JSON.stringify(data.apiKey)); } catch {}
      }
      setStep(4);
      setSubmitting(false);
    } catch (e) { setError(e.message); setSubmitting(false); }
  };

  const inputClass = "w-full rounded-md bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500";

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-xl bg-zinc-900/80 border border-zinc-800 p-8 shadow-2xl backdrop-blur">

        {/* Progress */}
        <div className="mb-6 flex items-center gap-2 text-xs text-zinc-500">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center gap-1">
              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${step >= s ? "bg-orange-600 text-white" : "bg-zinc-800 text-zinc-500"}`}>{s}</div>
              {s < 4 && <div className={`h-px w-6 ${step > s ? "bg-orange-600" : "bg-zinc-800"}`} />}
            </div>
          ))}
          <span className="ml-2">
            {step === 1 && "Masukkan Kode"}
            {step === 2 && "Buat Akun"}
            {step === 3 && "Setup Telegram"}
            {step === 4 && "Selesai!"}
          </span>
        </div>

        {/* Step 1: Enter Code */}
        {step === 1 && (
          <div>
            <h1 className="mb-1 text-xl font-bold">Aktivasi Cortex AI</h1>
            <p className="mb-6 text-sm text-zinc-400">Masukkan kode aktivasi yang kamu dapat dari pembelian.</p>
            <div className="mb-4">
              <label className="mb-1 block text-xs text-zinc-400">Kode Aktivasi</label>
              <input
                type="text"
                placeholder="CORTEX-XXXX-XXXX"
                value={code}
                onChange={(e) => setCode(formatCode(e.target.value))}
                disabled={submitting}
                autoFocus
                className={`${inputClass} font-mono text-center text-lg tracking-widest`}
              />
            </div>
            {error && <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">{error}</div>}
            <button onClick={activateCode} disabled={submitting || !code} className="w-full rounded-md bg-orange-600 hover:bg-orange-500 disabled:opacity-50 py-2 text-sm font-medium transition">
              {submitting ? "Memverifikasi..." : "Verifikasi Kode"}
            </button>
          </div>
        )}

        {/* Step 2: Create Account */}
        {step === 2 && (
          <div>
            <h1 className="mb-1 text-xl font-bold">Buat Akun</h1>
            <div className="mb-4 rounded-md bg-green-500/10 border border-green-500/30 px-3 py-2 text-xs text-green-400">
              Kode valid! Plan: <strong>{result?.plan}</strong> · Aktif: <strong>{result?.durationDays} hari</strong> · Quota: <strong>{result?.quotaDailyLimit} req/hari</strong>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Nama <span className="text-zinc-600">(optional)</span></label>
                <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
                <p className="mt-1 text-[10px] text-zinc-500">Minimal 8 karakter</p>
              </div>
            </div>

            {/* Telegram setup (inline, not separate step) */}
            <div className="mb-4 rounded-md bg-zinc-950 border border-zinc-800 p-4">
              <div className="mb-2 text-xs font-semibold text-zinc-300">Setup Telegram Bot (optional, bisa nanti)</div>
              <div className="mb-2 text-[10px] text-zinc-500">
                Buat bot di <strong>@BotFather</strong> (kirim /newbot), lalu paste token. Dapatkan Chat ID dari <strong>@userinfobot</strong>.
                <a href="https://docs.cortex-ai.my.id/setup/telegram-bot" target="_blank" className="ml-1 text-orange-500 hover:underline">Panduan lengkap</a>
              </div>
              <div className="space-y-2">
                <input type="text" placeholder="Bot Token: 7123456789:AAF8_xxx..." value={botToken} onChange={(e) => setBotToken(e.target.value)} className={`${inputClass} font-mono text-xs`} />
                <input type="text" placeholder="Chat ID: 1433257992" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={`${inputClass} font-mono text-xs`} />
              </div>
            </div>

            {error && <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">{error}</div>}
            <button onClick={createAccount} disabled={submitting || !email || !password} className="w-full rounded-md bg-orange-600 hover:bg-orange-500 disabled:opacity-50 py-2 text-sm font-medium transition">
              {submitting ? "Membuat akun..." : "Buat Akun & Aktifkan"}
            </button>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 4 && (
          <div>
            <div className="mb-4 text-center">
              <div className="text-4xl mb-2">🎉</div>
              <h1 className="text-xl font-bold">Akun Aktif!</h1>
            </div>
            <div className="space-y-3 mb-6">
              <div className="rounded-md bg-zinc-950 border border-zinc-800 p-3">
                <div className="text-[10px] text-zinc-500">Plan</div>
                <div className="text-sm font-semibold">{result?.customer?.plan} · {result?.durationDays} hari</div>
              </div>
              <div className="rounded-md bg-zinc-950 border border-zinc-800 p-3">
                <div className="text-[10px] text-zinc-500">API Key</div>
                <code className="text-xs font-mono text-green-400 break-all">{result?.apiKey?.key}</code>
              </div>
              {result?.botUsername && (
                <div className="rounded-md bg-zinc-950 border border-zinc-800 p-3">
                  <div className="text-[10px] text-zinc-500">Telegram Bot</div>
                  <div className="text-sm">@{result.botUsername} · <a href={`https://t.me/${result.botUsername}`} target="_blank" className="text-orange-500 hover:underline">Buka di Telegram</a></div>
                </div>
              )}
              <div className="rounded-md bg-zinc-950 border border-zinc-800 p-3">
                <div className="text-[10px] text-zinc-500">Berlaku sampai</div>
                <div className="text-sm">{result?.expiresAt ? new Date(result.expiresAt).toLocaleDateString("id-ID", { dateStyle: "full" }) : "-"}</div>
              </div>
            </div>
            <button onClick={() => router.push("/customer/dashboard?welcome=1")} className="w-full rounded-md bg-orange-600 hover:bg-orange-500 py-2 text-sm font-medium transition">
              Buka Dashboard
            </button>
          </div>
        )}

        {step === 1 && (
          <p className="mt-6 text-center text-xs text-zinc-500">
            Sudah punya akun?{" "}
            <a href="/customer/login" className="text-orange-500 hover:underline">Login</a>
          </p>
        )}
      </div>
    </div>
  );
}
