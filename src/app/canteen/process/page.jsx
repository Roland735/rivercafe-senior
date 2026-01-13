// app/(canteen)/process/page.jsx
"use client";

import React, { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { FiCheckCircle, FiAlertCircle, FiLogIn } from "react-icons/fi";

/**
 * Canteen Process Page (list by date OR all uncollected)
 *
 * - Default on mount: Show ALL uncollected orders (no date filter).
 * - Toggle "Show all uncollected" to false to use the date picker and load orders for that date.
 * - Search by student name (server-side search that checks user.name, regNumber, or meta.issuedToName).
 * - Click an order to view details and then click "Mark Collected".
 */

function money(n) {
  try {
    return new Intl.NumberFormat("en-ZW", {
      style: "currency",
      currency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD",
    }).format(n);
  } catch (e) {
    return (n || 0).toFixed(2);
  }
}

export default function ProcessOrderPage() {
  const { data: session, status } = useSession();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showAllUncollected, setShowAllUncollected] = useState(true); // default true -> load all uncollected on mount
  const [q, setQ] = useState(""); // student name search
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [processingIds, setProcessingIds] = useState(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    // auto-load initial set: all uncollected
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadOrders() {
    setError("");
    setSelected(null);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (!showAllUncollected) {
        // include date filter only when showAllUncollected is false
        if (date) params.set("date", date);
      }
      if (q && q.trim()) params.set("q", q.trim());

      const url = params.toString()
        ? `/api/canteen/process?${params.toString()}`
        : `/api/canteen/process`;
      const res = await fetch(url, { cache: "no-store" });
      const body = await res
        .json()
        .catch(() => ({ ok: false, error: "Invalid JSON" }));
      if (!res.ok || !body.ok) {
        setError(body?.error || `Failed to load (${res.status})`);
        setOrders([]);
      } else {
        setOrders(body.orders || []);
      }
    } catch (err) {
      console.error(err);
      setError("Network error while loading orders.");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }

  async function markCollected(orderId) {
    if (!orderId) return;
    setError("");
    setProcessingIds((prev) => new Set(prev).add(orderId));
    try {
      const res = await fetch("/api/canteen/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const body = await res
        .json()
        .catch(() => ({ ok: false, error: "Invalid JSON" }));
      if (!res.ok || !body.ok) {
        setError(body?.error || `Failed to mark collected (${res.status})`);
        setProcessingIds((prev) => {
          const c = new Set(prev);
          c.delete(orderId);
          return c;
        });
      } else {
        // update local order state
        setOrders((prev) =>
          prev.map((o) => {
            if ((o.id || o._id) == orderId || o.id === orderId) {
              return {
                ...o,
                status: "collected",
                collectedAt: body.collectedAt || new Date().toISOString(),
              };
            }
            return o;
          })
        );
        // if that was the selected order, update selected too
        setSelected(
          (prev) =>
            prev &&
            ((prev.id || prev._id) == orderId
              ? {
                  ...prev,
                  status: "collected",
                  collectedAt: body.collectedAt || new Date().toISOString(),
                }
              : prev)
        );
        setProcessingIds((prev) => {
          const c = new Set(prev);
          c.delete(orderId);
          return c;
        });
      }
    } catch (err) {
      console.error(err);
      setError("Network error while processing collection.");
      setProcessingIds((prev) => {
        const c = new Set(prev);
        c.delete(orderId);
        return c;
      });
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-300">Loading session...</div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-8 text-center">
          <div className="bg-cyan-900/20 p-4 rounded-full inline-flex items-center justify-center mb-4">
            <FiLogIn className="text-cyan-400" size={28} />
          </div>
          <h2 className="text-xl font-semibold text-slate-100 mb-2">
            Canteen Collection
          </h2>
          <p className="text-sm text-slate-400 mb-6">
            Sign in to view and process orders.
          </p>
          <button
            onClick={() => signIn()}
            className="px-6 py-3 rounded-lg bg-cyan-600 text-white w-full"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl text-slate-100 font-bold">
            Process Collections
          </h1>
          <div className="text-sm text-slate-400">
            Operator: {session?.user?.name || session?.user?.email || "Unknown"}
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-3">
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400">
                Show all uncollected
              </label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  checked={showAllUncollected}
                  onChange={(e) => setShowAllUncollected(e.target.checked)}
                />
                <div className="text-sm text-slate-300">
                  When checked, date is ignored and all uncollected orders are
                  returned
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400">Select date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={showAllUncollected}
                className="mt-1 w-full rounded p-2 bg-slate-900 text-slate-100 border border-slate-700"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs text-slate-400">
                Search student name
              </label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name or reg"
                className="mt-1 w-full rounded p-2 bg-slate-900 text-slate-100 border border-slate-700"
              />
            </div>

            <div className="flex items-end gap-2">
              <button
                onClick={loadOrders}
                disabled={loading}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-white"
              >
                {loading ? "Loading..." : "Load Orders"}
              </button>
              <button
                onClick={() => {
                  setOrders([]);
                  setSelected(null);
                  setError("");
                }}
                className="px-4 py-2 border rounded text-slate-200"
              >
                Clear
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800 p-3 rounded text-red-200 flex items-center gap-2">
              <FiAlertCircle /> <div>{error}</div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1 bg-slate-900 rounded p-3 max-h-[60vh] overflow-y-auto">
              <div className="text-sm text-slate-400 mb-2">
                Orders ({orders.length})
              </div>
              {orders.length === 0 && (
                <div className="text-slate-500 text-sm">No orders found.</div>
              )}
              <ul>
                {orders.map((o) => (
                  <li
                    key={o.id || o._id}
                    className={`p-2 rounded mb-2 cursor-pointer ${
                      selected && selected.id === (o.id || o._id)
                        ? "bg-slate-800 border border-cyan-600"
                        : "bg-slate-800 hover:bg-slate-700"
                    }`}
                    onClick={() => setSelected(o)}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-mono text-slate-100 text-sm">
                          {o.code}
                        </div>
                        <div className="text-xs text-slate-400">
                          {o.studentName ||
                            (o.external
                              ? o.issuedToName || "External"
                              : o.regNumber || "Student")}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-slate-200 font-medium">
                          {money(o.total)}
                        </div>
                        <div className="text-xs text-slate-400">
                          {new Date(o.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Status: <span className="uppercase">{o.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-2 bg-slate-900 rounded p-4 max-h-[60vh] overflow-y-auto">
              {!selected ? (
                <div className="text-slate-400">
                  Select an order to see details and mark it collected.
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="font-mono text-slate-100 text-lg">
                        {selected.code}
                      </div>
                      <div className="text-sm text-slate-400">
                        Created: {new Date(selected.createdAt).toLocaleString()}
                      </div>
                      <div className="text-sm text-slate-400">
                        Status:{" "}
                        <span className="uppercase font-medium">
                          {selected.status}
                        </span>
                      </div>
                      {selected.studentName && (
                        <div className="text-sm text-slate-400">
                          Name: {selected.studentName}
                        </div>
                      )}
                      {selected.external && (
                        <div className="text-sm text-slate-400">
                          Issued to: {selected.issuedToName || "—"}
                        </div>
                      )}
                      {!selected.external && selected.regNumber && (
                        <div className="text-sm text-slate-400">
                          Reg: {selected.regNumber}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-400">Total</div>
                      <div className="text-2xl font-bold text-slate-100">
                        {money(selected.total)}
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-700 mb-4">
                    {selected.items?.map((it, idx) => (
                      <div
                        key={idx}
                        className="py-2 flex justify-between items-center"
                      >
                        <div>
                          <div>{it.name}</div>
                          {it.notes && (
                            <div className="text-xs text-slate-400">
                              {it.notes}
                            </div>
                          )}
                        </div>
                        <div className="text-slate-400">×{it.qty}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => markCollected(selected.id || selected._id)}
                      disabled={
                        processingIds.has(selected.id || selected._id) ||
                        selected.status === "collected"
                      }
                      className={`px-4 py-2 rounded flex items-center gap-2 ${
                        processingIds.has(selected.id || selected._id) ||
                        selected.status === "collected"
                          ? "bg-slate-600 text-slate-300 cursor-not-allowed"
                          : "bg-green-600 text-white"
                      }`}
                    >
                      <FiCheckCircle />
                      {processingIds.has(selected.id || selected._id)
                        ? "Processing..."
                        : selected.status === "collected"
                        ? "Collected"
                        : "Mark Collected"}
                    </button>

                    <button
                      onClick={() => {
                        setSelected(null);
                        setError("");
                      }}
                      className="px-4 py-2 rounded bg-slate-700 text-slate-200"
                    >
                      Back to list
                    </button>
                  </div>

                  {selected.status === "collected" && (
                    <div className="mt-3 text-sm text-green-300">
                      Order marked collected.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
