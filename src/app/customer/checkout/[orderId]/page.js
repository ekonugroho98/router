// ADDON: saas-mt — Checkout page (shows QR/VA + polls for payment status)
"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { portalLink } from "@/lib/customer/portalLinks";

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-zinc-400">Loading...</div>}>
      <CheckoutInner />
    </Suspense>
  );
}

function CheckoutInner() {
  const { orderId } = useParams();
  const router = useRouter();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activated, setActivated] = useState(false);
  const pollRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/customer/orders/${orderId}/status`);
      if (res.status === 401) { router.replace(portalLink("/customer/login")); return; }
      const data = await res.json();
      if (!res.ok) { setError(data.error); setLoading(false); return; }
      setOrder(data.order);
      setLoading(false);
      if (data.activated) setActivated(true);
      if (data.order?.status === "completed" || data.order?.status === "canceled") {
        clearInterval(pollRef.current);
      }
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }, [orderId, router]);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 5000);
    return () => clearInterval(pollRef.current);
  }, [fetchStatus]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="text-sm text-zinc-500">Memuat detail pembayaran...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-6 py-4 text-sm text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (!order) return null;

  const isQris = order.paymentMethod === "qris" || order.payment_method === "qris";
  const isPending = order.status === "pending";
  const isCompleted = order.status === "completed";
  const isCanceled = order.status === "canceled" || order.status === "expired";

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8">
      <div className="mx-auto max-w-lg">
        {/* Back link */}
        <div className="mb-6">
          <a href={portalLink("/customer/pricing")} className="text-xs text-zinc-500 hover:text-orange-400">&larr; Kembali ke Pricing</a>
        </div>

        {/* Completed */}
        {isCompleted && (
          <div className="rounded-2xl bg-green-500/10 border border-green-500/30 p-8 text-center mb-6">
            <div className="text-5xl mb-4">&#10003;</div>
            <h2 className="text-2xl font-bold text-green-400 mb-2">Pembayaran Berhasil!</h2>
            <p className="text-sm text-zinc-400 mb-4">
              Plan <strong>{order.planName}</strong> sudah aktif selama {order.durationDays} hari.
            </p>
            <button
              onClick={() => router.push(portalLink("/customer/dashboard"))}
              className="rounded-xl bg-green-600 hover:bg-green-500 px-6 py-3 text-sm font-semibold text-white transition"
            >
              Ke Dashboard
            </button>
          </div>
        )}

        {/* Canceled / Expired */}
        {isCanceled && (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-8 text-center mb-6">
            <div className="text-5xl mb-4">&#10007;</div>
            <h2 className="text-xl font-bold text-red-400 mb-2">Pembayaran Dibatalkan</h2>
            <p className="text-sm text-zinc-400 mb-4">Pesanan ini sudah expired atau dibatalkan.</p>
            <button
              onClick={() => router.push(portalLink("/customer/pricing"))}
              className="rounded-xl bg-orange-600 hover:bg-orange-500 px-6 py-3 text-sm font-semibold text-white transition"
            >
              Buat Pesanan Baru
            </button>
          </div>
        )}

        {/* Pending — Show payment info */}
        {isPending && (
          <>
            <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-6 mb-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Pembayaran</h2>
                <span className="rounded-full bg-yellow-500/20 px-3 py-1 text-xs font-medium text-yellow-400">
                  Menunggu Pembayaran
                </span>
              </div>

              {/* Order details */}
              <div className="space-y-2 mb-6">
                <Row label="Order ID" value={order.orderId} mono />
                <Row label="Plan" value={`${order.planName} (${order.durationDays} hari)`} />
                <Row label="Metode" value={order.paymentMethod?.toUpperCase()} />
                <Row label="Jumlah" value={`Rp ${(order.totalPayment || order.amount || 0).toLocaleString("id-ID")}`} bold />
                {order.fee > 0 && <Row label="Fee" value={`Rp ${Number(order.fee).toLocaleString("id-ID")}`} />}
                {order.expiredAt && (
                  <Row label="Batas Waktu" value={new Date(order.expiredAt).toLocaleString("id-ID")} />
                )}
              </div>

              {/* Payment number */}
              {order.paymentNumber && (
                <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-4">
                  {isQris ? (
                    <div className="text-center">
                      <div className="text-xs text-zinc-500 mb-2">Scan QR Code untuk bayar</div>
                      {order.paymentUrl ? (
                        <div className="mb-3">
                          <a
                            href={order.paymentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block rounded-lg bg-orange-600 hover:bg-orange-500 px-4 py-2 text-sm font-medium text-white transition"
                          >
                            Buka Halaman Pembayaran
                          </a>
                        </div>
                      ) : null}
                      <div className="rounded-lg bg-white p-4 inline-block">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(order.paymentNumber)}`}
                          alt="QR Code"
                          width={200}
                          height={200}
                          className="mx-auto"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-xs text-zinc-500 mb-2">Transfer ke Virtual Account</div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-3 text-lg font-mono text-white tracking-wider text-center">
                          {order.paymentNumber}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(order.paymentNumber);
                          }}
                          className="rounded-lg border border-zinc-700 px-3 py-3 text-xs text-zinc-400 hover:bg-zinc-800"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Payment URL fallback */}
              {!order.paymentNumber && order.paymentUrl && (
                <div className="text-center">
                  <a
                    href={order.paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-xl bg-orange-600 hover:bg-orange-500 px-6 py-3 text-sm font-semibold text-white transition"
                  >
                    Bayar Sekarang
                  </a>
                </div>
              )}
            </div>

            {/* Polling indicator */}
            <div className="text-center">
              <div className="inline-flex items-center gap-2 text-xs text-zinc-500">
                <span className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
                Menunggu konfirmasi pembayaran...
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono, bold }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className={`text-zinc-200 ${mono ? "font-mono text-xs" : ""} ${bold ? "font-semibold text-white" : ""}`}>
        {value}
      </span>
    </div>
  );
}
