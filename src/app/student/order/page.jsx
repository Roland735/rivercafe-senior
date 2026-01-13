// app/(student)/place-order/page.jsx  (updated StudentOrderPage)
"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  FiArrowLeft,
  FiPlus,
  FiMinus,
  FiShoppingCart,
  FiClock,
  FiCheckCircle,
  FiAlertCircle,
  FiCalendar,
  FiCreditCard,
  FiTrash2,
  FiLoader,
  FiX,
} from "react-icons/fi";

// Simple currency formatter (falls back to number)
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

export default function StudentOrderPage() {
  const [menu, setMenu] = useState([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [orderingWindows, setOrderingWindows] = useState([]);
  const [activeWindowNames, setActiveWindowNames] = useState([]);
  const [cart, setCart] = useState(new Map()); // productId -> qty
  const [placing, setPlacing] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const [error, setError] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  useEffect(() => {
    loadMenu();
    loadOrderingWindows();
  }, []);

  async function loadMenu() {
    setLoadingMenu(true);
    try {
      const res = await fetch("/api/student/menu", {
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || `Failed to load menu (${res.status})`);
        setMenu([]);
      } else {
        const body = await res.json();
        // API includes stock, lowStockThreshold, lowStockHurry on each product
        setMenu(body.products || []);
      }
    } catch (err) {
      console.error("loadMenu error", err);
      setError("Network error while loading menu");
      setMenu([]);
    } finally {
      setLoadingMenu(false);
    }
  }

  // Use server time (when available) to compute active ordering windows.
  async function loadOrderingWindows() {
    try {
      const res = await fetch("/api/ordering-windows", {
        cache: "no-store",
        credentials: "include",
      });

      const body = await res.json().catch(() => ({}));
      const windows = body.windows || [];
      setOrderingWindows(windows);

      // determine "now" using server date header first
      const serverDateHdr = res.headers.get("date");
      let now;
      if (serverDateHdr) {
        now = new Date(serverDateHdr);
      } else if (body && body.serverTime) {
        now = new Date(body.serverTime);
      } else {
        now = new Date();
      }
      if (isNaN(now?.getTime())) now = new Date();

      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const day = now.getDay();

      const active = windows
        .filter((w) => {
          if (!w.active) return false;
          if (
            w.daysOfWeek &&
            w.daysOfWeek.length &&
            !w.daysOfWeek.includes(day)
          )
            return false;
          if (w.startTime && w.startTime > hhmm) return false;
          if (w.endTime && hhmm > w.endTime) return false;
          return true;
        })
        .map((w) => w.name);

      setActiveWindowNames(active);
    } catch (err) {
      console.error("loadOrderingWindows error", err);
      setOrderingWindows([]);
      setActiveWindowNames([]); // safe fallback
    }
  }

  function addQty(productId, delta = 1) {
    setCart((prev) => {
      const next = new Map(prev);
      const cur = next.get(productId) || 0;
      // find product to check stock
      const p = menu.find((m) => String(m._id || m.id) === String(productId));
      const stock = p && typeof p.stock === "number" ? Number(p.stock) : null;

      // Only block adding when stock is exactly 0
      if (stock === 0 && delta > 0) return next;

      let nxt = Math.max(0, cur + delta);
      // if stock known, cap at stock
      if (stock !== null && stock !== undefined) {
        nxt = Math.min(nxt, stock);
      }
      if (nxt <= 0) next.delete(productId);
      else next.set(productId, nxt);
      return next;
    });
  }

  function setQty(productId, qty) {
    setCart((prev) => {
      const next = new Map(prev);
      const q = Math.max(0, Math.floor(qty || 0));
      // check product stock
      const p = menu.find((m) => String(m._id || m.id) === String(productId));
      const stock = p && typeof p.stock === "number" ? Number(p.stock) : null;

      // If stock is exactly 0, don't allow setting positive quantities
      if (stock === 0 && q > 0) return next;

      const finalQ =
        stock !== null && stock !== undefined ? Math.min(q, stock) : q;
      if (finalQ <= 0) next.delete(productId);
      else next.set(productId, finalQ);
      return next;
    });
  }

  function clearCart() {
    setCart(new Map());
  }

  function cartItems() {
    const items = [];
    for (const [pid, qty] of cart.entries()) {
      const p = menu.find((m) => String(m._id || m.id) === String(pid));
      if (!p) continue;
      items.push({ productId: pid, name: p.name, price: p.price, qty });
    }
    return items;
  }

  function cartTotal() {
    return cartItems().reduce((s, it) => s + (it.price || 0) * it.qty, 0);
  }

  async function placeOrder() {
    setError("");
    setOrderResult(null);

    const items = cartItems().map((i) => ({
      productId: i.productId,
      qty: i.qty,
    }));
    if (!items.length) {
      setError("Your cart is empty.");
      return;
    }

    // Basic client-side check: ensure there's an active ordering window
    if (!activeWindowNames.length) {
      setError("Ordering is currently closed (no active ordering window).");
      return;
    }

    // Client-side stock check (defensive):
    // - disallow order if stock === 0
    // - disallow if requested qty > stock
    for (const it of items) {
      const p = menu.find(
        (m) => String(m._id || m.id) === String(it.productId)
      );
      if (!p) continue;
      const stock = typeof p.stock === "number" ? Number(p.stock) : null;

      if (stock === 0) {
        setError(
          `"${p.name}" is out of stock and cannot be ordered right now.`
        );
        return;
      }
      if (stock !== null && it.qty > stock) {
        setError(`Requested quantity for "${p.name}" exceeds available stock.`);
        return;
      }
    }

    setPlacing(true);
    try {
      const res = await fetch("/api/student/order", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      // Better handling for 402 (Insufficient balance)
      if (res.status === 402) {
        const body = await res.json().catch(() => ({}));
        setError(
          (body?.error || "Insufficient balance") +
            ". Please request a top-up from admin (email admin@rivercafe.local) or deposit funds."
        );
        return;
      }

      const body = await res
        .json()
        .catch(() => ({ ok: false, error: "Invalid JSON" }));

      if (!res.ok || !body.ok) {
        setError(body.error || `Failed to place order (${res.status})`);
      } else {
        // success: show code and clear cart
        setOrderResult(
          body.order || { code: body.code, id: body.id, total: body.total }
        );
        clearCart();
        // reload menu to refresh stock info
        loadMenu();
      }
    } catch (err) {
      console.error("placeOrder error", err);
      setError("Network or server error while placing order.");
    } finally {
      setPlacing(false);
    }
  }

  // copy order code helper
  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      alert("Copied code to clipboard");
    } catch (e) {
      console.warn("Copy failed", e);
      alert("Copy failed — please select and copy manually");
    }
  }

  // Get unique categories
  const categories = [
    "all",
    ...new Set(menu.map((item) => item.category).filter(Boolean)),
  ];

  // Filter menu by category
  const filteredMenu =
    activeCategory === "all"
      ? menu
      : menu.filter((item) => item.category === activeCategory);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <Link
              href="/(student)/"
              className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-slate-100 mb-2 transition-colors duration-200"
            >
              <FiArrowLeft size={16} /> Back to Dashboard
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-cyan-500 to-cyan-600 bg-clip-text text-transparent">
              Place an Order
            </h1>
            {/* <p className="text-sm text-slate-300 mt-1">
              Order only during active windows. Your balance will be charged
              instantly.
            </p> */}
            <p className="text-sm text-red-500 mt-1">
              If you want to make an order please contact Ma'am Natalie at the
              reception.
            </p>
          </div>

          {/* Cart Summary for mobile */}
          <div className="sm:hidden bg-slate-800 border border-slate-700 rounded-lg p-3 w-full">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FiShoppingCart className="text-cyan-400" size={18} />
                <span className="text-sm font-medium">Cart</span>
              </div>
              <div className="text-sm font-semibold">
                {fmtCurrency(cartTotal())}
              </div>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {cartItems().length} item{cartItems().length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>

        {/* Ordering Windows */}
        {orderingWindows.length > 0 && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 md:p-5">
            <div className="flex items-center gap-2 mb-3">
              <FiClock className="text-cyan-400" size={18} />
              <h2 className="font-semibold text-slate-100">Ordering Windows</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {orderingWindows.map((w) => (
                <div
                  key={w._id || w.id}
                  className={`p-3 rounded-lg border ${
                    activeWindowNames.includes(w.name)
                      ? "border-cyan-500 bg-cyan-500/10"
                      : "border-slate-700 bg-slate-900/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{w.name}</div>
                    <div
                      className={`text-xs px-2 py-1 rounded-full ${
                        activeWindowNames.includes(w.name)
                          ? "bg-cyan-500 text-white"
                          : "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {activeWindowNames.includes(w.name) ? "Open" : "Closed"}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                    <FiCalendar size={12} />
                    {w.daysOfWeek && w.daysOfWeek.length
                      ? `${w.daysOfWeek.length} day${
                          w.daysOfWeek.length !== 1 ? "s" : ""
                        } per week`
                      : "All days"}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {w.startTime} — {w.endTime}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alerts */}
        {error && (
          <div className="bg-red-900/30 border border-red-800 p-4 rounded-xl flex items-start gap-3">
            <FiAlertCircle className="text-red-400 mt-0.5" size={20} />
            <div className="flex-1">
              <div className="text-red-200 font-medium">Error</div>
              <div className="text-sm text-red-100">{error}</div>

              {/(insufficient|top-?up)/i.test(error) && (
                <div className="mt-3 flex gap-2">
                  <a
                    href="mailto:admin@rivercafe.local?subject=Top-up%20request&body=Hello%20Admin%2C%0A%0AI%20need%20a%20top-up%20for%20my%20canteen%20account.%20Please%20assist.%0A%0AThanks."
                    className="inline-flex items-center gap-2 px-3 py-2 rounded bg-amber-500 text-black"
                  >
                    Request top-up (email admin)
                  </a>
                </div>
              )}
            </div>
            <button
              onClick={() => setError("")}
              className="text-red-400 hover:text-red-300"
              aria-label="Dismiss error"
            >
              <FiX size={20} />
            </button>
          </div>
        )}

        {orderResult && (
          <div className="bg-green-900/30 border border-green-800 p-4 rounded-xl flex items-start gap-3">
            <FiCheckCircle className="text-green-400 mt-0.5" size={20} />
            <div className="flex-1">
              <div className="text-green-200 font-medium">
                Order Placed Successfully!
              </div>
              <div className="mt-2 text-lg font-semibold text-green-100">
                Code:{" "}
                <span className="font-mono bg-green-900/50 px-2 py-1 rounded">
                  {orderResult.code}
                </span>
              </div>
              <div className="text-sm text-green-200 mt-2">
                Keep this code — present it at collection.
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => copyCode(orderResult.code)}
                  className="px-3 py-2 rounded bg-cyan-500 text-white"
                >
                  Copy code
                </button>
                <button
                  onClick={() => {
                    setOrderResult(null);
                  }}
                  className="px-3 py-2 rounded bg-slate-700 text-slate-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Menu Section */}
          <div className="lg:col-span-2">
            {/* Category Filter */}
            {categories.length > 1 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4">
                <h3 className="text-sm font-medium text-slate-300 mb-2">
                  Categories
                </h3>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <button
                      key={category}
                      onClick={() => setActiveCategory(category)}
                      className={`px-3 py-1.5 rounded-full text-sm transition-colors duration-200 ${
                        activeCategory === category
                          ? "bg-cyan-600 text-white"
                          : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                      }`}
                    >
                      {category === "all" ? "All Items" : category}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-100">Menu</h2>
                <div className="text-sm text-slate-300">
                  {loadingMenu ? (
                    <div className="flex items-center gap-2">
                      <FiLoader className="animate-spin" size={16} /> Loading…
                    </div>
                  ) : (
                    `${filteredMenu.length} item${
                      filteredMenu.length !== 1 ? "s" : ""
                    }`
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filteredMenu.map((p) => {
                  const pid = String(p._id || p.id);
                  const cartQty = cart.get(pid) || 0;
                  const stockKnown = typeof p.stock === "number";
                  const stock = stockKnown ? Number(p.stock) : null;
                  const lowHurry = !!p.lowStockHurry;

                  // only disable adds when stock === 0
                  const canAdd =
                    !(stock === 0) && (stock === null || cartQty < stock);

                  return (
                    <div
                      key={pid}
                      className="bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-4 flex flex-col transition-all duration-200 hover:border-slate-600"
                    >
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-slate-100">
                            {p.name}
                          </div>
                          {lowHurry && (
                            <div className="text-xs px-2 py-0.5 rounded-full bg-red-600 text-white font-semibold">
                              LOW STOCK
                            </div>
                          )}
                        </div>

                        {p.category && (
                          <div className="text-xs text-slate-400 mt-1 bg-slate-700 px-2 py-1 rounded-full inline-block">
                            {p.category}
                          </div>
                        )}

                        <div className="mt-3 text-lg font-semibold text-cyan-400">
                          {fmtCurrency(p.price)}
                        </div>
                      </div>

                      <div className="mt-4 flex items-center gap-2">
                        <button
                          className="p-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => addQty(pid, -1)}
                          disabled={cartQty === 0}
                          title="Decrease quantity"
                        >
                          <FiMinus size={16} />
                        </button>

                        <input
                          type="number"
                          min="0"
                          value={cartQty}
                          onChange={(e) => setQty(pid, Number(e.target.value))}
                          className="w-14 p-1.5 text-center bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        />

                        <button
                          className={`p-1.5 rounded-lg ${
                            canAdd
                              ? "bg-cyan-600 text-white hover:bg-cyan-500"
                              : "bg-slate-700 text-slate-400 cursor-not-allowed opacity-60"
                          } transition-colors duration-200`}
                          onClick={() => addQty(pid, 1)}
                          disabled={!canAdd}
                          title={
                            stock === 0
                              ? "Out of stock"
                              : lowHurry
                              ? "Low stock — order soon"
                              : stock !== null
                              ? cartQty >= stock
                                ? "Max stock reached"
                                : "Add"
                              : "Add"
                          }
                        >
                          <FiPlus size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {filteredMenu.length === 0 && !loadingMenu && (
                  <div className="col-span-full text-center py-8 text-slate-400">
                    <FiShoppingCart
                      size={32}
                      className="mx-auto mb-2 opacity-50"
                    />
                    <p>No menu items available in this category.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Cart Section */}
          <aside className="bg-slate-800 border border-slate-700 rounded-xl p-4 md:p-5 sticky top-4 h-fit">
            <div className="flex items-center gap-2 mb-4">
              <FiShoppingCart className="text-cyan-400" size={20} />
              <h2 className="font-semibold text-slate-100">Your Order</h2>
            </div>

            <div className="space-y-4">
              {cartItems().length === 0 ? (
                <div className="text-center py-6 text-slate-400">
                  <FiShoppingCart
                    size={32}
                    className="mx-auto mb-2 opacity-50"
                  />
                  <p>Your cart is empty</p>
                  <p className="text-xs mt-1">Add items from the menu</p>
                </div>
              ) : (
                <>
                  <div className="max-h-80 overflow-y-auto pr-2">
                    {cartItems().map((it) => (
                      <div
                        key={it.productId}
                        className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700 mb-2 last:mb-0"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-slate-100">
                            {it.name}
                          </div>
                          <div className="text-xs text-slate-400">
                            {fmtCurrency(it.price)} × {it.qty}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold text-slate-100">
                            {fmtCurrency(it.price * it.qty)}
                          </div>
                          <button
                            onClick={() => setQty(it.productId, 0)}
                            className="p-1 text-slate-400 hover:text-red-400 transition-colors duration-200"
                            title="Remove item"
                          >
                            <FiTrash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-slate-700 pt-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-slate-300 font-medium">Total</div>
                      <div className="text-xl font-bold text-cyan-400">
                        {fmtCurrency(cartTotal())}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={clearCart}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-700/50 transition-colors duration-200"
                      >
                        <FiTrash2 size={16} /> Clear
                      </button>
                      <button
                        onClick={placeOrder}
                        disabled={placing || !activeWindowNames.length}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:bg-cyan-600/50 disabled:cursor-not-allowed transition-colors duration-200"
                      >
                        {placing ? (
                          <>
                            <FiLoader className="animate-spin" size={16} />{" "}
                            Processing...
                          </>
                        ) : (
                          <>
                            <FiCreditCard size={16} /> Place Order
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {!activeWindowNames.length && (
              <div className="mt-4 p-3 bg-amber-900/30 border border-amber-800 rounded-lg text-amber-200 text-sm">
                <div className="flex items-center gap-2">
                  <FiClock size={16} />
                  <span>Ordering is currently closed</span>
                </div>
              </div>
            )}

            <div className="mt-4 text-xs text-slate-400">
              <p>Orders are charged immediately from your account balance.</p>
              <p className="mt-1">
                You will receive a single-use pickup code after payment.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
