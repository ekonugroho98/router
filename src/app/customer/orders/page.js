// ADDON: saas-mt — Customer order history page
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { portalLink } from "@/lib/customer/portalLinks";

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-zinc-400">Loading...</div>}>
      <OrdersInner />
    </Suspense>
  );
}

function OrdersInner() {
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/customer/orders")
      .then((r) => {
        if (r.status === 401) { router.replace(portalLink("/customer/login")); return null; }
        return r.json();
      })
      .then((data) => {
        if (data?.orders) setOrders(data.orders);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="text-sm text-zinc-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Riwayat Pesanan</h1>
          <div className="flex gap-3">
            <a href={portalLink("/customer/dashboard")} className="text-xs text-zinc-500 hover:text-orange-400">Dashboard</a>
            <a href={portalLink("/customer/pricing")} className="rounded-lg bg-orange-600 hover:bg-orange-500 px-4 py-2 text-xs font-medium text-white transition">
              Beli Plan
            </a>
          </div>
        </div>

        {orders.length === 0 ? (
          <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-8 text-center">
            <div className="text-4xl mb-3 opacity-50">&#128722;</div>
            <p className="text-zinc-500 mb-4">Belum ada pesanan</p>
            <a
              href={portalLink("/customer/pricing")}
              className="inline-block rounded-lg bg-orange-600 hover:bg-orange-500 px-6 py-3 text-sm font-medium text-white transition"
            >
              Lihat Plan
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderCard key={order.orderId} order={order} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OrderCard({ order }) {
  const statusColors = {
    pending: "bg-yellow-500/20 text-yellow-400",
    completed: "bg-green-500/20 text-green-400",
    canceled: "bg-red-500/20 text-red-400",
    expired: "bg-zinc-500/20 text-zinc-400",
  };

  const statusLabels = {
    pending: "Menunggu",
    completed: "Berhasil",
    canceled: "Dibatalkan",
    expired: "Expired",
  };

  return (
    <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="font-mono text-xs text-zinc-500">{order.orderId}</span>
          <span className="ml-2 text-xs text-zinc-600">
            {new Date(order.createdAt).toLocaleDateString("id-ID", { dateStyle: "medium" })}
          </span>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${statusColors[order.status] || statusColors.expired}`}>
          {statusLabels[order.status] || order.status}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-white">{order.planName}</div>
          <div className="text-xs text-zinc-500">{order.durationDays} hari &middot; {order.paymentMethod?.toUpperCase()}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-white">Rp {Number(order.amount).toLocaleString("id-ID")}</div>
          {order.status === "pending" && (
            <a
              href={portalLink(`/customer/checkout/${order.orderId}`)}
              className="text-[10px] text-orange-400 hover:underline"
            >
              Bayar sekarang &rarr;
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
