// ADDON: saas-mt — Admin Customers page (list + manage)
"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, Button, Input, Modal } from "@/shared/components";

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/customers?${params}`);
      const data = await res.json();
      setCustomers(data.customers || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 300); // debounce search
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="text-sm text-text-muted">Manage SaaS multi-tenant customers</p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Search email/name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Button icon="add" onClick={() => setShowCreate(true)}>
            Add Customer
          </Button>
        </div>
      </div>

      <Card>
        <div className="text-xs text-text-muted mb-3">
          {loading ? "Loading..." : `${total} customer${total !== 1 ? "s" : ""}`}
        </div>

        {!loading && customers.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <ProvisionSummary label="Active Containers" value={customers.filter((c) => provisionInfo(c).status === "active").length} tone="green" />
            <ProvisionSummary label="Pending" value={customers.filter((c) => provisionInfo(c).status === "pending").length} tone="yellow" />
            <ProvisionSummary label="Provisioning" value={customers.filter((c) => provisionInfo(c).status === "provisioning").length} tone="blue" />
            <ProvisionSummary label="Errors" value={customers.filter((c) => provisionInfo(c).status === "error").length} tone="red" />
          </div>
        )}

        {customers.length === 0 && !loading ? (
          <div className="py-8 text-center text-sm text-text-muted">
            No customers yet. Click <strong>Add Customer</strong> to create the first one,
            or share <code>/customer/signup</code> for self-serve registration.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-right">Usage Today</th>
                  <th className="px-3 py-2 text-right">Quota</th>
                  <th className="px-3 py-2 text-left">Container</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Joined</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => {
                  const usedPct = c.quotaDailyLimit > 0
                    ? Math.min(100, (c.usageToday?.requests / c.quotaDailyLimit) * 100)
                    : 0;
                  const provision = provisionInfo(c);
                  return (
                    <tr key={c.id} className="border-t border-border-default hover:bg-bg-secondary cursor-pointer" onClick={() => setSelected(c)}>
                      <td className="px-3 py-2">
                        <div>{c.email}</div>
                        {c.displayName && <div className="text-[10px] text-text-muted">{c.displayName}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs ${planColor(c.plan)}`}>{c.plan}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {(c.usageToday?.requests || 0).toLocaleString()}
                        {c.quotaDailyLimit > 0 && (
                          <span className="text-text-muted"> / {c.quotaDailyLimit.toLocaleString()}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-block h-1.5 w-16 rounded-full bg-zinc-800 overflow-hidden">
                          <div
                            className={`h-full ${usedPct >= 100 ? "bg-red-500" : usedPct >= 80 ? "bg-yellow-500" : "bg-green-500"}`}
                            style={{ width: `${usedPct}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <ProvisionBadge info={provision} />
                      </td>
                      <td className="px-3 py-2">
                        {c.isActive ? (
                          <span className="text-xs text-green-500">● Active</span>
                        ) : (
                          <span className="text-xs text-red-500">● Suspended</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-text-muted">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="material-symbols-outlined text-[16px] text-text-muted">chevron_right</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showCreate && (
        <CreateCustomerModal
          isOpen={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}

      {selected && (
        <CustomerDetailModal
          customer={selected}
          isOpen={!!selected}
          onClose={() => setSelected(null)}
          onUpdated={() => load()}
        />
      )}
    </div>
  );
}

function planColor(plan) {
  switch (plan) {
    case "free": return "bg-zinc-700 text-zinc-300";
    case "pro": return "bg-orange-500/20 text-orange-400";
    case "enterprise": return "bg-purple-500/20 text-purple-400";
    default: return "bg-zinc-700 text-zinc-300";
  }
}

function provisionInfo(customer) {
  const metadata = customer?.metadata || {};
  const status = metadata.provisionStatus || "none";
  return {
    status,
    container: metadata.container || null,
    sshPassword: metadata.sshPassword || null,
    error: metadata.provisionError || null,
  };
}

function provisionColor(status) {
  switch (status) {
    case "active": return "bg-green-500/15 text-green-400 border-green-500/25";
    case "pending": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/25";
    case "provisioning": return "bg-blue-500/15 text-blue-400 border-blue-500/25";
    case "error": return "bg-red-500/15 text-red-400 border-red-500/25";
    default: return "bg-zinc-700/50 text-zinc-400 border-zinc-700";
  }
}

function ProvisionBadge({ info }) {
  const label = info.container || info.status;
  return (
    <div className="flex flex-col gap-1">
      <span className={`inline-flex w-fit items-center rounded border px-2 py-0.5 font-mono text-[11px] ${provisionColor(info.status)}`}>
        {label}
      </span>
      {info.error && <span className="max-w-40 truncate text-[10px] text-red-400" title={info.error}>{info.error}</span>}
    </div>
  );
}

function ProvisionSummary({ label, value, tone }) {
  const tones = {
    green: "text-green-400",
    yellow: "text-yellow-400",
    blue: "text-blue-400",
    red: "text-red-400",
  };
  return (
    <div className="rounded-md border border-border-default bg-bg-secondary px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tones[tone] || "text-text-primary"}`}>{value}</div>
    </div>
  );
}

// ─── Create modal ───────────────────────────────────────────────────────────
function CreateCustomerModal({ isOpen, onClose, onCreated }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [plan, setPlan] = useState("free");
  const [quotaDailyLimit, setQuotaDailyLimit] = useState(1000);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName, plan, quotaDailyLimit }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      setCreated(data); // show api key once
    } catch (err) {
      setError(err?.message || String(err));
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (created) onCreated?.();
    else onClose?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={created ? "Customer Created" : "Add Customer"} size="md">
      {created ? (
        <div className="space-y-3">
          <div className="rounded-md bg-green-500/10 border border-green-500/30 p-3">
            <div className="text-sm font-semibold text-green-400">✓ Created {created.customer.email}</div>
            <div className="mt-1 text-xs text-text-muted">
              Share these credentials with the customer. The API key won&apos;t be shown again.
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Email</div>
            <code className="block rounded bg-zinc-950 px-2 py-1 text-xs">{created.customer.email}</code>
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">API Key (copy now!)</div>
            <code className="block break-all rounded bg-zinc-950 px-2 py-1 font-mono text-xs">{created.apiKey.key}</code>
          </div>
          <Button onClick={handleClose} className="w-full">Done</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-text-muted">Email</label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">Password (min 8)</label>
            <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">Display name (optional)</label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={submitting} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-text-muted">Plan</label>
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                disabled={submitting}
                className="w-full px-3 py-2 rounded-md bg-bg-secondary border border-border-default text-sm"
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">Daily quota</label>
              <Input type="number" min={0} value={quotaDailyLimit} onChange={(e) => setQuotaDailyLimit(Number(e.target.value))} disabled={submitting} />
            </div>
          </div>
          {error && <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Creating..." : "Create"}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ─── Detail modal ───────────────────────────────────────────────────────────
function CustomerDetailModal({ customer, isOpen, onClose, onUpdated }) {
  const [details, setDetails] = useState(null);
  const [plan, setPlan] = useState(customer.plan);
  const [quotaDailyLimit, setQuotaDailyLimit] = useState(customer.quotaDailyLimit);
  const [quotaMonthlyLimit, setQuotaMonthlyLimit] = useState(customer.quotaMonthlyLimit);
  const [isActive, setIsActive] = useState(customer.isActive);
  const [suspendedReason, setSuspendedReason] = useState(customer.suspendedReason || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/customers/${customer.id}`)
      .then((r) => r.json())
      .then(setDetails)
      .catch(() => {});
  }, [customer.id]);

  const save = async () => {
    setSaving(true);
    await fetch(`/api/admin/customers/${customer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, quotaDailyLimit, quotaMonthlyLimit, isActive, suspendedReason }),
    });
    setSaving(false);
    onUpdated?.();
    onClose?.();
  };

  const remove = async () => {
    if (!confirm(`Delete customer ${customer.email}? All API keys + usage data will be permanently removed.`)) return;
    await fetch(`/api/admin/customers/${customer.id}`, { method: "DELETE" });
    onUpdated?.();
    onClose?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Customer: ${customer.email}`} size="lg">
      <div className="space-y-4">
        <ProvisionDetail info={provisionInfo(details?.customer || customer)} />

        {/* Usage summary */}
        {details?.usage && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md bg-zinc-950 border border-zinc-800 p-3">
              <div className="text-xs text-text-muted">Today</div>
              <div className="text-xl font-semibold">{details.usage.today.requests.toLocaleString()} req</div>
              <div className="text-[10px] text-text-muted">{((details.usage.today.promptTokens + details.usage.today.completionTokens) || 0).toLocaleString()} tokens</div>
            </div>
            <div className="rounded-md bg-zinc-950 border border-zinc-800 p-3">
              <div className="text-xs text-text-muted">This Month</div>
              <div className="text-xl font-semibold">{details.usage.month.requests.toLocaleString()} req</div>
              <div className="text-[10px] text-text-muted">{((details.usage.month.promptTokens + details.usage.month.completionTokens) || 0).toLocaleString()} tokens</div>
            </div>
          </div>
        )}

        {/* Usage trend chart (last 30 days) */}
        {details?.usage?.daily?.length > 0 && (
          <div>
            <div className="mb-1 text-xs text-text-muted">Daily requests (last 30 days)</div>
            <div className="flex items-end gap-[2px] h-16 rounded bg-zinc-950 border border-zinc-800 p-2">
              {(() => {
                const data = details.usage.daily;
                const maxR = Math.max(...data.map((d) => d.requests), 1);
                return data.map((d) => (
                  <div key={d.date} className="flex-1 group relative" title={`${d.date}: ${d.requests} req`}>
                    <div
                      className="w-full rounded-sm bg-emerald-500/70 group-hover:bg-emerald-400 transition-colors min-h-[2px]"
                      style={{ height: `${Math.max((d.requests / maxR) * 100, 3)}%` }}
                    />
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {/* Edit form */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-text-muted">Plan</label>
              <select value={plan} onChange={(e) => setPlan(e.target.value)} className="w-full px-3 py-2 rounded-md bg-bg-secondary border border-border-default text-sm">
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">Status</label>
              <select value={isActive ? "1" : "0"} onChange={(e) => setIsActive(e.target.value === "1")} className="w-full px-3 py-2 rounded-md bg-bg-secondary border border-border-default text-sm">
                <option value="1">Active</option>
                <option value="0">Suspended</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-text-muted">Daily quota</label>
              <Input type="number" min={0} value={quotaDailyLimit} onChange={(e) => setQuotaDailyLimit(Number(e.target.value))} />
              <div className="mt-1 text-[10px] text-text-muted">0 = unlimited</div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">Monthly quota</label>
              <Input type="number" min={0} value={quotaMonthlyLimit} onChange={(e) => setQuotaMonthlyLimit(Number(e.target.value))} />
              <div className="mt-1 text-[10px] text-text-muted">0 = unlimited</div>
            </div>
          </div>
          {!isActive && (
            <div>
              <label className="mb-1 block text-xs text-text-muted">Suspension reason</label>
              <Input value={suspendedReason} onChange={(e) => setSuspendedReason(e.target.value)} placeholder="Optional note" />
            </div>
          )}
        </div>

        {/* API keys list */}
        {details?.apiKeys && (
          <div>
            <div className="mb-1 text-xs text-text-muted">API Keys ({details.apiKeys.length})</div>
            <div className="space-y-1">
              {details.apiKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between rounded bg-zinc-950 border border-zinc-800 px-2 py-1 font-mono text-xs">
                  <span>{k.keyMasked}</span>
                  <span className="text-text-muted">{k.name} · {k.isActive ? "active" : "revoked"} · last: {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between pt-3">
          <Button variant="danger" onClick={remove}>Delete Customer</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save changes"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ProvisionDetail({ info }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-text-muted">Container Provisioning</div>
        <span className={`rounded border px-2 py-0.5 text-xs ${provisionColor(info.status)}`}>
          {info.status}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Container</div>
          <code className="font-mono text-text-primary">{info.container || "-"}</code>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">SSH Password</div>
          <code className="font-mono text-text-primary">{info.sshPassword || "-"}</code>
        </div>
      </div>
      {info.error && (
        <div className="mt-2 rounded border border-red-500/25 bg-red-500/10 px-2 py-1 text-xs text-red-400">
          {info.error}
        </div>
      )}
    </div>
  );
}
