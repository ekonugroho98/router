// ADDON: saas-mt — Admin Redeem Codes page (generate + manage)
"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, Button, Input, Modal } from "@/shared/components";

export default function RedeemCodesPage() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/redeem-codes");
      const data = await res.json();
      setCodes(data.codes || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDeactivate = async (id) => {
    if (!confirm("Deactivate this code?")) return;
    await fetch(`/api/admin/redeem-codes?id=${id}`, { method: "DELETE" });
    load();
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedId(code);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStatus = (c) => {
    if (!c.isActive) return { label: "Deactivated", color: "text-red-400 bg-red-500/10" };
    if (c.expiresAt && new Date(c.expiresAt) < new Date()) return { label: "Expired", color: "text-yellow-400 bg-yellow-500/10" };
    if (c.usedCount >= c.maxUses) return { label: "Fully Used", color: "text-blue-400 bg-blue-500/10" };
    return { label: "Active", color: "text-green-400 bg-green-500/10" };
  };

  const stats = {
    total: codes.length,
    active: codes.filter(c => getStatus(c).label === "Active").length,
    used: codes.filter(c => getStatus(c).label === "Fully Used").length,
    deactivated: codes.filter(c => getStatus(c).label === "Deactivated").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Redeem Codes</h1>
          <p className="text-sm text-text-muted">Generate and manage activation codes</p>
        </div>
        <Button icon="add" onClick={() => setShowGenerate(true)}>
          Generate Codes
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total" value={stats.total} tone="default" />
        <StatCard label="Active" value={stats.active} tone="green" />
        <StatCard label="Fully Used" value={stats.used} tone="blue" />
        <StatCard label="Deactivated" value={stats.deactivated} tone="red" />
      </div>

      {/* Codes Table */}
      <Card>
        <div className="text-xs text-text-muted mb-3">
          {loading ? "Loading..." : `${codes.length} code${codes.length !== 1 ? "s" : ""}`}
        </div>

        {codes.length === 0 && !loading ? (
          <div className="py-8 text-center text-sm text-text-muted">
            No redeem codes yet. Click <strong>Generate Codes</strong> to create some.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-left">Duration</th>
                  <th className="px-3 py-2 text-left">Quota</th>
                  <th className="px-3 py-2 text-left">Usage</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Label</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {codes.map((c) => {
                  const status = getStatus(c);
                  return (
                    <tr key={c.id || c.code} className="hover:bg-surface-2/50 transition-colors">
                      <td className="px-3 py-2">
                        <button
                          onClick={() => copyCode(c.code)}
                          className="font-mono text-xs bg-surface-2 px-2 py-0.5 rounded hover:bg-primary/20 transition-colors cursor-pointer"
                          title="Click to copy"
                        >
                          {copiedId === c.code ? "Copied!" : c.code}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                          {c.plan}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-muted">{c.durationDays}d</td>
                      <td className="px-3 py-2 text-text-muted text-xs">
                        {c.quotaDailyLimit}/day, {c.quotaMonthlyLimit}/mo
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs">{c.usedCount}/{c.maxUses}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${status.color}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-muted text-xs">{c.label || "-"}</td>
                      <td className="px-3 py-2 text-text-muted text-xs">
                        {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "-"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {getStatus(c).label === "Active" && (
                          <button
                            onClick={() => handleDeactivate(c.id)}
                            className="text-xs text-red-400 hover:text-red-300 cursor-pointer"
                          >
                            Deactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Generate Modal */}
      {showGenerate && (
        <GenerateModal
          onClose={() => setShowGenerate(false)}
          onGenerated={() => { setShowGenerate(false); load(); }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const colors = {
    default: "border-border-subtle",
    green: "border-green-500/30",
    blue: "border-blue-500/30",
    red: "border-red-500/30",
  };
  const textColors = {
    default: "text-text-main",
    green: "text-green-400",
    blue: "text-blue-400",
    red: "text-red-400",
  };
  return (
    <div className={`rounded-lg border ${colors[tone]} bg-surface-1 p-3`}>
      <div className="text-xs uppercase tracking-wider text-text-muted mb-1">{label}</div>
      <div className={`text-xl font-bold ${textColors[tone]}`}>{value}</div>
    </div>
  );
}

const PLAN_PRESETS = {
  free: { label: "Free Trial (3 hari)", durationDays: 3, dailyLimit: 300, monthlyLimit: 9000 },
  daily: { label: "Daily (1 hari — Rp 2rb)", durationDays: 1, dailyLimit: 300, monthlyLimit: 9000 },
  premium: { label: "Premium (30 hari — Rp 49rb)", durationDays: 30, dailyLimit: 1000, monthlyLimit: 30000 },
};

function GenerateModal({ onClose, onGenerated }) {
  const [count, setCount] = useState(5);
  const [plan, setPlan] = useState("free");
  const [durationDays, setDurationDays] = useState(PLAN_PRESETS.free.durationDays);
  const [dailyLimit, setDailyLimit] = useState(PLAN_PRESETS.free.dailyLimit);
  const [monthlyLimit, setMonthlyLimit] = useState(PLAN_PRESETS.free.monthlyLimit);
  const [maxUses, setMaxUses] = useState(1);
  const [label, setLabel] = useState("");

  const applyPreset = (planKey) => {
    setPlan(planKey);
    const p = PLAN_PRESETS[planKey];
    if (p) {
      setDurationDays(p.durationDays);
      setDailyLimit(p.dailyLimit);
      setMonthlyLimit(p.monthlyLimit);
    }
  };
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/redeem-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count, plan, durationDays,
          quotaDailyLimit: dailyLimit,
          quotaMonthlyLimit: monthlyLimit,
          maxUses,
          label: label || null,
        }),
      });
      const data = await res.json();
      if (data.codes) setResult(data.codes);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  const copyAll = () => {
    if (!result) return;
    const text = result.map((c, i) => `${i + 1}. ${c.code}`).join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <Modal isOpen onClose={onClose} title={result ? "Generated Codes" : "Generate Redeem Codes"}>
      {result ? (
        <div className="space-y-3">
          <div className="bg-surface-2 rounded-lg p-3 font-mono text-sm space-y-1 max-h-60 overflow-y-auto">
            {result.map((c, i) => (
              <div key={c.code} className="flex items-center justify-between">
                <span>{i + 1}. {c.code}</span>
                <span className="text-xs text-text-muted">{c.plan} / {c.durationDays}d</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={copyAll}>
              {copiedAll ? "Copied!" : "Copy All"}
            </Button>
            <Button variant="primary" fullWidth onClick={onGenerated}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted mb-1 block">Count</label>
              <Input type="number" min={1} max={50} value={count} onChange={e => setCount(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Plan</label>
              <select
                value={plan}
                onChange={e => applyPreset(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-sm text-text-main"
              >
                {Object.entries(PLAN_PRESETS).map(([key, p]) => (
                  <option key={key} value={key}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Duration (days)</label>
              <Input type="number" min={1} value={durationDays} onChange={e => setDurationDays(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Max Uses</label>
              <Input type="number" min={1} value={maxUses} onChange={e => setMaxUses(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Daily Quota</label>
              <Input type="number" min={0} value={dailyLimit} onChange={e => setDailyLimit(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Monthly Quota</label>
              <Input type="number" min={0} value={monthlyLimit} onChange={e => setMonthlyLimit(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Label (optional)</label>
            <Input placeholder="e.g. Lynk.id batch" value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <Button variant="primary" fullWidth onClick={handleGenerate} disabled={generating}>
            {generating ? "Generating..." : `Generate ${count} Code${count > 1 ? "s" : ""}`}
          </Button>
        </div>
      )}
    </Modal>
  );
}
