"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useSession, signIn } from "next-auth/react";
import ProductCard from "../components/canteen/ProductCard";
import {
  FiRefreshCw,
  FiBox,
  FiClock,
  FiCheckCircle,
  FiAlertCircle,
  FiLogIn,
  FiShoppingBag,
  FiCoffee,
} from "react-icons/fi";

/*
  Canteen dashboard (updated)
  - Prevents periodic refresh from stomping optimistic updates on slow networks / Vercel
  - Tracks optimistic adjustments per-product (applied to server summaries until confirmed)
  - Pauses auto-refresh while prepare/unprepare is pending for that product
  - Uses functional setState to avoid stale closures
*/

export default function CanteenHome() {
  const { data: session, status } = useSession();
  const [groups, setGroups] = useState({
    placed: [],
    preparing: [],
    ready: [],
  });
  const [productSummary, setProductSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // pendingPrepare state + ref (avoids stale closures)
  const [pendingPrepare, setPendingPrepare] = useState(new Set());
  const pendingPrepareRef = useRef(new Set());

  // optimistic adjustments map: productName -> integer delta (can be negative for prepare)
  // stored in a ref so updates don't cause re-renders; applied after each fetchGroups
  const optimisticAdjustmentsRef = useRef(new Map());

  // Pause auto-refresh while any pending prepares exist
  const pausedRefreshRef = useRef(false);

  const fetchingRef = useRef(false);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  // helpers to keep ref & state in sync
  const addPending = useCallback((name) => {
    // update ref
    pendingPrepareRef.current = new Set(pendingPrepareRef.current).add(name);
    // update state to trigger UI update
    setPendingPrepare(new Set(pendingPrepareRef.current));
    // pause refresh while pending exists
    pausedRefreshRef.current = true;
  }, []);

  const removePending = useCallback((name) => {
    const next = new Set(pendingPrepareRef.current);
    next.delete(name);
    pendingPrepareRef.current = next;
    setPendingPrepare(new Set(next));
    // unpause refresh only if no pending items remain
    if (next.size === 0) pausedRefreshRef.current = false;
  }, []);

  // update optimistic adjustments map (delta can be +1 or -1 or any integer)
  const applyOptimisticDelta = useCallback((productName, delta) => {
    const m = new Map(optimisticAdjustmentsRef.current);
    const cur = m.get(productName) || 0;
    const next = cur + delta;
    if (next === 0) {
      m.delete(productName);
    } else {
      m.set(productName, next);
    }
    optimisticAdjustmentsRef.current = m;
  }, []);

  const clearOptimisticForProduct = useCallback((productName) => {
    const m = new Map(optimisticAdjustmentsRef.current);
    if (m.has(productName)) {
      m.delete(productName);
      optimisticAdjustmentsRef.current = m;
    }
  }, []);

  // fetch groups from server (force bypasses fetchingRef and pausedRefreshRef guards)
  const fetchGroups = useCallback(
    async (opts = { force: false }) => {
      if (fetchingRef.current && !opts.force) return;
      if (!opts.force && pausedRefreshRef.current) {
        // skip regular refresh when paused (pending updates in-flight)
        return;
      }
      if (status !== "authenticated") return;

      fetchingRef.current = true;
      setLoading(true);
      setError(null);

      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch (e) {}
      }
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch("/api/canteen/orders", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          signal: ac.signal,
        });

        if (!mountedRef.current) return;

        const body = await res
          .json()
          .catch(() => ({ ok: false, error: "Invalid JSON" }));
        if (!res.ok || !body.ok) {
          setError(body?.error || `Failed to load orders (${res.status})`);
          setGroups({ placed: [], preparing: [], ready: [] });
          setProductSummary([]);
        } else {
          const newGroups = body.groups || {
            placed: [],
            preparing: [],
            ready: [],
          };

          // compute server-side product summary
          const serverSummary = computeProductSummary(newGroups);

          // apply optimistic adjustments (so UI doesn't jump back while user is expecting change)
          const adjustedSummary =
            optimisticAdjustmentsRef.current &&
            optimisticAdjustmentsRef.current.size
              ? serverSummary.map((p) => {
                  const delta =
                    optimisticAdjustmentsRef.current.get(p.name) || 0;
                  return {
                    ...p,
                    // unprepared is decreased by negative deltas (prepare -> delta = -1)
                    unprepared: Math.max(0, (p.unprepared || 0) + delta),
                  };
                })
              : serverSummary;

          setGroups(newGroups);
          setProductSummary(adjustedSummary);
          setLastUpdated(new Date());
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("fetchGroups error", err);
          setError("Network error loading orders");
        }
      } finally {
        fetchingRef.current = false;
        if (mountedRef.current) setLoading(false);
      }
    },
    [status]
  );

  useEffect(() => {
    mountedRef.current = true;
    if (status === "authenticated") fetchGroups({ force: true });

    const interval = setInterval(() => {
      if (status === "authenticated") fetchGroups();
    }, 6000);

    return () => {
      mountedRef.current = false;
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch (e) {}
      }
      clearInterval(interval);
    };
  }, [status, fetchGroups]);

  // compute product summary, preferring per-item preparedCount if present
  const computeProductSummary = useCallback((groupsObj) => {
    const map = new Map();

    const add = (name, { total = 0, unprepared = 0, ready = 0 }) => {
      const n = map.get(name) || {
        name,
        totalOrdered: 0,
        unprepared: 0,
        ready: 0,
      };
      n.totalOrdered += total;
      n.unprepared += unprepared;
      n.ready += ready;
      map.set(name, n);
    };

    const processNonReady = (o) => {
      if (!o || !o.items) return;

      // If any item has item-level preparedCount (or prepared) use exact per-item accounting
      const hasItemPrepared = o.items.some(
        (it) =>
          it && (it.preparedCount !== undefined || it.prepared !== undefined)
      );
      if (hasItemPrepared) {
        for (const it of o.items) {
          const qty = Number(it.qty || 0);
          const prepared = Math.max(
            0,
            Number(it.preparedCount ?? it.prepared ?? 0)
          );
          const unprepared = Math.max(0, qty - prepared);
          add(it.name || "Unknown", { total: qty, unprepared, ready: 0 });
        }
        return;
      }

      // Fallback: proportional allocation from order.meta.preparedCount (legacy)
      const totalQty = o.items.reduce((s, it) => s + Number(it.qty || 0), 0);
      const prepared = Math.max(0, Number(o.meta?.preparedCount || 0));

      const allocations = o.items.map((it) => ({
        name: it.name || "Unknown",
        qty: Number(it.qty || 0),
        alloc: 0,
      }));

      if (totalQty <= 0) {
        allocations.forEach((it) =>
          add(it.name, { total: it.qty, unprepared: it.qty })
        );
        return;
      }

      let allocated = 0;
      for (let i = 0; i < allocations.length; i++) {
        const it = allocations[i];
        const prop = it.qty / totalQty;
        const a = Math.min(it.qty, Math.floor(prepared * prop));
        it.alloc = a;
        allocated += a;
      }

      let remainder = Math.min(prepared - allocated, totalQty - allocated);
      if (remainder > 0) {
        for (let i = 0; i < allocations.length && remainder > 0; i++) {
          const it = allocations[i];
          const can = it.qty - it.alloc;
          if (can <= 0) continue;
          const give = Math.min(can, remainder);
          it.alloc += give;
          remainder -= give;
        }
      }

      allocations.forEach((it) => {
        const unprepared = Math.max(0, it.qty - it.alloc);
        add(it.name, { total: it.qty, unprepared, ready: 0 });
      });
    };

    const processReady = (o) => {
      if (!o || !o.items) return;
      for (const it of o.items) {
        add(it.name || "Unknown", {
          total: Number(it.qty || 0),
          unprepared: 0,
          ready: Number(it.qty || 0),
        });
      }
    };

    (groupsObj.placed || []).forEach(processNonReady);
    (groupsObj.preparing || []).forEach(processNonReady);
    (groupsObj.ready || []).forEach(processReady);

    return Array.from(map.values()).sort(
      (a, b) =>
        b.unprepared - a.unprepared ||
        b.ready - a.ready ||
        a.name.localeCompare(b.name)
    );
  }, []);

  useEffect(() => {
    const summary = computeProductSummary(groups);
    // apply optimistic adjustments if any
    const adjusted =
      optimisticAdjustmentsRef.current && optimisticAdjustmentsRef.current.size
        ? summary.map((p) => {
            const delta = optimisticAdjustmentsRef.current.get(p.name) || 0;
            return {
              ...p,
              unprepared: Math.max(0, (p.unprepared || 0) + delta),
            };
          })
        : summary;
    setProductSummary(adjusted);
  }, [groups, computeProductSummary]);

  // merge server-returned order into local groups (so UI shows authoritative change)
  const mergeServerOrderIntoGroups = useCallback(
    (orderFromServer) => {
      if (!orderFromServer) return;

      const oid = String(orderFromServer.id || orderFromServer._id || "");
      const normalized = {
        id: oid,
        code: orderFromServer.code || orderFromServer.code || null,
        status: orderFromServer.status || null,
        items: (orderFromServer.items || []).map((it) => ({
          name: it.name,
          qty: it.qty,
          preparedCount:
            it.preparedCount !== undefined
              ? Number(it.preparedCount)
              : it.prepared !== undefined
              ? Number(it.prepared)
              : undefined,
        })),
        total: orderFromServer.total || orderFromServer.amount || null,
        regNumber: orderFromServer.regNumber || null,
        createdAt: orderFromServer.createdAt || new Date().toISOString(),
      };

      setGroups((prevGroups) => {
        const removeById = (arr) =>
          (arr || []).filter((o) => String(o.id || o._id || "") !== oid);

        const newPlaced = removeById(prevGroups.placed);
        const newPreparing = removeById(prevGroups.preparing);
        const newReady = removeById(prevGroups.ready);

        if (normalized.status === "placed") {
          newPlaced.unshift(normalized);
        } else if (normalized.status === "preparing") {
          newPreparing.unshift(normalized);
        } else if (normalized.status === "ready") {
          newReady.unshift(normalized);
        } else {
          newPreparing.unshift(normalized);
        }

        const merged = {
          placed: newPlaced,
          preparing: newPreparing,
          ready: newReady,
        };

        // recompute product summary from merged groups immediately
        try {
          const serverSummary = computeProductSummary(merged);
          // clear optimistic adjustments for items present in the returned order (server authoritative)
          const m = new Map(optimisticAdjustmentsRef.current);
          for (const it of normalized.items || []) {
            if (m.has(it.name)) m.delete(it.name);
          }
          optimisticAdjustmentsRef.current = m;

          // apply remaining adjustments
          const adjusted =
            m && m.size
              ? serverSummary.map((p) => {
                  const delta = m.get(p.name) || 0;
                  return {
                    ...p,
                    unprepared: Math.max(0, (p.unprepared || 0) + delta),
                  };
                })
              : serverSummary;

          // update visible summary directly so UI reflects authoritative + adjustments
          setProductSummary(adjusted);
        } catch (err) {
          console.warn("computeProductSummary failed during merge:", err);
        }

        return merged;
      });
    },
    [computeProductSummary]
  );

  // product-level prepare/unprepare: optimistic update + pending guard + merge server order on success
  const callPrepareApi = useCallback(
    async (productName, action = "prepare") => {
      if (!productName) return { ok: false, error: "productName required" };
      if (pendingPrepareRef.current.has(productName)) {
        return { ok: false, error: "Already processing this product" };
      }

      // compute optimistic delta: prepare -> -1 unprepared, unprepare -> +1 unprepared
      const delta = action === "prepare" ? -1 : 1;
      // register optimistic delta (persist across interim fetches)
      applyOptimisticDelta(productName, delta);

      // Set pending (ref + state) and pause refresh
      addPending(productName);

      // Optimistic UI update (decrement/increment visible unprepared immediately)
      setProductSummary((prev) =>
        prev.map((p) => {
          if (p.name !== productName) return p;
          if (action === "prepare") {
            return { ...p, unprepared: Math.max(0, (p.unprepared || 0) - 1) };
          } else {
            return { ...p, unprepared: (p.unprepared || 0) + 1 };
          }
        })
      );

      try {
        const res = await fetch("/api/canteen/product/prepare", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productName, action }),
        });

        const body = await res
          .json()
          .catch(() => ({ ok: false, error: "Invalid JSON" }));
        if (!res.ok || !body.ok) {
          // revert optimistic change by re-syncing groups (server didn't accept)
          await fetchGroups({ force: true });
          // clear optimistic delta for this product (we'll rely on server state)
          clearOptimisticForProduct(productName);
          throw new Error(body?.error || `Failed (${res.status})`);
        }

        // If server returned an updated order object, merge it into local groups to persist change locally
        if (body.order) {
          mergeServerOrderIntoGroups(body.order);
          // server is authoritative for involved items, clear optimistic delta for this product
          clearOptimisticForProduct(productName);
        } else {
          // fallback: re-sync groups from server to be safe (but keep other optimistic deltas intact)
          await fetchGroups({ force: true });
          // clear only this product's optimistic delta since server acknowledged we re-synced
          clearOptimisticForProduct(productName);
        }

        return { ok: true, result: body };
      } catch (err) {
        console.error("callPrepareApi error", err);
        setError(err.message || "Failed to perform product prepare action");
        // ensure UI is re-synced on error
        try {
          await fetchGroups({ force: true });
        } catch (e) {
          // ignore
        }
        // clear optimistic delta on error so we don't keep pretending it's applied
        clearOptimisticForProduct(productName);
        return { ok: false, error: err.message };
      } finally {
        // clear pending & maybe unpause refresh
        removePending(productName);
      }
    },
    [
      addPending,
      applyOptimisticDelta,
      clearOptimisticForProduct,
      fetchGroups,
      mergeServerOrderIntoGroups,
      removePending,
    ]
  );

  const handlePrepareOne = useCallback(
    (productName) => callPrepareApi(productName, "prepare"),
    [callPrepareApi]
  );
  const handleUnprepareOne = useCallback(
    (productName) => callPrepareApi(productName, "unprepare"),
    [callPrepareApi]
  );

  // UI states derived
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <FiCoffee
            className="animate-pulse text-cyan-400 mx-auto mb-4"
            size={40}
          />
          <div className="text-slate-300">Loading canteen dashboard...</div>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-8 text-center">
          <div className="bg-cyan-900/20 p-4 rounded-full inline-flex items-center justify-center mb-4">
            <FiShoppingBag className="text-cyan-400" size={32} />
          </div>
          <h2 className="text-xl font-semibold text-slate-100 mb-2">
            Canteen Console
          </h2>
          <p className="text-sm text-slate-400 mb-6">
            Sign in to view live orders and manage food preparation
          </p>
          <button
            onClick={() => signIn()}
            className="px-6 py-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors duration-200 flex items-center justify-center gap-2 w-full"
          >
            <FiLogIn size={18} /> Sign in
          </button>
        </div>
      </div>
    );
  }

  const totalUnprepared = productSummary.reduce(
    (sum, p) => sum + (p.unprepared || 0),
    0
  );
  const totalReady = productSummary.reduce((sum, p) => sum + (p.ready || 0), 0);
  const totalOrders =
    (groups.placed?.length || 0) +
    (groups.preparing?.length || 0) +
    (groups.ready?.length || 0);

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-100 flex items-center gap-2">
              <FiShoppingBag className="text-cyan-400" /> Canteen Dashboard
            </h1>
            <p className="text-sm text-slate-300 mt-1">
              Live order management • Auto-refreshes every 6 seconds
              {lastUpdated && (
                <span className="text-slate-400">
                  {" "}
                  • Last updated: {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-3 items-center">
            <button
              onClick={() => fetchGroups({ force: true })}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors duration-200 flex items-center gap-2"
              disabled={loading}
            >
              <FiRefreshCw
                className={loading ? "animate-spin" : ""}
                size={16}
              />
              Refresh
            </button>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-400">To Prepare</div>
                <div className="text-2xl font-bold text-amber-400">
                  {totalUnprepared}
                </div>
              </div>
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <FiClock className="text-amber-400" size={20} />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-400">Ready</div>
                <div className="text-2xl font-bold text-green-400">
                  {totalReady}
                </div>
              </div>
              <div className="p-2 bg-green-500/10 rounded-lg">
                <FiCheckCircle className="text-green-400" size={20} />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-400">Total Orders</div>
                <div className="text-2xl font-bold text-cyan-400">
                  {totalOrders}
                </div>
              </div>
              <div className="p-2 bg-cyan-500/10 rounded-lg">
                <FiBox className="text-cyan-400" size={20} />
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 p-4 rounded-xl flex items-start gap-3">
            <FiAlertCircle className="text-red-400 mt-0.5" size={20} />
            <div className="flex-1">
              <div className="text-red-200 font-medium">Error</div>
              <div className="text-sm text-red-100">{error}</div>
            </div>
            <button
              onClick={() => setError("")}
              className="text-red-400 hover:text-red-300"
            >
              &times;
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1: Unprepared products (countdown cards) */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <FiClock className="text-amber-400" size={20} />
              <h3 className="text-lg font-semibold text-slate-100">
                To Prepare
              </h3>
              <span className="bg-amber-900/30 text-amber-400 text-xs px-2 py-1 rounded-full">
                {productSummary.filter((p) => (p.unprepared || 0) > 0).length}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {productSummary.filter((p) => (p.unprepared || 0) > 0).length ===
              0 ? (
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center text-slate-400">
                  <FiCheckCircle
                    size={24}
                    className="mx-auto mb-2 opacity-50"
                  />
                  <p>All items prepared!</p>
                </div>
              ) : (
                productSummary
                  .filter((p) => (p.unprepared || 0) > 0)
                  .map((p) => (
                    <ProductCard
                      key={p.name}
                      product={p}
                      variant="countdown"
                      onPrepareOne={handlePrepareOne}
                      onUnprepareOne={handleUnprepareOne}
                      pending={pendingPrepare.has(p.name)}
                    />
                  ))
              )}
            </div>
          </div>

          {/* Column 2: Preparing / in-flight orders */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <FiRefreshCw className="text-blue-400" size={20} />
              <h3 className="text-lg font-semibold text-slate-100">
                Active Orders
              </h3>
              <span className="bg-blue-900/30 text-blue-400 text-xs px-2 py-1 rounded-full">
                {(groups.preparing || []).length + (groups.placed || []).length}
              </span>
            </div>

            <div className="bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-4 space-y-3 max-h-[600px] overflow-y-auto">
              {(groups.preparing || []).length +
                (groups.placed || []).length ===
              0 ? (
                <div className="text-center py-4 text-slate-400">
                  <p>No active orders</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(groups.preparing || []).map((o) => (
                    <div
                      key={o.id}
                      className="bg-slate-800/50 p-3 rounded-lg border border-slate-700"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <div className="font-mono text-sm font-medium text-slate-100 bg-slate-700 px-2 py-1 rounded">
                          {o.code}
                        </div>
                        <div className="text-xs text-blue-400 bg-blue-900/30 px-2 py-1 rounded-full">
                          {o.status}
                        </div>
                      </div>
                      <div className="text-xs text-slate-400">
                        {o.items?.map((it, idx) => (
                          <div
                            key={idx}
                            className="flex justify-between py-1 border-b border-slate-700/50 last:border-b-0"
                          >
                            <span>{it.name}</span>
                            <span className="text-slate-300">×{it.qty}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {(groups.placed || []).slice(0, 6).map((o) => (
                    <div
                      key={o.id}
                      className="bg-slate-800/30 p-3 rounded-lg border border-slate-700/50"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <div className="font-mono text-sm text-slate-300">
                          {o.code}
                        </div>
                        <div className="text-xs text-slate-500">{o.status}</div>
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {o.items
                          ?.map((it) => `${it.name}×${it.qty}`)
                          .join(" · ")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Column 3: Ready for collection */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <FiCheckCircle className="text-green-400" size={20} />
              <h3 className="text-lg font-semibold text-slate-100">
                Ready for Collection
              </h3>
              <span className="bg-green-900/30 text-green-400 text-xs px-2 py-1 rounded-full">
                {productSummary.filter((p) => (p.ready || 0) > 0).length}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {productSummary.filter((p) => (p.ready || 0) > 0).length === 0 ? (
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center text-slate-400">
                  <FiClock size={24} className="mx-auto mb-2 opacity-50" />
                  <p>No items ready yet</p>
                </div>
              ) : (
                productSummary
                  .filter((p) => (p.ready || 0) > 0)
                  .map((p) => (
                    <ProductCard key={p.name} product={p} variant="ready" />
                  ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
