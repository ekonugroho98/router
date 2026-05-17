/**
 * Addon: OpenRouter Bulk Auto-Add
 *
 * Proxy endpoint dari 9router UI ke unified sidecar service (default port 9100).
 * Sidecar handle dua provider (Kiro + OpenRouter) lewat parameter `provider`.
 *
 * Same sidecar service as /api/addon/kiro-bulk, beda di provider param yang
 * dikirim ke /bulk-login (atau /login).
 *
 * Sidecar source: ./addon-kiro-bulk/ (multi-provider, folder name keep buat backward compat).
 * Setup: bash addon-kiro-bulk/install.sh && python addon-kiro-bulk/server.py
 */

import { NextResponse } from "next/server";

const SIDECAR_URL = process.env.KIRO_BULK_SIDECAR_URL || "http://127.0.0.1:9100";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── GET /api/addon/openrouter-bulk → cek sidecar health ───────────────────
export async function GET() {
  try {
    const res = await fetch(`${SIDECAR_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { available: false, error: `Sidecar returned ${res.status}` },
        { status: 200 }
      );
    }
    const data = await res.json();
    return NextResponse.json({ available: true, sidecar: data });
  } catch (e) {
    return NextResponse.json(
      {
        available: false,
        error: e?.message || String(e),
        hint:
          "Sidecar service belum jalan. Start dengan: " +
          "`cd addon-kiro-bulk && source .venv/bin/activate && python server.py`",
        sidecar_url: SIDECAR_URL,
      },
      { status: 200 }
    );
  }
}

// ─── POST /api/addon/openrouter-bulk → forward ke sidecar dengan provider=openrouter ───
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
  if (accounts.length === 0) {
    return NextResponse.json(
      { error: "accounts array required" },
      { status: 400 }
    );
  }

  // Validate each account
  for (const acc of accounts) {
    if (!acc?.email || !acc?.password) {
      return NextResponse.json(
        { error: "every account must have email & password" },
        { status: 400 }
      );
    }
  }

  // Forward ke sidecar dengan provider="openrouter"
  let sidecarRes;
  try {
    sidecarRes = await fetch(`${SIDECAR_URL}/bulk-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "openrouter",  // ← KEY DIFFERENCE dari kiro-bulk
        accounts,
        headless: body?.headless === true,
        proxy: body?.proxy || null,
        delay_seconds: Number(body?.delay_seconds) || 60,
        max_concurrent: Math.max(1, Math.min(5, Number(body?.max_concurrent) || 1)),
        save_to_router: body?.save_to_router !== false,
        max_retries: Number(body?.max_retries) || 3,
        stop_on_error: body?.stop_on_error === true,
        router_url: body?.router_url || null,
        anticaptcha_key: body?.anticaptcha_key || null,
      }),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Sidecar service unreachable",
        detail: e?.message || String(e),
        hint:
          "Start sidecar: `cd addon-kiro-bulk && source .venv/bin/activate && python server.py`",
        sidecar_url: SIDECAR_URL,
      },
      { status: 503 }
    );
  }

  if (!sidecarRes.ok && sidecarRes.headers.get("content-type")?.includes("application/json")) {
    const errBody = await sidecarRes.json().catch(() => ({}));
    return NextResponse.json(
      { error: errBody?.error || "Sidecar returned error", detail: errBody },
      { status: sidecarRes.status }
    );
  }

  // Stream SSE response back
  return new Response(sidecarRes.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
