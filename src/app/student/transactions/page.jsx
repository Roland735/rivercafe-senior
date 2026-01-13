// app/(student)/transactions/page.jsx
"use client";

import React, { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import Link from "next/link";

function fmtCurrency(n) {
  try {
    return new Intl.NumberFormat("en-ZW", {
      style: "currency",
      currency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD",
    }).format(Number(n || 0));
  } catch (e) {
    return `${n}`;
  }
}

function fmtDate(d) {
  try {
    const dt = new Date(d);
    return dt.toLocaleString();
  } catch (e) {
    return d;
  }
}

export default function StudentTransactionsPage() {
  const { data: session, status } = useSession(); // status: 'loading' | 'authenticated' | 'unauthenticated'
  const [tab, setTab] = useState("orders"); // 'orders' | 'transactions'
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingTx, setLoadingTx] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [error, setError] = useState(null);

  // Centralized fetch used on mount (once session resolves) or manual refresh.
  async function fetchAll({ force = false } = {}) {
    setError(null);

    // If session is still loading we bail out (don't fetch).
    if (status === "loading") return;

    // If user is unauthenticated show sign-in CTA instead of attempting API calls.
    if (status === "unauthenticated" && !force) {
      setProfile(null);
      setOrders([]);
      setTransactions([]);
      return;
    }

    // Fetch profile
    setLoadingProfile(true);
    try {
      const res = await fetch("/api/student/me", {
        cache: "no-store",
        credentials: "include",
      });
      const body = await res
        .json()
        .catch(() => ({ ok: false, error: "Invalid JSON" }));
      if (res.ok && body.ok) {
        setProfile(body.profile);
      } else {
        // keep profile null on error
        setProfile(null);
        if (body?.error) setError(body.error);
      }
    } catch (err) {
      console.error("fetchProfile error", err);
      setProfile(null);
      setError("Network error loading profile");
    } finally {
      setLoadingProfile(false);
    }

    // Fetch orders
    setLoadingOrders(true);
    try {
      const res = await fetch("/api/student/orders?limit=200", {
        cache: "no-store",
        credentials: "include",
      });
      const body = await res
        .json()
        .catch(() => ({ ok: false, error: "Invalid JSON" }));
      if (res.ok && body.ok) {
        setOrders(body.orders || []);
      } else {
        setOrders([]);
        if (body?.error)
          setError((prev) => prev || body.error || "Failed to load orders");
      }
    } catch (err) {
      console.error("fetchOrders error", err);
      setOrders([]);
      setError((prev) => prev || "Network error loading orders");
    } finally {
      setLoadingOrders(false);
    }

    // Fetch transactions/statement
    setLoadingTx(true);
    try {
      const res = await fetch("/api/student/statement?limit=200", {
        cache: "no-store",
        credentials: "include",
      });
      const body = await res
        .json()
        .catch(() => ({ ok: false, error: "Invalid JSON" }));
      if (res.ok && body.ok) {
        setTransactions(body.transactions || []);

        // If we don't yet have profile balance, use server-provided summary if available
        if (
          (!profile ||
            profile.balance === undefined ||
            profile.balance === null) &&
          body.summary?.currentBalance != null
        ) {
          setProfile((prev) => ({
            ...(prev || {}),
            balance: body.summary.currentBalance,
          }));
        }
      } else {
        setTransactions([]);
        if (body?.error)
          setError((prev) => prev || body.error || "Failed to load statement");
      }
    } catch (err) {
      console.error("fetchStatement error", err);
      setTransactions([]);
      setError((prev) => prev || "Network error loading statement");
    } finally {
      setLoadingTx(false);
    }
  }

  // Run fetchAll once when session resolves to authenticated/unauthenticated
  useEffect(() => {
    // Only attempt fetch once session status is known
    if (status === "loading") return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleRefresh = async () => {
    // Force fetch even if unauthenticated (might be dev fallback)
    await fetchAll({ force: true });
  };

  // Show skeleton while session is loading to avoid flicker
  if (status === "loading") {
    return (
      <section className="p-4 space-y-6">
        <div className="animate-pulse">
          <div className="h-6 w-1/3 bg-slate-700 rounded mb-2" />
          <div className="h-4 w-2/3 bg-slate-700 rounded mb-6" />
          <div className="h-40 bg-slate-800 rounded" />
        </div>
      </section>
    );
  }

  // If unauthenticated show friendly CTA (no flicker)
  if (status === "unauthenticated") {
    return (
      <section className="p-6">
        <div className="max-w-xl mx-auto text-center bg-slate-800 p-6 rounded">
          <h2 className="text-xl font-semibold mb-2">Please sign in</h2>
          <p className="text-sm text-slate-400 mb-4">
            You need to sign in to view your balance, orders and transactions.
          </p>
          <div className="flex justify-center gap-2">
            <button
              onClick={() => signIn()}
              className="px-4 py-2 rounded bg-cyan-600 text-white"
            >
              Sign in
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Authenticated UI
  return (
    <section className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your account</h1>
          <p className="text-sm text-slate-400">
            Balance, transactions and orders.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-sm text-slate-400">Balance</div>
            <div className="text-lg font-semibold">
              {loadingProfile
                ? "Loading…"
                : profile
                ? fmtCurrency(profile.balance)
                : "—"}
            </div>
          </div>
          <button
            onClick={handleRefresh}
            className="px-3 py-2 rounded bg-slate-700 text-sm text-white hover:bg-slate-600"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-slate-800 p-3 rounded">
        <div className="flex gap-2">
          <button
            className={`px-3 py-2 rounded ${
              tab === "orders"
                ? "bg-cyan-600 text-white"
                : "text-slate-300 hover:bg-slate-700"
            }`}
            onClick={() => setTab("orders")}
          >
            Orders
          </button>
          <button
            className={`px-3 py-2 rounded ${
              tab === "transactions"
                ? "bg-cyan-600 text-white"
                : "text-slate-300 hover:bg-slate-700"
            }`}
            onClick={() => setTab("transactions")}
          >
            Transactions / Statement
          </button>
          <div className="ml-auto text-slate-400 text-sm flex items-center gap-2">
            <span>Signed in as</span>
            <strong>
              {session?.user?.name || session?.user?.email || "You"}
            </strong>
          </div>
        </div>
      </div>

      {error && <div className="text-sm text-rose-400">{error}</div>}

      {tab === "orders" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent orders</h2>
            <Link href="/(student)/order" className="text-sm text-cyan-300">
              Place new order →
            </Link>
          </div>

          {loadingOrders ? (
            <div className="p-4 bg-slate-800 rounded animate-pulse">
              Loading orders…
            </div>
          ) : orders.length === 0 ? (
            <div className="p-4 bg-slate-800 rounded text-slate-400">
              No recent orders found.
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => (
                <div
                  key={o._id || o.id}
                  className="bg-slate-800 p-4 rounded flex justify-between items-start"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="text-sm text-slate-300">Code</div>
                      <div className="font-mono font-semibold text-slate-100">
                        {o.code}
                      </div>
                      <div
                        className="ml-4 text-xs px-2 py-1 rounded-full text-slate-800"
                        style={{ background: statusColor(o.status).bg }}
                      >
                        <span
                          className="text-xs"
                          style={{ color: statusColor(o.status).text }}
                        >
                          {o.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-auto text-sm text-slate-400">
                        {fmtDate(o.createdAt)}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div>
                        <div className="text-xs text-slate-400">Items</div>
                        <ul className="mt-1 text-sm text-slate-100">
                          {o.items?.map((it, idx) => (
                            <li key={idx} className="flex justify-between">
                              <span>
                                {it.name} ×{it.qty}
                              </span>
                              <span className="text-slate-400">
                                {fmtCurrency(it.price * it.qty)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <div className="text-xs text-slate-400">
                          Prep station
                        </div>
                        <div className="mt-1 text-sm text-slate-100">
                          {o.prepStation || "—"}
                        </div>
                        <div className="text-xs text-slate-400 mt-2">
                          Window
                        </div>
                        <div className="mt-1 text-sm text-slate-100">
                          {o.orderingWindow || "—"}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs text-slate-400">Total</div>
                        <div className="mt-1 text-lg font-semibold">
                          {fmtCurrency(o.total)}
                        </div>
                        <div className="mt-4">
                          <button className="px-3 py-2 rounded border text-sm text-slate-200">
                            View details
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "transactions" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Transaction history / Statement
            </h2>
            <div className="text-sm text-slate-400">Showing most recent</div>
          </div>

          {loadingTx ? (
            <div className="p-4 bg-slate-800 rounded animate-pulse">
              Loading statement…
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-4 bg-slate-800 rounded text-slate-400">
              No transactions found.
            </div>
          ) : (
            <div className="bg-slate-800 rounded">
              <table className="w-full text-left border-collapse">
                <thead className="text-xs text-slate-400 border-b border-slate-700">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Balance</th>
                    <th className="px-4 py-3">Note / Order</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="text-sm text-slate-100 border-b border-slate-700"
                    >
                      <td className="px-4 py-3 align-top">
                        {fmtDate(tx.createdAt)}
                      </td>
                      <td className="px-4 py-3 align-top">{tx.type}</td>
                      <td className="px-4 py-3 align-top">
                        {fmtCurrency(tx.amount)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {fmtCurrency(tx.balanceAfter)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-xs text-slate-400 mb-1">
                          {tx.note}
                        </div>
                        {tx.relatedOrder ? (
                          <Link
                            href={`/student/orders/${tx.relatedOrder.id}`}
                            className="text-cyan-300 text-sm"
                          >
                            Order {tx.relatedOrder.code} ·{" "}
                            {tx.relatedOrder.status}
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function statusColor(status) {
  switch ((status || "").toLowerCase()) {
    case "placed":
      return { bg: "#fde68a", text: "#92400e" };
    case "preparing":
      return { bg: "#bfdbfe", text: "#1e3a8a" };
    case "ready":
      return { bg: "#bbf7d0", text: "#065f46" };
    case "collected":
      return { bg: "#e0e7ff", text: "#3730a3" };
    case "cancelled":
      return { bg: "#fecaca", text: "#991b1b" };
    default:
      return { bg: "#e2e8f0", text: "#0f172a" };
  }
}
