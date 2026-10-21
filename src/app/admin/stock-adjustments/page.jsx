"use client";

import { useEffect, useState } from "react";

export default function StockAdjustmentsPage() {
  const [inventories, setInventories] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [form, setForm] = useState({ inventoryId: "", quantity: 1, reason: "expired", note: "", occurredAt: new Date().toISOString().slice(0, 10) });
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [inventoryResponse, adjustmentResponse] = await Promise.all([
      fetch("/api/admin/inventory", { cache: "no-store" }),
      fetch("/api/admin/stock-adjustments", { cache: "no-store" }),
    ]);
    const inventoryBody = await inventoryResponse.json();
    const adjustmentBody = await adjustmentResponse.json();
    if (!inventoryResponse.ok) throw new Error(inventoryBody.error || "Could not load stock");
    if (!adjustmentResponse.ok) throw new Error(adjustmentBody.error || "Could not load adjustments");
    setInventories((inventoryBody.inventories || []).filter((row) => row.active));
    setAdjustments(adjustmentBody.adjustments || []);
  }

  useEffect(() => { load().catch((error) => setMessage({ type: "error", text: error.message })); }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/admin/stock-adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not record adjustment");
      setMessage({ type: "success", text: "Stock loss recorded and inventory reduced." });
      setForm((current) => ({ ...current, quantity: 1, note: "" }));
      await load();
    } catch (error) { setMessage({ type: "error", text: error.message }); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Expired stock and losses</h1><p className="text-slate-400 text-sm mt-1">Every entry reduces stock and records who made the adjustment.</p></div>
    <form onSubmit={submit} className="grid md:grid-cols-2 gap-4 rounded-xl border border-slate-700 bg-slate-800 p-5">
      <label className="text-sm">Stock item<select required className="mt-1 w-full rounded bg-slate-900 p-3" value={form.inventoryId} onChange={(e) => setForm({ ...form, inventoryId: e.target.value })}><option value="">Select product and location</option>{inventories.map((row) => <option key={row._id} value={row._id}>{row.product?.name || "Unknown"} — {row.location || "Main"} ({row.quantity} available)</option>)}</select></label>
      <label className="text-sm">Quantity<input required min="0.01" step="0.01" type="number" className="mt-1 w-full rounded bg-slate-900 p-3" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })}/></label>
      <label className="text-sm">Reason<select className="mt-1 w-full rounded bg-slate-900 p-3" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}><option value="expired">Expired</option><option value="damaged">Damaged</option><option value="spoiled">Spoiled</option><option value="missing">Missing</option><option value="other">Other</option></select></label>
      <label className="text-sm">Date<input required type="date" className="mt-1 w-full rounded bg-slate-900 p-3" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}/></label>
      <label className="text-sm md:col-span-2">Notes<textarea className="mt-1 w-full rounded bg-slate-900 p-3" rows="2" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional explanation" /></label>
      {message && <div className={`md:col-span-2 rounded p-3 ${message.type === "error" ? "bg-red-950 text-red-200" : "bg-emerald-950 text-emerald-200"}`}>{message.text}</div>}
      <button disabled={busy} className="rounded bg-red-600 px-4 py-3 font-medium disabled:opacity-50">{busy ? "Recording…" : "Record and deduct stock"}</button>
    </form>
    <div className="overflow-x-auto rounded-xl border border-slate-700"><table className="w-full text-sm"><thead className="bg-slate-800 text-left"><tr><th className="p-3">Date</th><th className="p-3">Product</th><th className="p-3">Reason</th><th className="p-3">Quantity</th><th className="p-3">Before → After</th><th className="p-3">Recorded by</th><th className="p-3">Notes</th></tr></thead><tbody>{adjustments.map((row) => <tr key={row._id} className="border-t border-slate-700"><td className="p-3">{new Date(row.occurredAt).toLocaleDateString()}</td><td className="p-3">{row.product?.name} <span className="text-slate-500">({row.inventory?.location || "Main"})</span></td><td className="p-3 capitalize">{row.reason}</td><td className="p-3">{row.quantity}</td><td className="p-3">{row.stockBefore} → {row.stockAfter}</td><td className="p-3">{row.recordedBy?.name || row.recordedBy?.email || "Inventory user"}</td><td className="p-3">{row.note || "—"}</td></tr>)}{!adjustments.length && <tr><td colSpan="7" className="p-6 text-center text-slate-400">No stock losses recorded.</td></tr>}</tbody></table></div>
  </div>;
}
