"use client";

import React, { useEffect, useState, useRef } from "react";
import { useSession, signIn } from "next-auth/react";
import { FiShoppingCart, FiCopy, FiInfo } from "react-icons/fi";

export default function AdminExternalOrderPage() {
  const { data: session, status } = useSession();

  // Regular menu state
  const [products, setProducts] = useState([]);
  
  // Special menu state
  const [activeTab, setActiveTab] = useState("regular"); // "regular" | "special"
  const [specialWindows, setSpecialWindows] = useState([]);
  const [specialProducts, setSpecialProducts] = useState([]);
  const [selectedWindowId, setSelectedWindowId] = useState("");

  // Shared state
  const [cart, setCart] = useState([]);
  const [issuedToName, setIssuedToName] = useState("");
  const [expiresInMinutes, setExpiresInMinutes] = useState(60);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // recent external orders list
  const [externalOrders, setExternalOrders] = useState([]);
  const pollRef = useRef(null);

  useEffect(() => {
    fetchProducts();
    fetchSpecialData();
    fetchExternalOrders();
    // start polling every 5s
    pollRef.current = setInterval(fetchExternalOrders, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function fetchProducts() {
    try {
      const q = new URLSearchParams({ available: "true" });
      const res = await fetch(`/api/products?${q.toString()}`);
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.products))
        setProducts(data.products);
      else setProducts(Array.isArray(data) ? data : data.products || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchSpecialData() {
    try {
      // Fetch windows
      const resWin = await fetch("/api/admin/special-ordering-windows");
      const dataWin = await resWin.json();
      if (dataWin.ok && Array.isArray(dataWin.windows)) {
        setSpecialWindows(dataWin.windows.filter(w => w.active)); // Only active windows by default? Or all? Let's show active.
      }

      // Fetch products
      const resProd = await fetch("/api/admin/special-products?available=true");
      const dataProd = await resProd.json();
      if (dataProd.ok && Array.isArray(dataProd.products)) {
        setSpecialProducts(dataProd.products);
      }
    } catch (e) {
      console.error("Error fetching special data", e);
    }
  }

  async function fetchExternalOrders() {
    try {
      const res = await fetch("/api/admin/external-codes-all?limit=100", {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok && data.ok && Array.isArray(data.externalCodes)) {
        // replace entire list (de-dup handled client-side)
        setExternalOrders((prev) => {
          // merge to avoid losing local-prepended items that may not yet be persisted (rare)
          const latest = data.externalCodes;
          const byId = new Map();
          // add newest first
          latest.forEach((c) => byId.set(String(c._id || c.id), c));
          prev.forEach((c) => {
            const id = String(c._id || c.id);
            if (!byId.has(id)) byId.set(id, c);
          });
          const arr = Array.from(byId.values());
          // sort descending by createdAt (robust if createdAt exists)
          arr.sort(
            (a, b) =>
              new Date(b.createdAt || b.createdAt) -
              new Date(a.createdAt || a.createdAt)
          );
          return arr.slice(0, 200);
        });
      } else if (Array.isArray(data)) {
        setExternalOrders(data);
      }
    } catch (e) {
      console.error("fetchExternalOrders error", e);
    }
  }

  function handleTabChange(tab) {
    if (tab !== activeTab) {
      if (cart.length > 0) {
        if (!confirm("Switching menus will clear your current cart. Continue?")) {
          return;
        }
      }
      setCart([]);
      setActiveTab(tab);
      setError(null);
      setResult(null);
    }
  }

  function addToCart(p) {
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.product._id === p._id);
      if (idx === -1) return [...prev, { product: p, qty: 1 }];
      const copy = [...prev];
      copy[idx].qty += 1;
      return copy;
    });
  }

  function changeQty(prodId, qty) {
    setCart((prev) =>
      prev
        .map((it) =>
          it.product._id === prodId ? { ...it, qty: Math.max(0, qty) } : it
        )
        .filter((i) => i.qty > 0)
    );
  }

  function removeFromCart(prodId) {
    setCart((prev) => prev.filter((i) => i.product._id !== prodId));
  }

  function cartTotal() {
    return cart.reduce(
      (s, it) => s + (it.product.price || 0) * (it.qty || 0),
      0
    );
  }

  async function submitExternal(e) {
    e?.preventDefault();
    setError(null);
    setResult(null);
    if (!cart.length) return setError("Cart is empty");
    
    // For special orders, ensure window is selected
    if (activeTab === "special" && !selectedWindowId) {
      return setError("Please select a special ordering window");
    }

    setLoading(true);
    try {
      const body = {
        items: cart.map((i) => ({ productId: i.product._id, qty: i.qty })),
        issuedToName,
        expiresInMinutes,
        isSpecial: activeTab === "special",
        orderingWindowId: activeTab === "special" ? selectedWindowId : undefined
      };

      const res = await fetch("/api/admin/external-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || `Server error (${res.status})`);
      } else {
        setResult(data);
        setCart([]);
        // Don't reset selectedWindowId immediately in case they want to issue another for same window

        // prepend new code to the list immediately
        if (data.externalCode) {
          const newCode = {
            ...data.externalCode,
            order: data.order || data.order || null,
          };
          setExternalOrders((prev) => {
            // avoid duplicate by code value or _id
            const exists = prev.some(
              (p) =>
                String(p.code) === String(newCode.code) ||
                String(p._id) === String(newCode._id || newCode.id)
            );
            if (exists) return prev;
            return [newCode, ...prev].slice(0, 200);
          });
        }
      }
    } catch (err) {
      console.error(err);
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  // Filter special products based on selected window
  const selectedWindow = specialWindows.find(w => w._id === selectedWindowId);
  const visibleSpecialProducts = selectedWindow 
    ? specialProducts.filter(p => p.category === selectedWindow.category)
    : [];

  if (status === "loading") return <div className="p-6">Loading...</div>;
  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white/5 p-8 rounded">
          <h2 className="text-xl font-semibold">Admin — External Order</h2>
          <p className="text-sm text-slate-300 my-4">
            Sign in to create an external pickup code.
          </p>
          <button
            onClick={() => signIn()}
            className="px-4 py-2 rounded bg-cyan-600 text-white"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 bg-slate-900 text-slate-100">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              Admin — Create External Order
            </h1>
            <p className="text-sm text-slate-400">
              Pick items, issue a one-time pickup code to external customers.
            </p>
          </div>
          <div className="text-sm text-slate-400">
            Signed in as {session?.user?.name || session?.user?.email}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="col-span-2 bg-slate-800 p-4 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium">Menu</h2>
              <div className="flex bg-slate-900 rounded p-1">
                <button
                  onClick={() => handleTabChange("regular")}
                  className={`px-3 py-1 rounded text-sm ${
                    activeTab === "regular"
                      ? "bg-cyan-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Regular
                </button>
                <button
                  onClick={() => handleTabChange("special")}
                  className={`px-3 py-1 rounded text-sm ${
                    activeTab === "special"
                      ? "bg-purple-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Special Order
                </button>
              </div>
            </div>

            {activeTab === "regular" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {products.map((p) => (
                  <div
                    key={p._id}
                    className="p-3 bg-slate-900 rounded border border-slate-700"
                  >
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="text-xs text-slate-400">
                      {Intl.NumberFormat("en-ZW", {
                        style: "currency",
                        currency:
                          process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD",
                      }).format(p.price || 0)}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <button
                        onClick={() => addToCart(p)}
                        className="px-2 py-1 rounded bg-cyan-600 text-white text-sm"
                      >
                        Add
                      </button>
                      <div className="text-xs text-slate-400">
                        {p.category || ""}
                      </div>
                    </div>
                  </div>
                ))}
                {products.length === 0 && (
                  <div className="col-span-full text-slate-400 text-sm py-4">
                    No regular products available.
                  </div>
                )}
              </div>
            )}

            {activeTab === "special" && (
              <div className="space-y-4">
                <div className="bg-slate-900 p-3 rounded border border-slate-700">
                  <label className="block text-xs text-slate-400 mb-1">
                    Select Special Ordering Window
                  </label>
                  <select
                    value={selectedWindowId}
                    onChange={(e) => {
                      setSelectedWindowId(e.target.value);
                      setCart([]); // Clear cart when switching windows to avoid mix-up
                    }}
                    className="w-full p-2 rounded bg-slate-800 text-white border border-slate-600"
                  >
                    <option value="">-- Select Window --</option>
                    {specialWindows.map((w) => (
                      <option key={w._id} value={w._id}>
                        {w.name} ({w.category})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedWindowId ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {visibleSpecialProducts.map((p) => (
                      <div
                        key={p._id}
                        className="p-3 bg-slate-900 rounded border border-slate-700"
                      >
                        <div className="font-medium text-sm">{p.name}</div>
                        <div className="text-xs text-slate-400">
                          {Intl.NumberFormat("en-ZW", {
                            style: "currency",
                            currency:
                              process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD",
                          }).format(p.price || 0)}
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <button
                            onClick={() => addToCart(p)}
                            className="px-2 py-1 rounded bg-purple-600 text-white text-sm"
                          >
                            Add
                          </button>
                          <div className="text-xs text-slate-400">
                            {p.sku || ""}
                          </div>
                        </div>
                      </div>
                    ))}
                    {visibleSpecialProducts.length === 0 && (
                      <div className="col-span-full text-slate-400 text-sm py-4">
                        No products found for this window ({selectedWindow?.category}).
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-slate-400 text-sm py-4 text-center">
                    Please select an ordering window to view special menu.
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="bg-slate-800 p-4 rounded-lg border border-slate-700">
            <h3 className="font-medium flex items-center gap-2">
              {activeTab === 'special' ? 'Special Order Cart' : 'Cart'} <FiShoppingCart />
            </h3>

            <div className="mt-3 space-y-2">
              {cart.length === 0 && (
                <div className="text-sm text-slate-400">Cart is empty</div>
              )}
              {cart.map((it) => (
                <div
                  key={it.product._id}
                  className="flex items-center justify-between gap-2 bg-slate-900 p-2 rounded"
                >
                  <div className="flex-1">
                    <div className="font-medium text-sm">{it.product.name}</div>
                    <div className="text-xs text-slate-400">
                      {Intl.NumberFormat("en-ZW", {
                        style: "currency",
                        currency:
                          process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD",
                      }).format(it.product.price)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={it.qty}
                      onChange={(e) =>
                        changeQty(it.product._id, Number(e.target.value || 0))
                      }
                      type="number"
                      min={1}
                      className="w-16 rounded p-1 bg-slate-800 text-center"
                    />
                    <button
                      onClick={() => removeFromCart(it.product._id)}
                      className="text-xs px-2 py-1 rounded bg-red-600"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}

              <div className="mt-2 border-t border-slate-700 pt-2">
                <div className="flex justify-between text-sm">
                  <div>Total</div>
                  <div>
                    {Intl.NumberFormat("en-ZW", {
                      style: "currency",
                      currency:
                        process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD",
                    }).format(cartTotal())}
                  </div>
                </div>
              </div>

              <form onSubmit={submitExternal} className="mt-3 space-y-2">
                <div>
                  <label className="text-xs text-slate-400">
                    Issued to (name)
                  </label>
                  <input
                    value={issuedToName}
                    onChange={(e) => setIssuedToName(e.target.value)}
                    className="w-full mt-1 p-2 rounded bg-slate-900"
                    placeholder="Customer name (optional)"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">
                    Code expiry (minutes)
                  </label>
                  <input
                    value={expiresInMinutes}
                    onChange={(e) =>
                      setExpiresInMinutes(Number(e.target.value || 0))
                    }
                    type="number"
                    min={5}
                    className="w-full mt-1 p-2 rounded bg-slate-900"
                  />
                </div>

                {error && <div className="text-sm text-red-300">{error}</div>}

                <div className="flex gap-2">
                  <button
                    disabled={loading}
                    type="submit"
                    className={`px-3 py-2 rounded ${
                      activeTab === 'special' ? 'bg-purple-600' : 'bg-green-600'
                    }`}
                  >
                    {loading ? "Issuing..." : "Issue pickup code"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCart([]);
                      setIssuedToName("");
                      setExpiresInMinutes(60);
                      setError(null);
                      setResult(null);
                    }}
                    className="px-3 py-2 rounded bg-slate-700"
                  >
                    Clear
                  </button>
                </div>

                {result && result.externalCode && (
                  <div className="mt-3 bg-slate-900 p-3 rounded border border-slate-700">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-400">
                          Pickup code
                        </div>
                        <div className="text-lg font-semibold">
                          {result.externalCode.code}
                        </div>
                        <div className="text-xs text-slate-400">
                          Expires:{" "}
                          {new Date(
                            result.externalCode.expiresAt
                          ).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <button
                          onClick={() =>
                            navigator.clipboard.writeText(
                              result.externalCode.code
                            )
                          }
                          className="px-3 py-2 rounded bg-cyan-600 flex items-center gap-2"
                        >
                          <FiCopy /> Copy
                        </button>
                        <div className="text-sm text-slate-400">
                          Order id: {result.order._id}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </form>
            </div>
          </aside>
        </div>

        {/* Recent external orders */}
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-medium">
              Recent external pickup codes
            </h2>
            <div>
              <button
                onClick={fetchExternalOrders}
                className="px-2 py-1 rounded bg-slate-700 text-sm"
              >
                Refresh
              </button>
            </div>
          </div>

          {externalOrders.length === 0 ? (
            <div className="text-sm text-slate-400">No external codes yet.</div>
          ) : (
            <div className="grid gap-2">
              {externalOrders.map((c) => {
                const id = c._id || c.id || c._doc?._id || c.id;
                const isSpecial = c.order?.isSpecial || c.order?.category || (c.order?.code && c.order.code.startsWith('SP-'));
                return (
                  <div
                    key={String(id) + String(c.code)}
                    className="flex items-center justify-between bg-slate-900 p-3 rounded border border-slate-700"
                  >
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {c.issuedToName ||
                          (c.issuedBy?.name
                            ? `Issued by ${c.issuedBy?.name}`
                            : "External customer")}
                        {isSpecial && (
                            <span className="text-[10px] px-1 rounded bg-purple-900 text-purple-200 border border-purple-700">Special</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        Code: <span className="font-mono">{c.order?.code || c.code}</span>{" "}
                        • Created:{" "}
                        {new Date(c.createdAt || c.createdAt).toLocaleString()}
                      </div>
                      {c.order?.total != null && (
                        <div className="text-xs text-slate-400">
                          Order total:{" "}
                          {Intl.NumberFormat("en-ZW", {
                            style: "currency",
                            currency:
                              process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD",
                          }).format(c.order.total)}
                        </div>
                      )}
                      {c.expiresAt && (
                        <div className="text-xs text-slate-400">
                          Expires: {new Date(c.expiresAt).toLocaleString()}
                        </div>
                      )}
                      {c.used && (
                        <div className="text-xs text-amber-300">Used</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <button
                        onClick={() =>
                          navigator.clipboard.writeText(c.order?.code || c.code)
                        }
                        className="px-3 py-1 rounded bg-cyan-600 text-sm"
                      >
                        Copy
                      </button>
                      <div className="text-xs text-slate-400">
                        #{String(id).slice(-6)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
