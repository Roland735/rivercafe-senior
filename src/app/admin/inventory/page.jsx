// app/(admin)/inventory/page.jsx
"use client";

import React, { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { FiPlus, FiTrash2, FiEdit, FiDownload } from "react-icons/fi";

/**
 * Admin Inventory Page
 * - Lists products and inventory rows
 * - Create inventory row for a product (auto-creates if none exists)
 * - Edit or delete existing inventory rows
 * - Highlights rows red/green based on lowStockThreshold calibration (higher contrast)
 * - Exports inventory to Excel with one tab per location (and an "All" tab)
 *   - Each row in Excel includes Status (BUY / OK) and RecommendedOrder columns
 *
 * Notes:
 * - Excel export dynamically imports sheetjs (`xlsx`) at runtime so the bundle
 *   is not bloated. Make sure `xlsx` is installed in your project:
 *     npm install xlsx
 */

function fmtNumber(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x : 0;
}

export default function AdminInventoryPage() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [inventories, setInventories] = useState([]);
  const [form, setForm] = useState({
    productId: "",
    quantity: 0,
    location: "Main",
    lowStockThreshold: 0,
    active: true,
  });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  async function loadAll(productId = "") {
    setLoading(true);
    setError("");
    try {
      const url = productId
        ? `/api/admin/inventory?productId=${productId}`
        : `/api/admin/inventory`;
      const res = await fetch(url, { cache: "no-store" });
      const body = await res
        .json()
        .catch(() => ({ ok: false, error: "Invalid JSON" }));
      if (!res.ok || !body.ok) {
        setError(body?.error || `Failed to load (${res.status})`);
        setProducts([]);
        setInventories([]);
      } else {
        setProducts(body.products || []);
        setInventories(body.inventories || []);
        // if product select empty, set to first product
        if (
          (!form.productId || form.productId === "") &&
          (body.products || []).length > 0
        ) {
          setForm((prev) => ({ ...prev, productId: body.products[0].id }));
        }
      }
    } catch (err) {
      console.error(err);
      setError("Network error while loading inventories.");
      setProducts([]);
      setInventories([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <h2 className="text-xl font-semibold text-slate-100 mb-2">
            Inventory (Admin)
          </h2>
          <p className="text-sm text-slate-400 mb-6">
            Sign in as admin to manage inventory.
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

  async function submitForm(e) {
    e?.preventDefault();
    setError("");
    // basic validation
    if (!form.productId) return setError("Select a product");
    const payload = {
      productId: form.productId,
      quantity: fmtNumber(form.quantity),
      location: form.location || "Main",
      lowStockThreshold: fmtNumber(form.lowStockThreshold),
      active: !!form.active,
    };
    setLoading(true);
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res
        .json()
        .catch(() => ({ ok: false, error: "Invalid JSON" }));
      if (!res.ok || !body.ok) {
        setError(body?.error || `Failed (${res.status})`);
      } else {
        // refresh list
        await loadAll();
        // reset form (but keep selected product)
        setForm((prev) => ({
          ...prev,
          quantity: 0,
          location: "Main",
          lowStockThreshold: 0,
          active: true,
        }));
      }
    } catch (err) {
      console.error(err);
      setError("Network error while saving inventory.");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(inv) {
    setEditing(inv);
    setForm({
      productId: inv.product?._id
        ? String(inv.product._id)
        : String(inv.product || ""),
      quantity: inv.quantity,
      location: inv.location || "Main",
      lowStockThreshold: inv.lowStockThreshold || 0,
      active: !!inv.active,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveEdit(e) {
    e?.preventDefault();
    if (!editing) return setError("No inventory selected for editing");
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventoryId: editing._id || editing.id,
          quantity: fmtNumber(form.quantity),
          location: form.location,
          lowStockThreshold: fmtNumber(form.lowStockThreshold),
          active: !!form.active,
        }),
      });
      const body = await res
        .json()
        .catch(() => ({ ok: false, error: "Invalid JSON" }));
      if (!res.ok || !body.ok) {
        setError(body?.error || `Failed (${res.status})`);
      } else {
        setEditing(null);
        setForm((prev) => ({
          ...prev,
          quantity: 0,
          location: "Main",
          lowStockThreshold: 0,
          active: true,
        }));
        await loadAll();
      }
    } catch (err) {
      console.error(err);
      setError("Network error while saving inventory.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteRow(invId) {
    if (!confirm("Delete this inventory row?")) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryId: invId }),
      });
      const body = await res
        .json()
        .catch(() => ({ ok: false, error: "Invalid JSON" }));
      if (!res.ok || !body.ok) {
        setError(body?.error || `Failed (${res.status})`);
      } else {
        await loadAll();
      }
    } catch (err) {
      console.error(err);
      setError("Network error while deleting inventory row.");
    } finally {
      setLoading(false);
    }
  }

  // Excel export: builds a workbook with worksheets grouped by location and an "All" sheet.
  // Adds Status (BUY / OK) and RecommendedOrder columns to help decision-making.
  async function exportExcel() {
    if (!inventories || inventories.length === 0) {
      setError("No inventories to export.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // dynamic import to keep bundle small
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      // Normalize location value and group
      const groups = {};
      const allRows = inventories.map((inv) => {
        const qty = fmtNumber(inv.quantity);
        const threshold = fmtNumber(inv.lowStockThreshold);
        const needs = Math.max(0, threshold - qty); // how many to order
        const status = qty < threshold ? "BUY" : "OK";

        const row = {
          ID: inv._id || inv.id || "",
          Product: inv.product?.name || inv.product || "",
          SKU: inv.product?.sku || "",
          Location: inv.location || "Main",
          Quantity: qty,
          LowThreshold: threshold,
          Status: status,
          RecommendedOrder: needs,
          Active: inv.active ? "Yes" : "No",
          UpdatedAt: inv.updatedAt || inv.createdAt || "",
        };
        const loc = row.Location || "Main";
        if (!groups[loc]) groups[loc] = [];
        groups[loc].push(row);
        return row;
      });

      // All sheet
      const wsAll = XLSX.utils.json_to_sheet(allRows, {
        header: [
          "ID",
          "Product",
          "SKU",
          "Location",
          "Quantity",
          "LowThreshold",
          "Status",
          "RecommendedOrder",
          "Active",
          "UpdatedAt",
        ],
      });
      XLSX.utils.book_append_sheet(wb, wsAll, "All");

      // Per-location sheets
      Object.keys(groups).forEach((loc) => {
        const ws = XLSX.utils.json_to_sheet(groups[loc], {
          header: [
            "ID",
            "Product",
            "SKU",
            "Location",
            "Quantity",
            "LowThreshold",
            "Status",
            "RecommendedOrder",
            "Active",
            "UpdatedAt",
          ],
        });
        // worksheet names cannot be too long or contain certain chars; keep safe
        const safeName = String(loc).substring(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, safeName);
      });

      const filename = `inventory-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-")}.xlsx`;
      // write file in browser
      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error(err);
      setError(
        "Failed to export Excel. Make sure `xlsx` is installed (npm install xlsx)."
      );
    } finally {
      setLoading(false);
    }
  }

  function rowCalibrationClass(inv) {
    // Higher contrast styling:
    const threshold = fmtNumber(inv.lowStockThreshold || 0);
    const qty = fmtNumber(inv.quantity);
    if (qty < threshold) {
      // stronger red background + subtle ring/border to stand out on dark UI
      return "bg-red-700/40 text-red-100 ring-1 ring-red-500/40";
    }
    // stronger green (emerald) with ring
    return "bg-emerald-700/20 text-emerald-100 ring-1 ring-emerald-400/25";
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl text-slate-100 font-bold">
              Inventory Management
            </h1>
            <p className="text-sm text-slate-400">
              Create, edit or remove inventory rows. If a product has no
              inventory rows, saving will create one automatically.
            </p>
            <div className="mt-2 text-xs text-slate-200">
              <span className="inline-flex items-center mr-4">
                <span className="w-3 h-3 inline-block mr-2 rounded bg-red-600 shadow-md" />
                BELOW THRESHOLD → BUY (red)
              </span>
              <span className="inline-flex items-center">
                <span className="w-3 h-3 inline-block mr-2 rounded bg-emerald-500 shadow-md" />
                AT/ABOVE THRESHOLD → OK (green)
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={exportExcel}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 rounded text-white"
            >
              <FiDownload />
              Export Excel (tabs by location)
            </button>
            <button
              onClick={() => loadAll()}
              className="px-4 py-2 rounded border text-slate-200"
            >
              Refresh
            </button>
          </div>
        </div>

        <form
          onSubmit={editing ? saveEdit : submitForm}
          className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3"
        >
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400">Product</label>
              <select
                value={form.productId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, productId: e.target.value }))
                }
                className="mt-1 w-full rounded p-2 bg-slate-900 text-slate-100 border border-slate-700"
              >
                <option value="">-- select product --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} • {p.sku || ""} • stock: {p.totalInventory}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400">Quantity</label>
              <input
                type="number"
                value={form.quantity}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    quantity: Number(e.target.value),
                  }))
                }
                className="mt-1 w-full rounded p-2 bg-slate-900 text-slate-100 border border-slate-700"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400">Location</label>
              <input
                value={form.location}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, location: e.target.value }))
                }
                className="mt-1 w-full rounded p-2 bg-slate-900 text-slate-100 border border-slate-700"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400">
                Low stock threshold
              </label>
              <input
                type="number"
                value={form.lowStockThreshold}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    lowStockThreshold: Number(e.target.value),
                  }))
                }
                className="mt-1 w-full rounded p-2 bg-slate-900 text-slate-100 border border-slate-700"
              />
            </div>

            <div className="flex items-end gap-2">
              <label className="text-xs text-slate-400">Active</label>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, active: e.target.checked }))
                }
                className="mt-1"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800 p-2 rounded text-red-200 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 rounded text-white"
            >
              <FiPlus />{" "}
              {editing ? "Save changes" : "Create / Upsert inventory"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setForm((prev) => ({
                    ...prev,
                    quantity: 0,
                    location: "Main",
                    lowStockThreshold: 0,
                    active: true,
                  }));
                }}
                className="px-4 py-2 rounded bg-slate-700 text-slate-200"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <h2 className="text-lg text-slate-100 mb-3">
            Inventory rows ({inventories.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700 text-left">
                  <th className="p-2">Product</th>
                  <th className="p-2">Location</th>
                  <th className="p-2">Quantity</th>
                  <th className="p-2">Low threshold</th>
                  <th className="p-2">Active</th>
                  <th className="p-2">Updated</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventories.map((inv) => {
                  const calibClass = rowCalibrationClass(inv);
                  return (
                    <tr
                      key={inv._id}
                      className={`border-t border-slate-700 ${calibClass}`}
                    >
                      <td className="p-2">
                        {inv.product?.name || inv.product || ""}
                      </td>
                      <td className="p-2">{inv.location || "Main"}</td>
                      <td className="p-2">{inv.quantity}</td>
                      <td className="p-2">{inv.lowStockThreshold || 0}</td>
                      <td className="p-2">{inv.active ? "Yes" : "No"}</td>
                      <td className="p-2">
                        {new Date(
                          inv.updatedAt || inv.createdAt
                        ).toLocaleString()}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEdit(inv)}
                            className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 inline-flex items-center gap-1"
                          >
                            <FiEdit />
                          </button>
                          <button
                            onClick={() => deleteRow(inv._id)}
                            className="px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-white inline-flex items-center gap-1"
                          >
                            <FiTrash2 />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!inventories.length && (
                  <tr>
                    <td colSpan="7" className="p-4 text-slate-400">
                      No inventory rows found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
