// app/admin/refund/page.jsx
"use client";

import React, { useState } from "react";
import { useSession } from "next-auth/react";
import { FiSearch, FiCreditCard, FiInfo } from "react-icons/fi";

export default function AdminRefundPage() {
  const { data: session, status } = useSession();
  const loadingSession = status === "loading";

  const [userIdOrReg, setUserIdOrReg] = useState("");
  const [amount, setAmount] = useState("");
  const [relatedOrderId, setRelatedOrderId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  function validate() {
    if (!userIdOrReg) return "Enter student reg number or user id";
    const a = Number(amount);
    if (!a || isNaN(a) || a <= 0) return "Enter a positive amount";
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage(null);
    const err = validate();
    if (err) {
      setMessage({ type: "error", text: err });
      return;
    }

    setBusy(true);
    try {
      // If you use next-auth include admin ID from session; otherwise pass null and ensure server authenticates
      const adminId = session?.user?.id || null;

      const res = await fetch("/api/admin/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          adminId,
          userIdOrReg: userIdOrReg.trim(),
          amount: Number(amount),
          note: note.trim(),
          relatedOrderId: relatedOrderId.trim() || null,
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.ok) {
        setMessage({ type: "error", text: body.error || "Refund failed" });
      } else {
        setMessage({
          type: "success",
          text: `Refunded ${Number(amount)} to ${String(
            userIdOrReg
          )} successfully`,
        });
        // optionally show returned user/tx details
        console.log("refund result", body);
        // reset form (optional)
        setAmount("");
        setRelatedOrderId("");
        setNote("");
      }
    } catch (err) {
      setMessage({ type: "error", text: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen p-6 bg-slate-900 text-slate-100">
      <div className="max-w-2xl mx-auto bg-slate-800 border border-slate-700 rounded-2xl p-6">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <FiCreditCard /> Refund student (admin)
        </h1>
        <p className="text-sm text-slate-300 mt-1">
          Credit a student's account with a refund. Use reg number or user id.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Student reg number or user id
            </label>
            <div className="flex gap-2">
              <input
                value={userIdOrReg}
                onChange={(e) => setUserIdOrReg(e.target.value)}
                placeholder="e.g. S12345 or 64a1f2..."
                className="flex-1 p-3 bg-slate-900 rounded text-slate-100"
                disabled={busy || loadingSession}
              />
              <button
                type="button"
                className="px-3 py-2 rounded bg-slate-700 text-slate-200"
                onClick={() =>
                  navigator.clipboard &&
                  userIdOrReg &&
                  navigator.clipboard.writeText(userIdOrReg)
                }
              >
                <FiSearch />
              </button>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              If your app provides a lookup step you can add a "find student"
              integration here.
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Amount</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 1500"
              className="w-full p-3 bg-slate-900 rounded text-slate-100"
              disabled={busy || loadingSession}
              inputMode="decimal"
            />
            <div className="text-xs text-slate-500 mt-1">
              Use your app's currency units (ensure consistency: cents vs
              decimals).
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Related order ID (optional)
            </label>
            <input
              value={relatedOrderId}
              onChange={(e) => setRelatedOrderId(e.target.value)}
              placeholder="Order ID, e.g. 64a1f2..."
              className="w-full p-3 bg-slate-900 rounded text-slate-100"
              disabled={busy || loadingSession}
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Note (optional)
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason for refund, ticket #, etc."
              className="w-full p-3 bg-slate-900 rounded text-slate-100"
              disabled={busy || loadingSession}
            />
          </div>

          {message && (
            <div
              className={`p-3 rounded ${
                message.type === "success"
                  ? "bg-emerald-900 text-emerald-200"
                  : "bg-red-900 text-red-200"
              }`}
            >
              <div className="flex items-center gap-2">
                {message.type === "success" ? (
                  <span className="inline-block">✅</span>
                ) : (
                  <FiInfo />
                )}
                <div>{message.text}</div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="submit"
              className="px-4 py-2 rounded bg-emerald-500 text-black font-medium disabled:opacity-60"
              disabled={busy || loadingSession}
            >
              {busy ? "Processing…" : "Issue refund"}
            </button>
            <div className="text-xs text-slate-400">
              Admin: {session?.user?.email || "not signed in"}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
