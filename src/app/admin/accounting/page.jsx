// app/(admin)/accounting/page.jsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { FiDownload, FiCheckSquare, FiX } from "react-icons/fi";

// small helper to format currency (client-side)
function fmtCurrency(n) {
  try {
    return new Intl.NumberFormat("en-ZW", {
      style: "currency",
      currency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD",
    }).format(n);
  } catch (e) {
    return `${n}`;
  }
}

export default function AdminAccountingPage() {
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [qUser, setQUser] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(0);
  const limit = 50;

  // modal state
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderDetails, setOrderDetails] = useState(null);
  const [orderError, setOrderError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (qUser) params.set("user", qUser);
      if (type) params.set("type", type);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("limit", limit);
      params.set("skip", page * limit);

      const res = await fetch(
        `/api/admin/accounting/transactions?${params.toString()}`,
        { cache: "no-store" }
      );
      const body = await res.json();
      if (!body.ok)
        throw new Error(body.error || "Failed to load transactions");
      setTransactions(body.transactions || []);
      setTotal(body.total || 0);
      setSelected(new Set());
    } catch (err) {
      alert(err.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [qUser, type, from, to, page]);

  function toggle(id) {
    setSelected((prev) => {
      const c = new Set(prev);
      if (c.has(id)) c.delete(id);
      else c.add(id);
      return c;
    });
  }

  async function markReconciled() {
    if (selected.size === 0) return alert("Select rows to mark reconciled");
    if (!confirm(`Mark ${selected.size} transactions as reconciled?`)) return;
    try {
      // ensure we send plain string ids (handles possible object shapes)
      const transactionIds = Array.from(selected).map((id) =>
        id && typeof id === "object" && id._id ? String(id._id) : String(id)
      );

      const res = await fetch("/api/admin/accounting/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionIds,
          note: "Reconciled via admin UI",
        }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Failed to reconcile");
      alert(`Marked ${body.modifiedCount} transactions reconciled.`);
      await load();
    } catch (err) {
      alert(err.message || "Failed to reconcile");
    }
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (qUser) params.set("user", qUser);
    if (type) params.set("type", type);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    window.location.href = `/api/admin/accounting/export?${params.toString()}`;
  }

  // open order modal: fetch order details by id
  async function openOrder(orderId) {
    if (!orderId) {
      setOrderError("No linked order for this transaction");
      setOrderDetails(null);
      setOrderModalOpen(true);
      return;
    }
    setOrderLoading(true);
    setOrderError("");
    setOrderDetails(null);
    setOrderModalOpen(true);
    try {
      const res = await fetch(`/api/admin/orders/${String(orderId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to fetch order ${orderId}`);
      }
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Failed to load order");
      setOrderDetails(body.order);
    } catch (err) {
      setOrderError(String(err.message || err));
    } finally {
      setOrderLoading(false);
    }
  }

  function closeOrderModal() {
    setOrderModalOpen(false);
    setOrderDetails(null);
    setOrderError("");
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Accounting</h1>
          <p className="text-sm text-slate-300">
            Transaction ledger, export and reconciliation tools
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded"
          >
            <FiDownload /> Export CSV
          </button>
          <button
            onClick={markReconciled}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 px-3 py-2 rounded"
          >
            <FiCheckSquare /> Mark reconciled
          </button>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input
            value={qUser}
            onChange={(e) => setQUser(e.target.value)}
            placeholder="User reg or id"
            className="p-2 bg-slate-900 rounded text-slate-100"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="p-2 bg-slate-900 rounded text-slate-100"
          >
            <option value="">All types</option>
            <option value="topup">Top-up</option>
            <option value="order">Order</option>
            <option value="refund">Refund</option>
            <option value="adjustment">Adjustment</option>
            <option value="reconciliation">Reconciliation</option>
          </select>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="p-2 bg-slate-900 rounded text-slate-100"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="p-2 bg-slate-900 rounded text-slate-100"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full table-auto">
            <thead className="text-left text-sm text-slate-300">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">When</th>
                <th className="p-2">User</th>
                <th className="p-2">Type</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Before</th>
                <th className="p-2">After</th>
                <th className="p-2">Note</th>
                <th className="p-2">Reconciled</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t, i) => (
                <tr
                  key={t._id}
                  className="border-t border-slate-700 hover:bg-slate-900 cursor-pointer"
                  // open row when clicking row (but not when clicking the checkbox)
                  onClick={() => {
                    // t.relatedOrder may be an object id string or null
                    if (t.relatedOrder) openOrder(t.relatedOrder);
                    else openOrder(null);
                  }}
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(t._id)}
                      onChange={(e) => {
                        e.stopPropagation(); // prevent row click
                        toggle(t._id);
                      }}
                    />
                  </td>
                  <td className="p-2 text-sm text-slate-300">
                    {new Date(t.createdAt).toLocaleString()}
                  </td>
                  <td className="p-2 text-sm">
                    {t.user ? (
                      <div>
                        {t.user.name}{" "}
                        <span className="text-xs text-slate-400">
                          ({t.user.regNumber})
                        </span>
                      </div>
                    ) : (
                      <div className="text-slate-400">external</div>
                    )}
                  </td>
                  <td className="p-2 text-sm">{t.type}</td>
                  <td className="p-2 text-sm">{fmtCurrency(t.amount)}</td>
                  <td className="p-2 text-sm">
                    {fmtCurrency(t.balanceBefore)}
                  </td>
                  <td className="p-2 text-sm">{fmtCurrency(t.balanceAfter)}</td>
                  <td className="p-2 text-sm">{t.note}</td>
                  <td className="p-2 text-sm">
                    {t.meta?.reconciled
                      ? `Yes (${new Date(
                          t.meta.reconciledAt
                        ).toLocaleDateString()})`
                      : "No"}
                  </td>
                </tr>
              ))}
              {!transactions.length && (
                <tr>
                  <td className="p-4 text-slate-400" colSpan="9">
                    No transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-slate-300">
          <div>
            Showing {transactions.length} of {total}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-3 py-1 rounded border"
            >
              Prev
            </button>
            <div className="px-3 py-1">Page {page + 1}</div>
            <button
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded border"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Order details modal */}
      {orderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={closeOrderModal}
            aria-hidden
          />
          <div className="relative max-w-3xl w-full bg-slate-800 border border-slate-700 rounded-xl p-6 z-10 text-slate-100 shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <h2 className="text-lg font-semibold">Order details</h2>
              <button
                onClick={closeOrderModal}
                className="p-2 rounded hover:bg-slate-700"
                aria-label="Close"
              >
                <FiX />
              </button>
            </div>

            {orderLoading && <div className="mt-4">Loading…</div>}

            {!orderLoading && orderError && (
              <div className="mt-4 text-red-400">{orderError}</div>
            )}

            {!orderLoading && orderDetails && (
              <div className="mt-4 space-y-4 text-sm text-slate-200">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-400">Order code</div>
                    <div className="font-medium">{orderDetails.code}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Status</div>
                    <div className="font-medium">{orderDetails.status}</div>
                  </div>

                  <div>
                    <div className="text-xs text-slate-400">Placed</div>
                    <div>
                      {new Date(orderDetails.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Last updated</div>
                    <div>
                      {new Date(orderDetails.updatedAt).toLocaleString()}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-slate-400">User</div>
                    <div>
                      {orderDetails.user
                        ? `${orderDetails.user.name} (${
                            orderDetails.regNumber ||
                            orderDetails.user.regNumber
                          })`
                        : "External"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Prep by</div>
                    <div>
                      {orderDetails.prepBy ? String(orderDetails.prepBy) : "—"}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-400">Items</div>
                  <div className="mt-2 bg-slate-900 rounded p-3">
                    <table className="w-full text-sm">
                      <thead className="text-slate-400 text-left">
                        <tr>
                          <th className="pb-2">Name</th>
                          <th className="pb-2">Qty</th>
                          <th className="pb-2">Prepared</th>
                          <th className="pb-2">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderDetails.items.map((it) => (
                          <tr
                            key={String(it.product)}
                            className="border-t border-slate-700"
                          >
                            <td className="py-2">{it.name}</td>
                            <td className="py-2">{it.qty}</td>
                            <td className="py-2">{it.preparedCount || 0}</td>
                            <td className="py-2">{fmtCurrency(it.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-400">Total</div>
                    <div className="font-medium">
                      {fmtCurrency(orderDetails.total)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Meta</div>
                    <div className="text-xs text-slate-400 break-words">
                      {orderDetails.meta
                        ? JSON.stringify(orderDetails.meta)
                        : "—"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!orderLoading && !orderError && !orderDetails && (
              <div className="mt-4 text-slate-400">
                No order details to show.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
