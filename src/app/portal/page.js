// Cortex AI — Customer portal landing page
// Served at cortex-ai.my.id via domain-based routing
"use client";

import { useRouter } from "next/navigation";

export default function PortalLanding() {
  const router = useRouter();

  return (
    <div className="relative min-h-screen text-white font-sans antialiased overflow-x-hidden selection:bg-orange-500 selection:text-white">
      {/* Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-zinc-950">
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: "linear-gradient(to right, #f97815 1px, transparent 1px), linear-gradient(to bottom, #f97815 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-orange-500/10 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: "8s" }} />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-500/8 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: "12s" }} />
      </div>

      <div className="relative z-10">
        {/* Navbar */}
        <nav className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center font-black text-sm">
              C
            </div>
            <span className="text-lg font-bold tracking-tight">Cortex AI</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/login")}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 transition"
            >
              Masuk
            </button>
            <button
              onClick={() => router.push("/register")}
              className="rounded-lg bg-orange-600 hover:bg-orange-500 px-4 py-2 text-sm font-medium text-white transition"
            >
              Daftar Gratis
            </button>
          </div>
        </nav>

        {/* Hero */}
        <section className="px-6 pt-20 pb-16 max-w-4xl mx-auto text-center">
          <div className="inline-block rounded-full bg-orange-500/10 border border-orange-500/20 px-4 py-1.5 text-xs font-medium text-orange-400 mb-6">
            AI Assistant pribadi untuk semua kebutuhan kamu
          </div>
          <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6">
            Asisten AI Pribadi
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600">
              di Telegram Kamu
            </span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto mb-10">
            Hermes AI Agent — akses ke semua model AI terbaik (GPT-4, Claude, Gemini, DeepSeek) langsung dari Telegram.
            Coding, riset, analisis, semuanya bisa.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => router.push("/register")}
              className="w-full sm:w-auto h-14 px-10 rounded-xl bg-orange-600 hover:bg-orange-500 text-lg font-bold transition shadow-lg shadow-orange-600/20"
            >
              Mulai Gratis 3 Hari
            </button>
            <button
              onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}
              className="w-full sm:w-auto h-14 px-10 rounded-xl border border-zinc-700 hover:bg-zinc-900 text-lg font-medium transition"
            >
              Lihat Harga
            </button>
          </div>
          <p className="mt-4 text-xs text-zinc-600">Tanpa kartu kredit. Langsung aktif.</p>
        </section>

        {/* Features */}
        <section className="px-6 py-20 max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">Kenapa Cortex AI?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: "M",
                title: "Multi-Model",
                desc: "Akses GPT-4o, Claude Sonnet, Gemini Pro, DeepSeek, dan 100+ model AI lainnya dalam satu platform.",
              },
              {
                icon: "T",
                title: "Telegram Bot",
                desc: "Chat langsung dari Telegram. Tidak perlu buka website atau install app baru.",
              },
              {
                icon: "S",
                title: "SSH + Container",
                desc: "Setiap customer dapat container Linux sendiri dengan SSH access. Install tools sesuka hati.",
              },
            ].map((f, i) => (
              <div key={i} className="rounded-2xl bg-zinc-900/60 border border-zinc-800 p-6">
                <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400 font-bold text-xl mb-4">
                  {f.icon}
                </div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-zinc-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section className="px-6 py-20 max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">Cara Kerja</h2>
          <div className="space-y-8">
            {[
              { step: "1", title: "Daftar Akun", desc: "Buat akun gratis dalam 30 detik. Langsung dapat API key dan Free Trial 3 hari." },
              { step: "2", title: "Setup Telegram Bot", desc: "Buat bot di @BotFather, masukkan token di dashboard. Selesai, bot kamu siap pakai." },
              { step: "3", title: "Mulai Chat", desc: "Kirim pesan ke bot kamu di Telegram. Hermes akan menjawab menggunakan AI model terbaik." },
            ].map((s, i) => (
              <div key={i} className="flex gap-5 items-start">
                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-orange-600 flex items-center justify-center text-lg font-bold">
                  {s.step}
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-1">{s.title}</h3>
                  <p className="text-sm text-zinc-400">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="px-6 py-20 max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-3">Harga</h2>
          <p className="text-center text-zinc-400 mb-12">Mulai gratis, upgrade kapan saja.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Free Trial */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h3 className="text-lg font-bold mb-1">Free Trial</h3>
              <p className="text-xs text-zinc-500 mb-4">Coba dulu, tanpa bayar</p>
              <div className="mb-4">
                <span className="text-3xl font-black">Gratis</span>
                <span className="text-sm text-zinc-500 ml-1">/ 3 hari</span>
              </div>
              <ul className="space-y-2 mb-6 text-sm text-zinc-400">
                <li>&#10003; 300 request/hari</li>
                <li>&#10003; Semua model AI</li>
                <li>&#10003; Telegram bot</li>
              </ul>
              <button
                onClick={() => router.push("/register")}
                className="w-full rounded-xl border border-zinc-700 hover:bg-zinc-800 py-3 text-sm font-medium transition"
              >
                Daftar Gratis
              </button>
            </div>

            {/* Daily */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h3 className="text-lg font-bold mb-1">Daily</h3>
              <p className="text-xs text-zinc-500 mb-4">Bayar harian, fleksibel</p>
              <div className="mb-4">
                <span className="text-3xl font-black">Rp 2rb</span>
                <span className="text-sm text-zinc-500 ml-1">/ hari</span>
              </div>
              <ul className="space-y-2 mb-6 text-sm text-zinc-400">
                <li>&#10003; 300 request/hari</li>
                <li>&#10003; Semua model AI</li>
                <li>&#10003; Telegram bot</li>
              </ul>
              <button
                onClick={() => router.push("/register")}
                className="w-full rounded-xl border border-zinc-700 hover:bg-zinc-800 py-3 text-sm font-medium transition"
              >
                Daftar & Beli
              </button>
            </div>

            {/* Premium */}
            <div className="relative rounded-2xl border-2 border-orange-500 bg-orange-500/5 p-6">
              <span className="absolute -top-3 left-4 rounded-full bg-orange-600 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                Popular
              </span>
              <h3 className="text-lg font-bold mb-1">Premium</h3>
              <p className="text-xs text-zinc-500 mb-4">Untuk power user</p>
              <div className="mb-4">
                <span className="text-sm text-zinc-600 line-through mr-2">Rp 149rb</span>
                <span className="text-3xl font-black">Rp 49rb</span>
                <span className="text-sm text-zinc-500 ml-1">/ 30 hari</span>
              </div>
              <ul className="space-y-2 mb-6 text-sm text-zinc-300">
                <li>&#10003; 1.000 request/hari</li>
                <li>&#10003; Semua model AI</li>
                <li>&#10003; Telegram bot</li>
                <li>&#10003; SSH access</li>
                <li>&#10003; Priority support</li>
              </ul>
              <button
                onClick={() => router.push("/register")}
                className="w-full rounded-xl bg-orange-600 hover:bg-orange-500 py-3 text-sm font-bold transition shadow-lg shadow-orange-600/20"
              >
                Daftar & Beli
              </button>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="px-6 py-20 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">FAQ</h2>
          <div className="space-y-6">
            {[
              { q: "Apa itu Cortex AI?", a: "Cortex AI adalah platform yang menyediakan AI assistant (Hermes) yang bisa diakses via Telegram. Kamu bisa chat dengan model AI terbaik seperti GPT-4, Claude, Gemini, dan lainnya." },
              { q: "Bagaimana cara bayar?", a: "Pembayaran melalui QRIS (GoPay, OVO, Dana, dll) atau Transfer Bank Virtual Account (BRI, BNI, CIMB, Permata). Diproses oleh Pakasir yang terlisensi Bank Indonesia." },
              { q: "Apakah bisa perpanjang plan?", a: "Bisa! Kalau plan masih aktif, durasi baru akan ditambahkan di atas sisa waktu yang ada. Tidak ada yang hilang." },
              { q: "Model AI apa saja yang tersedia?", a: "100+ model termasuk GPT-4o, GPT-4o-mini, Claude Sonnet/Opus, Gemini Pro, DeepSeek, Qwen, dan banyak lagi." },
            ].map((faq, i) => (
              <div key={i} className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-5">
                <h3 className="text-sm font-semibold mb-2">{faq.q}</h3>
                <p className="text-sm text-zinc-400">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-800 px-6 py-8">
          <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center font-black text-xs">C</div>
              <span className="text-sm font-semibold">Cortex AI</span>
            </div>
            <div className="flex gap-6 text-xs text-zinc-500">
              <a href="/login" className="hover:text-orange-400">Masuk</a>
              <a href="/register" className="hover:text-orange-400">Daftar</a>
              <a href="/pricing" className="hover:text-orange-400">Harga</a>
              <a href="https://docs.cortex-ai.my.id" target="_blank" rel="noopener" className="hover:text-orange-400">Docs</a>
            </div>
            <p className="text-[10px] text-zinc-600">&copy; 2025 Cortex AI. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
