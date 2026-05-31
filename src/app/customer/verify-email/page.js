// ADDON: saas-mt — Email verification page (OTP input)
"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { portalLink } from "@/lib/customer/portalLinks";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-zinc-400">Loading...</div>}>
      <VerifyInner />
    </Suspense>
  );
}

function VerifyInner() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");

  // Load customer email
  useEffect(() => {
    fetch("/api/customer/me")
      .then(r => {
        if (r.status === 401) { router.replace(portalLink("/customer/login")); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (data.customer?.emailVerified) {
          router.replace(portalLink("/customer/dashboard"));
          return;
        }
        setEmail(data.customer?.email || "");
      })
      .catch(() => {});
  }, [router]);

  const sendCode = async () => {
    setError(""); setSuccess(""); setSending(true);
    try {
      const res = await fetch("/api/customer/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const data = await res.json();
      if (data.verified) { router.replace(portalLink("/customer/dashboard")); return; }
      if (!res.ok) { setError(data.error); setSending(false); return; }
      setSuccess(data.message);
      setSent(true);
      setSending(false);
    } catch (e) { setError(e.message); setSending(false); }
  };

  const verify = async () => {
    setError(""); setSuccess(""); setVerifying(true);
    try {
      const res = await fetch("/api/customer/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setVerifying(false); return; }
      if (data.verified) {
        setSuccess("Email berhasil diverifikasi! Redirecting...");
        setTimeout(() => router.replace(portalLink("/customer/dashboard") + "?welcome=1"), 1500);
      }
    } catch (e) { setError(e.message); setVerifying(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 mb-4">
            <span className="text-2xl font-black">C</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Verifikasi Email</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Verifikasi email kamu untuk mengaktifkan akun
          </p>
          {email && (
            <p className="text-xs text-zinc-500 mt-2">{email}</p>
          )}
        </div>

        <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-6 space-y-4">
          {!sent ? (
            <>
              <p className="text-sm text-zinc-400">
                Klik tombol di bawah untuk mengirim kode verifikasi ke email kamu.
              </p>
              <button
                onClick={sendCode}
                disabled={sending}
                className="w-full rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 py-3 text-sm font-semibold text-white transition"
              >
                {sending ? "Mengirim..." : "Kirim Kode Verifikasi"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-400">
                Masukkan kode 6 digit yang dikirim ke email kamu.
              </p>
              <input
                type="text"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-700 px-4 py-4 text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-orange-500"
                autoFocus
              />
              <button
                onClick={verify}
                disabled={verifying || code.length !== 6}
                className="w-full rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 py-3 text-sm font-semibold text-white transition"
              >
                {verifying ? "Memverifikasi..." : "Verifikasi"}
              </button>
              <button
                onClick={sendCode}
                disabled={sending}
                className="w-full rounded-xl border border-zinc-700 hover:bg-zinc-800 py-2 text-xs text-zinc-400 transition"
              >
                {sending ? "Mengirim..." : "Kirim ulang kode"}
              </button>
            </>
          )}

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-xs text-red-400">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-xl bg-green-500/10 border border-green-500/30 px-4 py-3 text-xs text-green-400">
              {success}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
