// app/(admin)/accounting/page.jsx
"use client";

import React, { useEffect, useState } from "react";
import {
  FiDownload,
  FiCheckSquare,
  FiFilter,
  FiSearch,
  FiX,
  FiChevronLeft,
  FiChevronRight,
  FiBarChart2,
  FiDollarSign,
  FiUser,
  FiCalendar,
  FiType,
  FiCheckCircle,
  FiClock,
  FiAlertCircle,
} from "react-icons/fi";

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

// Helper to format dates
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [stats, setStats] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const limit = 20;

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

      // Load stats if available
      if (body.stats) {
        setStats(body.stats);
      }
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
    if (selected.size === 0)
      return alert("Select transactions to mark as reconciled");
    if (!confirm(`Mark ${selected.size} transactions as reconciled?`)) return;
    try {
      const res = await fetch("/api/admin/accounting/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionIds: Array.from(selected),
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

  const clearFilters = () => {
    setQUser("");
    setType("");
    setFrom("");
    setTo("");
    setPage(0);
  };

  const hasFilters = qUser || type || from || to;

  // Calculate pagination info
  const totalPages = Math.ceil(total / limit);
  const startItem = page * limit + 1;
  const endItem = Math.min((page + 1) * limit, total);

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            Accounting Dashboard
          </h1>
          <p className="text-sm text-slate-300 mt-1">
            Transaction ledger, export and reconciliation tools
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2 rounded-lg transition-colors duration-200"
          >
            <FiFilter size={18} /> Filters
            {hasFilters && (
              <span className="bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                {[qUser, type, from, to].filter(Boolean).length}
              </span>
            )}
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
          >
            <FiDownload size={18} /> Export CSV
          </button>
          <button
            onClick={markReconciled}
            disabled={selected.size === 0}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 disabled:cursor-not-allowed text-slate-900 px-4 py-2 rounded-lg transition-colors duration-200"
          >
            <FiCheckSquare size={18} /> Mark Reconciled ({selected.size})
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Total Revenue</p>
                <p className="text-xl font-semibold text-slate-100 mt-1">
                  {fmtCurrency(stats.totalRevenue || 0)}
                </p>
              </div>
              <div className="p-2 bg-green-500/10 rounded-lg">
                <FiDollarSign className="text-green-400" size={20} />
              </div>
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Pending Reconciliation</p>
                <p className="text-xl font-semibold text-slate-100 mt-1">
                  {stats.pendingReconciliation || 0}
                </p>
              </div>
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <FiAlertCircle className="text-amber-400" size={20} />
              </div>
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Transactions</p>
                <p className="text-xl font-semibold text-slate-100 mt-1">
                  {total}
                </p>
              </div>
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <FiBarChart2 className="text-blue-400" size={20} />
              </div>
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Avg. Transaction</p>
                <p className="text-xl font-semibold text-slate-100 mt-1">
                  {fmtCurrency(stats.averageTransaction || 0)}
                </p>
              </div>
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <FiCheckCircle className="text-purple-400" size={20} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-100">Filters</h3>
            <div className="flex items-center gap-2">
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="text-sm text-slate-300 hover:text-slate-100 flex items-center gap-1"
                >
                  Clear all
                </button>
              )}
              <button
                onClick={() => setShowFilters(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-700/50"
              >
                <FiX size={20} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-slate-300 flex items-center gap-2">
                <FiUser size={16} /> User
              </label>
              <input
                value={qUser}
                onChange={(e) => setQUser(e.target.value)}
                placeholder="Registration number or name"
                className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-300 flex items-center gap-2">
                <FiType size={16} /> Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">All types</option>
                <option value="topup">Top-up</option>
                <option value="order">Order</option>
                <option value="refund">Refund</option>
                <option value="adjustment">Adjustment</option>
                <option value="reconciliation">Reconciliation</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-300 flex items-center gap-2">
                <FiCalendar size={16} /> From
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-300 flex items-center gap-2">
                <FiCalendar size={16} /> To
              </label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Transactions Table */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <div className="p-4 md:p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-slate-100 text-lg">
              Transactions
            </h3>
            <div className="text-sm text-slate-300">
              {loading
                ? "Loading..."
                : `Showing ${startItem}-${endItem} of ${total}`}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="p-3 text-left text-sm text-slate-300 font-medium">
                    <input
                      type="checkbox"
                      checked={
                        selected.size === transactions.length &&
                        transactions.length > 0
                      }
                      onChange={() => {
                        if (selected.size === transactions.length) {
                          setSelected(new Set());
                        } else {
                          setSelected(new Set(transactions.map((t) => t._id)));
                        }
                      }}
                      className="rounded bg-slate-700 border-slate-600 text-red-500 focus:ring-red-500 focus:ring-offset-slate-800"
                    />
                  </th>
                  <th className="p-3 text-left text-sm text-slate-300 font-medium">
                    Date & Time
                  </th>
                  <th className="p-3 text-left text-sm text-slate-300 font-medium">
                    User
                  </th>
                  <th className="p-3 text-left text-sm text-slate-300 font-medium">
                    Type
                  </th>
                  <th className="p-3 text-left text-sm text-slate-300 font-medium">
                    Amount
                  </th>
                  <th className="p-3 text-left text-sm text-slate-300 font-medium">
                    Balance
                  </th>
                  <th className="p-3 text-left text-sm text-slate-300 font-medium">
                    Note
                  </th>
                  <th className="p-3 text-left text-sm text-slate-300 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr
                    key={t._id}
                    className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors duration-150"
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(t._id)}
                        onChange={() => toggle(t._id)}
                        className="rounded bg-slate-700 border-slate-600 text-red-500 focus:ring-red-500 focus:ring-offset-slate-800"
                      />
                    </td>
                    <td className="p-3">
                      <div className="text-sm text-slate-300">
                        {formatDate(t.createdAt)}
                      </div>
                    </td>
                    <td className="p-3">
                      {t.user ? (
                        <div>
                          <div className="text-sm text-slate-100 font-medium">
                            {t.user.name}
                          </div>
                          <div className="text-xs text-slate-400">
                            {t.user.regNumber}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-400">External</div>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          t.type === "topup"
                            ? "bg-green-900/30 text-green-400"
                            : t.type === "order"
                            ? "bg-blue-900/30 text-blue-400"
                            : t.type === "refund"
                            ? "bg-amber-900/30 text-amber-400"
                            : "bg-purple-900/30 text-purple-400"
                        }`}
                      >
                        {t.type}
                      </span>
                    </td>
                    <td className="p-3">
                      <div
                        className={`text-sm font-medium ${
                          t.amount >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {fmtCurrency(t.amount)}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="text-sm text-slate-300">
                        <div className="text-xs text-slate-400">
                          Before: {fmtCurrency(t.balanceBefore)}
                        </div>
                        <div className="text-slate-100">
                          After: {fmtCurrency(t.balanceAfter)}
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="text-sm text-slate-300 max-w-xs truncate">
                        {t.note}
                      </div>
                    </td>
                    <td className="p-3">
                      {t.meta?.reconciled ? (
                        <div className="flex items-center gap-1 text-sm text-green-400">
                          <FiCheckCircle size={14} /> Reconciled
                          <div className="text-xs text-slate-400">
                            {new Date(t.meta.reconciledAt).toLocaleDateString()}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-amber-400">Pending</div>
                      )}
                    </td>
                  </tr>
                ))}
                {!transactions.length && !loading && (
                  <tr>
                    <td colSpan="8" className="p-8 text-center text-slate-400">
                      <FiBarChart2 className="mx-auto mb-2" size={32} />
                      <p>No transactions found</p>
                      {hasFilters && (
                        <button
                          onClick={clearFilters}
                          className="text-red-400 hover:text-red-300 mt-2 text-sm"
                        >
                          Clear filters
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <div className="text-sm text-slate-400">
                Page {page + 1} of {totalPages}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                >
                  <FiChevronLeft size={16} /> Previous
                </button>
                <button
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                >
                  Next <FiChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
