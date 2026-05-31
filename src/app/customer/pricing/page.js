// ADDON: saas-mt — Pricing page with Pak Kasir payment
"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { portalLink } from "@/lib/customer/portalLinks";

const PLANS = [
  {
    id: "daily",
    name: "Daily",
    price: 2000,
    durationDays: 1,
    quota: "300 req/hari",
    description: "Cocok untuk coba-coba atau kebutuhan sesekali",
    features: ["1 hari akses penuh", "300 request/hari", "Semua model AI", "Telegram bot support"],
  },
  {
    id: "premium",
    name: "Premium",
    price: 49000,
    originalPrice: 149000,
    durationDays: 30,
    quota: "1.000 req/hari",
    description: "Untuk penggunaan harian yang serius",
    popular: true,
    features: ["30 hari akses penuh", "1.000 request/hari", "Semua model AI", "Telegram bot support", "SSH access ke container", "Priority support"],
  },
];

const PAYMENT_METHODS = [
  { code: "qris", label: "QRIS", icon: "QR", desc: "Scan QR — GoPay, OVO, Dana, dll", fee: "0.7%" },
  { code: "bri_va", label: "BRI VA", icon: "BRI", desc: "Virtual Account BRI", fee: "Rp 3.500" },
  { code: "bni_va", label: "BNI VA", icon: "BNI", desc: "Virtual Account BNI", fee: "Rp 3.500" },
  { code: "cimb_niaga_va", label: "CIMB Niaga", icon: "CIMB", desc: "Virtual Account CIMB", fee: "Rp 3.500" },
  { code: "permata_va", label: "Permata", icon: "PMT", desc: "Virtual Account Permata", fee: "Rp 3.500" },
];

export default function PricingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-zinc-400">Loading...</div>}>
      <PricingInner />
    </Suspense>
  );
}

function PricingInner() {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleCheckout = async () => {
    if (!selectedPlan || !selectedMethod) return;
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/customer/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: selectedPlan, paymentMethod: selectedMethod }),
      });

      if (res.status === 401) {
        router.push(portalLink("/customer/login"));
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        if (data.pendingOrder) {
          router.push(portalLink(`/customer/checkout/${data.pendingOrder}`));
          return;
        }
        setError(data.error || "Gagal membuat pesanan");
        setSubmitting(false);
        return;
      }

      router.push(portalLink(`/customer/checkout/${data.order.orderId}`));
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">Pilih Plan</h1>
          <p className="text-zinc-400">Bayar langsung, aktif instan. Perpanjang kapan saja.</p>
          <div className="mt-3 flex justify-center gap-3">
            <a href={portalLink("/customer/dashboard")} className="text-xs text-zinc-500 hover:text-orange-400">Dashboard</a>
            <a href={portalLink("/customer/orders")} className="text-xs text-zinc-500 hover:text-orange-400">Riwayat Pesanan</a>
          </div>
        </div>

        {/* Plans */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          {PLANS.map((plan) => (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`relative rounded-2xl border-2 p-6 text-left transition-all ${
                selectedPlan === plan.id
                  ? "border-orange-500 bg-orange-500/5"
                  : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-4 rounded-full bg-orange-600 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                  Popular
                </span>
              )}

              <div className="mb-4">
                <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                <p className="text-xs text-zinc-500 mt-1">{plan.description}</p>
              </div>

              <div className="mb-4">
                {plan.originalPrice && (
                  <span className="text-sm text-zinc-600 line-through mr-2">
                    Rp {plan.originalPrice.toLocaleString("id-ID")}
                  </span>
                )}
                <span className="text-3xl font-bold text-white">
                  Rp {plan.price.toLocaleString("id-ID")}
                </span>
                <span className="text-sm text-zinc-500 ml-1">
                  / {plan.durationDays} hari
                </span>
              </div>

              <ul className="space-y-2">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-zinc-300">
                    <span className="text-green-400 text-xs">&#10003;</span>
                    {f}
                  </li>
                ))}
              </ul>

              {selectedPlan === plan.id && (
                <div className="absolute top-4 right-4 h-6 w-6 rounded-full bg-orange-500 flex items-center justify-center">
                  <span className="text-white text-xs">&#10003;</span>
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Payment method */}
        {selectedPlan && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">Metode Pembayaran</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.code}
                  onClick={() => setSelectedMethod(m.code)}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    selectedMethod === m.code
                      ? "border-orange-500 bg-orange-500/5"
                      : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-xs font-bold text-zinc-300">
                      {m.icon}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">{m.label}</div>
                      <div className="text-[10px] text-zinc-500">{m.desc}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-zinc-600">Fee: {m.fee} (ditanggung pembeli)</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Checkout button */}
        {selectedPlan && selectedMethod && (
          <div className="text-center">
            <button
              onClick={handleCheckout}
              disabled={submitting}
              className="rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed px-8 py-4 text-lg font-semibold text-white transition shadow-lg shadow-orange-600/20"
            >
              {submitting ? "Memproses..." : `Bayar Rp ${PLANS.find(p => p.id === selectedPlan)?.price.toLocaleString("id-ID")}`}
            </button>
            <p className="mt-3 text-[10px] text-zinc-600">
              Pembayaran diproses melalui Pakasir (PT Geksa). Aman &amp; terlisensi Bank Indonesia.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
