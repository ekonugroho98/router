"use client";

/**
 * BulkSiliconFlowLoginModal — UI untuk auto-add SiliconFlow accounts via Camoufox sidecar service.
 *
 * Flow:
 *   1. User paste email:password per line (textarea)
 *   2. Optional: headless toggle, proxy pool, delay
 *   3. Submit → POST /api/addon/siliconflow-bulk (Next API route forward ke sidecar)
 *   4. Receive SSE stream → render real-time progress per account
 *   5. Done → refresh providers list
 *
 * Komponen ini self-contained (1 file baru) — gak modify code 9router lain.
 */

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

const NO_PROXY = "__none__";

export default function BulkSiliconFlowLoginModal({ isOpen, onClose, onSuccess }) {
  const [bulkText, setBulkText] = useState("");
  const [headless, setHeadless] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState(60);
  const [maxConcurrent, setMaxConcurrent] = useState(1);
  const [stopOnError, setStopOnError] = useState(false);
  const [proxyPools, setProxyPools] = useState([]);
  const [selectedPool, setSelectedPool] = useState(NO_PROXY);
  const [submitting, setSubmitting] = useState(false);
  const [sidecarStatus, setSidecarStatus] = useState(null); // {available: bool, error?: str}
  const [events, setEvents] = useState([]); // SSE events list
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const logRef = useRef(null);

  // ─── On open: check sidecar health + load proxy pools ────────────────────
  useEffect(() => {
    if (!isOpen) return;
    setEvents([]);
    setSummary(null);
    setError(null);
    setSubmitting(false);

    // Check sidecar
    fetch("/api/addon/siliconflow-bulk")
      .then((r) => r.json())
      .then(setSidecarStatus)
      .catch((e) => setSidecarStatus({ available: false, error: String(e) }));

    // Load proxy pools
    fetch("/api/proxy-pools?isActive=true")
      .then((r) => r.json())
      .then((d) => setProxyPools(d?.proxyPools || []))
      .catch(() => setProxyPools([]));
  }, [isOpen]);

  // ─── Auto-scroll log ─────────────────────────────────────────────────────
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  // ─── Parse textarea → array of {email, password} ─────────────────────────
  const parseAccounts = () => {
    const lines = bulkText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    const accounts = [];
    const errors = [];
    for (const [i, line] of lines.entries()) {
      const idx = line.indexOf(":");
      if (idx === -1) {
        errors.push(`Line ${i + 1}: missing ':' separator`);
        continue;
      }
      const email = line.slice(0, idx).trim();
      const password = line.slice(idx + 1).trim();
      if (!email || !password) {
        errors.push(`Line ${i + 1}: email or password empty`);
        continue;
      }
      accounts.push({ email, password });
    }
    return { accounts, errors };
  };

  const handleSubmit = async () => {
    setError(null);
    setSummary(null);
    setEvents([]);

    const { accounts, errors } = parseAccounts();
    if (errors.length > 0) {
      setError("Parse errors:\n" + errors.join("\n"));
      return;
    }
    if (accounts.length === 0) {
      setError("No valid email:password lines");
      return;
    }

    setSubmitting(true);

    // Cari proxy URL dari pool yang dipilih (kalau ada)
    let proxyUrl = null;
    if (selectedPool !== NO_PROXY) {
      const pool = proxyPools.find((p) => p.id === selectedPool);
      if (pool) {
        // Schema proxyPool.data ada `proxyUrl` di top-level
        proxyUrl = pool.proxyUrl || pool?.data?.proxyUrl || null;
      }
    }

    const body = {
      accounts,
      headless,
      proxy: proxyUrl,
      delay_seconds: Number(delaySeconds) || 60,
      max_concurrent: Math.max(1, Math.min(5, Number(maxConcurrent) || 1)),
      save_to_router: true,
      stop_on_error: stopOnError,
    };

    const controller = new AbortController();
    abortRef.current = controller;

    let res;
    try {
      res = await fetch("/api/addon/siliconflow-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      setError("Fetch failed: " + (e?.message || String(e)));
      setSubmitting(false);
      return;
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      setError(errBody?.hint || errBody?.error || `HTTP ${res.status}`);
      setSubmitting(false);
      return;
    }

    // Read SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE messages dipisah \n\n
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const evt = parseSSE(part);
          if (!evt) continue;
          handleEvent(evt);
        }
      }
    } catch (e) {
      if (e?.name !== "AbortError") {
        setError("Stream error: " + (e?.message || String(e)));
      }
    } finally {
      setSubmitting(false);
      abortRef.current = null;
    }
  };

  const handleEvent = (evt) => {
    setEvents((prev) => [...prev.slice(-500), evt]); // keep last 500 events

    if (evt.event === "done") {
      setSummary(evt.data);
      // Notify parent untuk refresh providers list
      onSuccess?.(evt.data);
    }
  };

  const handleClose = () => {
    if (abortRef.current) abortRef.current.abort();
    onClose?.();
  };

  const isSidecarUp = sidecarStatus?.available === true;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Bulk Auto-Add SiliconFlow Accounts"
      size="lg"
    >
      <div className="space-y-4">
        {/* Sidecar status */}
        {sidecarStatus === null && (
          <div className="text-xs text-text-muted">Checking sidecar service...</div>
        )}
        {sidecarStatus && !isSidecarUp && (
          <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm">
            <div className="font-semibold text-red-400">
              ⚠ Sidecar service belum jalan
            </div>
            <div className="text-text-muted mt-1">{sidecarStatus.hint || sidecarStatus.error}</div>
            <div className="text-xs text-text-muted mt-2 font-mono">
              Start dengan:{"\n"}
              cd addon-kiro-bulk{"\n"}
              source .venv/bin/activate{"\n"}
              python server.py
            </div>
          </div>
        )}
        {isSidecarUp && (
          <div className="text-xs text-green-500">
            ✓ Sidecar service ready ({sidecarStatus.sidecar?.config?.router_url})
          </div>
        )}

        {/* Textarea email:password */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Accounts (email:password per baris)
          </label>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={"email1@gmail.com:password1\nemail2@gmail.com:password2\n# Lines starting with # are ignored"}
            rows={6}
            className="w-full px-3 py-2 rounded-md bg-bg-secondary border border-border-default font-mono text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            disabled={submitting}
          />
          <div className="text-xs text-text-muted mt-1">
            {bulkText.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")).length}{" "}
            account(s) detected
          </div>
        </div>

        {/* Options row */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">
              Delay (detik)
            </label>
            <Input
              type="number"
              min={5}
              max={600}
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(e.target.value)}
              disabled={submitting}
            />
            <div className="text-xs text-text-muted mt-1">
              {maxConcurrent === 1
                ? "Antar akun (sequential)"
                : `Stagger ${(Number(delaySeconds) / maxConcurrent).toFixed(1)}s per task`}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Max parallel
            </label>
            <select
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(Number(e.target.value))}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-md bg-bg-secondary border border-border-default text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value={1}>1 (sequential, safest)</option>
              <option value={2}>2 parallel</option>
              <option value={3}>3 parallel</option>
              <option value={4}>4 parallel</option>
              <option value={5}>5 parallel (max, fastest)</option>
            </select>
            <div className="text-xs text-text-muted mt-1">
              {maxConcurrent === 1
                ? "1 browser at a time"
                : `${maxConcurrent} browsers paralel — heavy memory!`}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Proxy Pool</label>
            <select
              value={selectedPool}
              onChange={(e) => setSelectedPool(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-md bg-bg-secondary border border-border-default text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value={NO_PROXY}>No proxy</option>
              {proxyPools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
            <div className="text-xs text-text-muted mt-1">
              {maxConcurrent > 1 && selectedPool === NO_PROXY
                ? "⚠ Tanpa proxy, parallel rentan ke-detect"
                : "Optional"}
            </div>
          </div>
        </div>

        {/* Checkboxes */}
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={headless}
              onChange={(e) => setHeadless(e.target.checked)}
              disabled={submitting}
            />
            <span>Headless mode</span>
            <span className="text-xs text-text-muted">(lebih cepet, lebih mudah ke-detect)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={stopOnError}
              onChange={(e) => setStopOnError(e.target.checked)}
              disabled={submitting}
            />
            <span>Stop on error</span>
          </label>
        </div>

        {/* Error display */}
        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400 whitespace-pre-wrap">
            {error}
          </div>
        )}

        {/* Live log */}
        {events.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">Live progress</label>
            <div
              ref={logRef}
              className="h-64 overflow-y-auto rounded-md bg-bg-secondary border border-border-default p-3 font-mono text-xs space-y-1"
            >
              {events.map((evt, i) => (
                <EventLine key={i} evt={evt} />
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {summary && (() => {
          const loginOk = summary.success || 0;
          const loginFail = summary.failed || 0;
          const savedOk = summary.details?.filter((d) => d.ok && d.router_save?.ok).length || 0;
          const saveFail = summary.details?.filter((d) => d.ok && !d.router_save?.ok) || [];
          const total = summary.details?.length || (loginOk + loginFail);
          const allGood = savedOk === total && loginFail === 0;
          return (
            <div className={`rounded-md border p-3 text-sm ${allGood ? "bg-green-500/10 border-green-500/30" : "bg-yellow-500/10 border-yellow-500/30"}`}>
              <div className={`font-semibold ${allGood ? "text-green-400" : "text-yellow-400"}`}>
                {allGood ? "✓ Done — all accounts saved" : "⚠ Done — some accounts had issues"}
              </div>
              <div className="mt-1 text-xs text-text-muted">
                Login success: <span className="font-semibold">{loginOk}</span> / {total}
                {" · "}
                Saved to router: <span className="font-semibold">{savedOk}</span> / {total}
                {" · "}
                Login failed: <span className="font-semibold">{loginFail}</span>
              </div>

              {/* Login fail details */}
              {loginFail > 0 && (
                <details className="mt-2" open>
                  <summary className="cursor-pointer text-xs text-red-400 font-medium">
                    Login failures ({loginFail})
                  </summary>
                  <ul className="mt-1 text-xs list-disc pl-5 text-red-300">
                    {summary.details?.filter((d) => !d.ok).map((d, i) => (
                      <li key={i}>{d.email}: {d.error}</li>
                    ))}
                  </ul>
                </details>
              )}

              {/* Save fail details (login OK but save failed) */}
              {saveFail.length > 0 && (
                <details className="mt-2" open>
                  <summary className="cursor-pointer text-xs text-yellow-400 font-medium">
                    Save failures ({saveFail.length}) — login berhasil tapi gagal save ke 9router
                  </summary>
                  <ul className="mt-1 text-xs list-disc pl-5 text-yellow-300">
                    {saveFail.map((d, i) => {
                      const code = d.router_save?.status_code;
                      const body = d.router_save?.body;
                      const errMsg = body?.error || JSON.stringify(body)?.slice(0, 80);
                      return (
                        <li key={i}>
                          {d.email} <span className="text-text-muted">(HTTP {code})</span>: {errMsg}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </div>
          );
        })()}

        {/* Action buttons */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            {submitting ? "Cancel" : "Close"}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !isSidecarUp || !bulkText.trim()}
          >
            {submitting ? "Processing..." : "Start Bulk Login"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

BulkSiliconFlowLoginModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function parseSSE(text) {
  const lines = text.split("\n");
  let event = "message";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(dataStr) };
  } catch {
    return { event, data: dataStr };
  }
}

function EventLine({ evt }) {
  const { event, data } = evt;
  const tone = (() => {
    if (event === "account_error") return "text-red-400";
    if (event === "account_done") return "text-green-400";
    if (event === "done") return "text-green-500 font-semibold";
    if (event === "delay") return "text-yellow-400";
    if (event === "start" || event === "account_start") return "text-blue-400";
    return "text-text-muted";
  })();

  let msg = "";
  if (event === "start") msg = `[start] total=${data.total}, parallel=${data.max_concurrent || 1}, delay=${data.delay_seconds}s, headless=${data.headless}`;
  else if (event === "account_start") msg = `[#${data.index}/${data.total}] >> ${data.email}`;
  else if (event === "account_done") {
    if (data.saved_ok) {
      msg = `[#${data.index}] ✓ ${data.email} — saved=OK (id=${data.router_save?.body?.connection?.id?.slice(0, 8) || "?"})`;
    } else {
      const errBody = data.router_save?.body;
      const errCode = data.router_save?.status_code ?? "?";
      const errText = errBody?.error || JSON.stringify(errBody)?.slice(0, 100);
      msg = `[#${data.index}] ⚠ ${data.email} — login OK but SAVE FAILED (HTTP ${errCode}): ${errText}`;
    }
  }
  else if (event === "account_error") msg = `[#${data.index}] ✗ ${data.email}: ${data.error}`;
  else if (event === "account_skipped") msg = `[#${data.index}] ⊘ ${data.email} skipped (${data.reason})`;
  else if (event === "debug") msg = `[debug] ${data.message}`;
  else if (event === "delay") msg = `... ${data.message}`;
  else if (event === "progress") msg = `   [#${data.index}] ${data.message || ""}`;
  else if (event === "done") {
    const savedOk = data.details?.filter(d => d.ok && d.router_save?.ok)?.length || 0;
    msg = `[done] login_success=${data.success}, saved_to_router=${savedOk}, failed=${data.failed}`;
  }
  else msg = `[${event}] ${JSON.stringify(data).slice(0, 120)}`;

  // Override tone kalau account_done tapi save failed
  let finalTone = tone;
  if (event === "account_done" && !data.saved_ok) {
    finalTone = "text-yellow-400";
  }

  return <div className={finalTone}>{msg}</div>;
}
