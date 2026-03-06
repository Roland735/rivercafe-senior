"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  FiSearch,
  FiFileText,
  FiX,
  FiRefreshCw,
  FiEdit,
  FiTrash2,
  FiPlus,
  FiSave,
} from "react-icons/fi";

export default function AdminStudentsPage() {
  const { data: session } = useSession();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [statusFilter, setStatusFilter] = useState("all");
  const [balanceFilter, setBalanceFilter] = useState("all");
  const [selectedStudent, setSelectedStudent] = useState(null); // for modal
  const [statement, setStatement] = useState(null); // statement data
  const [loadingStatement, setLoadingStatement] = useState(false);

  // Edit Order State
  const [editingOrder, setEditingOrder] = useState(null);
  const [editItems, setEditItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [addProductId, setAddProductId] = useState("");
  const [addQty, setAddQty] = useState(1);

  useEffect(() => {
    fetchStudents();
  }, [page, search, sortBy, sortOrder, statusFilter, balanceFilter]);

  async function fetchStudents() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        limit: 20,
        search,
        sortBy,
        sortOrder,
      });
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (balanceFilter !== "all") params.append("balance", balanceFilter);

      const res = await fetch(`/api/admin/students?${params}`);
      const data = await res.json();
      if (data.ok) {
        setStudents(data.students);
        setTotalPages(data.totalPages);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchStatement(regNumber) {
    setLoadingStatement(true);
    setStatement(null);
    try {
      const res = await fetch(
        `/api/student/statement?regNumber=${regNumber}&limit=50`,
      );
      const data = await res.json();
      if (data.ok) {
        setStatement(data);
      } else {
        console.error(data.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingStatement(false);
    }
  }

  function handleViewStatement(student) {
    setSelectedStudent(student);
    fetchStatement(student.regNumber);
  }

  function closePopup() {
    setSelectedStudent(null);
    setStatement(null);
    setEditingOrder(null);
  }

  // --- Edit Order Logic ---

  async function fetchProducts(force = false, isSpecial = false) {
    if (!force && products.length > 0) return;
    setLoadingProducts(true);
    try {
      const url = isSpecial
        ? "/api/admin/special-products"
        : "/api/admin/products";
      const res = await fetch(url);
      const data = await res.json();
      if (data.ok) {
        setProducts(data.products || []);
      }
    } catch (err) {
      console.error("Failed to fetch products", err);
    } finally {
      setLoadingProducts(false);
    }
  }

  function handleEditOrder(order) {
    try {
      const normalizedOrder = {
        ...order,
        _id: order?._id || order?.id || "",
      };
      setEditingOrder(normalizedOrder);
      // Deep copy items to avoid mutating original reference
      setEditItems(
        order.items.map((it) => ({
          productId: it.product?._id || it.product || "", // Robust access
          name: it.name,
          price: it.price,
          qty: it.qty,
          notes: it.notes || "",
        })),
      );
      // Force refresh to get latest stock levels
      fetchProducts(true, order.isSpecial);
      setAddProductId("");
      setAddQty(1);
    } catch (e) {
      console.error("Error in handleEditOrder:", e);
      alert("Failed to prepare order for editing. See console.");
    }
  }

  function closeEditModal() {
    setEditingOrder(null);
    setEditItems([]);
  }

  function updateItemQty(index, newQty) {
    const updated = [...editItems];
    const val = parseInt(newQty);
    if (val < 1) return; // Prevent 0 or negative

    // Check stock
    const item = updated[index];
    const product = products.find((p) => p._id === item.productId);
    if (product && product.stock !== null) {
      // Allowable = current inventory + what was originally reserved in this order
      const originalItem = editingOrder.items.find(
        (it) => (it.product?._id || it.product) === item.productId,
      );
      const originalQty = originalItem ? originalItem.qty : 0;
      const maxAllowed = product.stock + originalQty;

      if (val > maxAllowed) {
        alert(
          `Insufficient stock. Available: ${product.stock}, Original: ${originalQty}. Max for this order: ${maxAllowed}`,
        );
        return;
      }
    }

    updated[index].qty = val;
    setEditItems(updated);
  }

  function removeItem(index) {
    if (!confirm("Remove this item?")) return;
    const updated = [...editItems];
    updated.splice(index, 1);
    setEditItems(updated);
  }

  function addItem() {
    if (!addProductId) return;
    const product = products.find((p) => p._id === addProductId);
    if (!product) return;

    const qtyToAdd = parseInt(addQty);

    // Check stock
    if (product.stock !== null) {
      // Calculate current proposed total for this item
      const existingItem = editItems.find((it) => it.productId === product._id);
      const currentProposedQty = existingItem ? existingItem.qty : 0;
      const newProposedTotal = currentProposedQty + qtyToAdd;

      // Calculate max allowed
      const originalItem = editingOrder.items.find(
        (it) => (it.product?._id || it.product) === product._id,
      );
      const originalQty = originalItem ? originalItem.qty : 0;
      const maxAllowed = product.stock + originalQty;

      if (newProposedTotal > maxAllowed) {
        alert(
          `Insufficient stock. Available: ${product.stock}, Original: ${originalQty}. Max for this order: ${maxAllowed}`,
        );
        return;
      }
    }

    const existingIndex = editItems.findIndex(
      (it) => it.productId === product._id,
    );
    if (existingIndex >= 0) {
      // Increment existing
      const updated = [...editItems];
      updated[existingIndex].qty += qtyToAdd;
      setEditItems(updated);
    } else {
      // Add new
      setEditItems([
        ...editItems,
        {
          productId: product._id,
          name: product.name,
          price: product.price,
          qty: qtyToAdd,
          notes: "",
        },
      ]);
    }
    // Reset add form
    setAddProductId("");
    setAddQty(1);
  }

  async function saveOrderChanges() {
    if (!editingOrder) return;
    const orderId = editingOrder._id || editingOrder.id;
    if (!orderId) {
      alert("Error: Invalid order id");
      return;
    }
    if (editItems.length === 0) {
      alert("Order must have at least one item.");
      return;
    }
    if (!confirm("Save changes? This will adjust inventory and user balance."))
      return;

    setSavingOrder(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: editItems }),
      });
      const data = await res.json();
      if (data.ok) {
        alert("Order updated successfully!");
        closeEditModal();
        // Refresh statement
        if (selectedStudent) fetchStatement(selectedStudent.regNumber);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to update order.");
    } finally {
      setSavingOrder(false);
    }
  }

  function calculateEditTotal() {
    return editItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  function fmt(n) {
    try {
      return new Intl.NumberFormat("en-ZW", {
        style: "currency",
        currency: "USD",
      }).format(n);
    } catch (e) {
      return `${n}`;
    }
  }

  function handleSort(field) {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      // Default sort direction based on field type
      if (field === "balance" || field === "createdAt") {
        setSortOrder("desc");
      } else {
        setSortOrder("asc");
      }
    }
  }

  function renderSortIcon(field) {
    if (sortBy !== field)
      return <span className="text-slate-600 ml-1 text-xs">⇅</span>;
    return sortOrder === "asc" ? (
      <span className="text-cyan-400 ml-1">↑</span>
    ) : (
      <span className="text-cyan-400 ml-1">↓</span>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6 text-slate-100">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Student Management</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchStudents}
              className="p-2 bg-slate-800 rounded hover:bg-slate-700"
            >
              <FiRefreshCw />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <FiSearch className="text-slate-400" />
          </div>
          <input
            type="text"
            placeholder="Search by name, reg number or email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-10 w-full p-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500 transition-colors"
          />
        </div>

        {/* Filters and Sort */}
        <div className="flex flex-wrap gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400 font-medium uppercase">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
            >
              <option value="name">Name</option>
              <option value="regNumber">Reg Number</option>
              <option value="balance">Balance</option>
              <option value="createdAt">Date Created</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400 font-medium uppercase">
              Order
            </label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400 font-medium uppercase">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400 font-medium uppercase">
              Balance
            </label>
            <select
              value={balanceFilter}
              onChange={(e) => {
                setBalanceFilter(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Balances</option>
              <option value="positive">Positive (&gt; 0)</option>
              <option value="negative">Negative (&lt; 0)</option>
              <option value="zero">Zero (0)</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/50 text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th
                    className="p-4 cursor-pointer hover:text-slate-200 select-none transition-colors"
                    onClick={() => handleSort("name")}
                  >
                    Name {renderSortIcon("name")}
                  </th>
                  <th
                    className="p-4 cursor-pointer hover:text-slate-200 select-none transition-colors"
                    onClick={() => handleSort("regNumber")}
                  >
                    Reg Number {renderSortIcon("regNumber")}
                  </th>
                  <th className="p-4">Email</th>
                  <th
                    className="p-4 text-right cursor-pointer hover:text-slate-200 select-none transition-colors"
                    onClick={() => handleSort("balance")}
                  >
                    Balance {renderSortIcon("balance")}
                  </th>
                  <th className="p-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {loading ? (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-slate-400">
                      Loading...
                    </td>
                  </tr>
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-slate-400">
                      No students found.
                    </td>
                  </tr>
                ) : (
                  students.map((s) => (
                    <tr
                      key={s._id}
                      className="hover:bg-slate-700/50 transition-colors"
                    >
                      <td className="p-4 font-medium text-slate-200">
                        {s.name}
                      </td>
                      <td className="p-4 text-slate-400">
                        {s.regNumber || "-"}
                      </td>
                      <td className="p-4 text-slate-400">{s.email || "-"}</td>
                      <td
                        className={`p-4 text-right font-mono ${s.balance < 0 ? "text-red-400" : "text-green-400"}`}
                      >
                        {fmt(s.balance)}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleViewStatement(s)}
                          className="px-3 py-1 bg-cyan-900/30 text-cyan-400 rounded hover:bg-cyan-900/50 transition-colors text-xs flex items-center gap-1 mx-auto"
                        >
                          <FiFileText /> Statement
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-4 flex justify-center gap-2 border-t border-slate-700">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 rounded bg-slate-700 disabled:opacity-50"
              >
                Prev
              </button>
              <span className="px-3 py-1 text-slate-400">
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 rounded bg-slate-700 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Popup Modal */}
      {selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between bg-slate-900/50 rounded-t-xl">
              <div>
                <h2 className="text-lg font-bold text-slate-100">
                  Statement: {selectedStudent.name}
                </h2>
                <p className="text-sm text-slate-400">
                  {selectedStudent.regNumber} • Current Balance:{" "}
                  {fmt(selectedStudent.balance)}
                </p>
              </div>
              <button
                onClick={closePopup}
                className="p-2 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-colors"
              >
                <FiX size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-0">
              {loadingStatement ? (
                <div className="p-12 text-center text-slate-400">
                  Loading statement data...
                </div>
              ) : !statement ||
                !statement.transactions ||
                statement.transactions.length === 0 ? (
                <div className="p-12 text-center text-slate-400">
                  No transactions found for this student.
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-900/30 text-slate-400 uppercase text-xs sticky top-0 backdrop-blur-md">
                    <tr>
                      <th className="p-3">Date</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Details</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {statement.transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-700/30">
                        <td className="p-3 text-slate-400 whitespace-nowrap">
                          {new Date(tx.createdAt).toLocaleDateString()} <br />
                          <span className="text-xs opacity-60">
                            {new Date(tx.createdAt).toLocaleTimeString()}
                          </span>
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs uppercase font-bold
                                            ${
                                              tx.type === "topup"
                                                ? "bg-green-900/30 text-green-400"
                                                : tx.type === "order"
                                                  ? "bg-blue-900/30 text-blue-400"
                                                  : tx.type === "refund"
                                                    ? "bg-amber-900/30 text-amber-400"
                                                    : "bg-slate-700 text-slate-300"
                                            }`}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td className="p-3 text-slate-300">
                          {tx.relatedOrder ? (
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-cyan-400 font-mono text-xs">
                                  #{tx.relatedOrder.code}
                                </span>
                                {tx.relatedOrder.isSpecial && (
                                  <span className="text-[10px] px-1 bg-purple-900/50 text-purple-300 rounded border border-purple-700/50">
                                    SPECIAL
                                  </span>
                                )}
                                <span className="text-xs text-slate-500 capitalize">
                                  {tx.relatedOrder.status}
                                </span>
                                {["placed", "preparing", "ready"].includes(
                                  tx.relatedOrder.status,
                                ) && (
                                  <button
                                    onClick={() =>
                                      handleEditOrder(tx.relatedOrder)
                                    }
                                    className="ml-2 p-1 hover:bg-slate-700 rounded text-cyan-400 hover:text-cyan-300 transition-colors"
                                    title="Edit Order"
                                  >
                                    <FiEdit size={12} />
                                  </button>
                                )}
                              </div>
                              {tx.relatedOrder.items &&
                                tx.relatedOrder.items.length > 0 && (
                                  <div className="mt-1 space-y-0.5">
                                    {tx.relatedOrder.items.map((it, idx) => (
                                      <div
                                        key={idx}
                                        className="text-xs text-slate-400 flex justify-between gap-4"
                                      >
                                        <span>
                                          {it.qty}x {it.name || "Item"}
                                        </span>
                                        <span className="text-slate-500 font-mono">
                                          {fmt(it.price * it.qty)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                            </div>
                          ) : (
                            <span className="italic opacity-70">
                              {tx.note || "-"}
                            </span>
                          )}
                        </td>
                        <td
                          className={`p-3 text-right font-mono ${tx.amount >= 0 ? "text-green-400" : "text-red-400"}`}
                        >
                          {tx.amount > 0 ? "+" : ""}
                          {fmt(tx.amount)}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-300">
                          {fmt(tx.balanceAfter)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-4 border-t border-slate-700 bg-slate-900/30 text-right text-xs text-slate-500 rounded-b-xl">
              Showing last 50 transactions
            </div>
          </div>
        </div>
      )}

      {/* Edit Order Modal */}
      {editingOrder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between bg-slate-900/50 rounded-t-xl">
              <h3 className="text-lg font-bold text-slate-100">
                Edit Order #{editingOrder.code}
              </h3>
              <button
                onClick={closeEditModal}
                className="p-2 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-colors"
              >
                <FiX size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-6">
              {/* Items List */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                  Order Items
                </h4>
                {editItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-4 bg-slate-900/30 p-3 rounded-lg border border-slate-700/50"
                  >
                    <div className="flex-1">
                      <div className="text-slate-200 font-medium">
                        {item.name}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {fmt(item.price)} each
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        value={item.qty}
                        onChange={(e) => updateItemQty(idx, e.target.value)}
                        className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-center text-slate-200 focus:outline-none focus:border-cyan-500"
                      />
                      <button
                        onClick={() => removeItem(idx)}
                        className="p-2 text-red-400 hover:bg-red-900/30 rounded transition-colors"
                        title="Remove Item"
                      >
                        <FiTrash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
                {editItems.length === 0 && (
                  <div className="text-center py-8 text-slate-500 italic">
                    No items in order
                  </div>
                )}
              </div>

              {/* Add Item */}
              <div className="bg-slate-700/20 p-4 rounded-xl border border-slate-700/50 space-y-3">
                <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <FiPlus /> Add Item
                </h4>
                <div className="flex gap-3">
                  <select
                    value={addProductId}
                    onChange={(e) => setAddProductId(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">Select Product...</option>
                    {products.map((p) => {
                      // Check for stock being explicitly 0 or less (if tracked)
                      // If p.stock is null/undefined, we treat it as unlimited/untracked.
                      const isOutOfStock =
                        typeof p.stock === "number" && p.stock <= 0;
                      const isUnavailable = !p.available;

                      return (
                        <option
                          key={p._id}
                          value={p._id}
                          disabled={isUnavailable || isOutOfStock}
                          className={
                            isUnavailable || isOutOfStock
                              ? "text-slate-500 bg-slate-800"
                              : ""
                          }
                        >
                          {p.name} ({fmt(p.price)})
                          {typeof p.stock === "number"
                            ? ` [Stock: ${p.stock}]`
                            : ""}
                          {isUnavailable ? " [Unavailable]" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={addQty}
                    onChange={(e) => setAddQty(e.target.value)}
                    className="w-20 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-center text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    onClick={addItem}
                    disabled={!addProductId}
                    className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-700 bg-slate-900/50 rounded-b-xl flex items-center justify-between">
              <div className="text-right">
                <div className="text-xs text-slate-400">New Total</div>
                <div className="text-xl font-bold text-cyan-400 font-mono">
                  {fmt(calculateEditTotal())}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={closeEditModal}
                  className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveOrderChanges}
                  disabled={savingOrder}
                  className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium shadow-lg shadow-cyan-900/20 flex items-center gap-2 disabled:opacity-50"
                >
                  {savingOrder ? (
                    <>Saving...</>
                  ) : (
                    <>
                      <FiSave /> Save Changes
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
