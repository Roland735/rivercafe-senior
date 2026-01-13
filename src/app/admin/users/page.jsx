// app/(admin)/funds/page.jsx
"use client";

import React, { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import {
  FiPlusCircle,
  FiMinusCircle,
  FiSearch,
  FiAlertCircle,
} from "react-icons/fi";

export default function AdminFundsPage() {
  const { data: session, status } = useSession();
  const [userKey, setUserKey] = useState(""); // regNumber or userId
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("deposit"); // deposit | withdraw
  const [note, setNote] = useState("");
  const [allowNegative, setAllowNegative] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState(null);
  const [error, setError] = useState(null);
  const [userAfter, setUserAfter] = useState(null);

  if (status === "loading") return <div className="p-6">Loading...</div>;

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-8 text-center">
          <h2 className="text-xl font-semibold text-slate-100 mb-2">
            Admin Funds
          </h2>
          <p className="text-sm text-slate-400 mb-6">
            Sign in to deposit or withdraw funds for users.
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

  function fmt(n) {
    try {
      return new Intl.NumberFormat("en-ZW", {
        style: "currency",
        currency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD",
      }).format(n);
    } catch (e) {
      return `${n}`;
    }
  }

  async function submit(e) {
    e?.preventDefault();
    setError(null);
    setResultMsg(null);
    setUserAfter(null);

    const amt = Number(String(amount).replace(/,/g, ""));
    if (!userKey || !String(userKey).trim())
      return setError("Enter a user reg number or user id.");
    if (!amt || isNaN(amt) || amt <= 0)
      return setError("Enter a valid amount greater than 0.");

    setLoading(true);
    try {
      const body = {
        userIdOrReg: userKey.trim(),
        amount: Math.abs(amt),
        note:
          note ||
          `${type === "deposit" ? "Admin deposit" : "Admin withdraw"} by ${
            session?.user?.name || session?.user?.email
          }`,
      };

      if (type === "withdraw") body.allowNegative = !!allowNegative;

      const endpoint =
        type === "deposit"
          ? "/api/admin/accounting/topup"
          : "/api/admin/accounting/withdraw";

      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res
        .json()
        .catch(() => ({ ok: false, error: "Invalid JSON" }));
      if (!res.ok || !data.ok) {
        setError(data.error || `Server error (${res.status})`);
      } else {
        // response contains updated user and transaction
        setUserAfter(data.user || null);
        setResultMsg(
          `${type === "deposit" ? "Deposited" : "Withdrawn"} ${fmt(
            Number(body.amount)
          )} — New balance: ${fmt(data.user?.balance ?? 0)}`
        );
        // reset amount/note optionally
        setAmount("");
        setNote("");
      }
    } catch (err) {
      console.error(err);
      setError("Network error while performing operation.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl text-slate-100 font-bold">
              Admin — Deposit / Withdraw
            </h1>
            <p className="text-sm text-slate-400">
              Top up student accounts or withdraw (admin adjustment).
            </p>
          </div>
          <div className="text-sm text-slate-400">
            Signed in as {session?.user?.name || session?.user?.email}
          </div>
        </div>

        <form
          onSubmit={submit}
          className="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400">User reg / id</label>
              <input
                value={userKey}
                onChange={(e) => setUserKey(e.target.value)}
                placeholder="e.g. S12345 or 64a..."
                className="mt-1 w-full rounded p-2 bg-slate-900 text-slate-100 border border-slate-700"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400">Amount</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                className="mt-1 w-full rounded p-2 bg-slate-900 text-slate-100 border border-slate-700"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400">Type</label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setType("deposit")}
                  className={`px-3 py-2 rounded ${
                    type === "deposit"
                      ? "bg-green-600 text-white"
                      : "bg-slate-700 text-slate-200"
                  }`}
                >
                  <FiPlusCircle /> Deposit
                </button>
                <button
                  type="button"
                  onClick={() => setType("withdraw")}
                  className={`px-3 py-2 rounded ${
                    type === "withdraw"
                      ? "bg-amber-500 text-white"
                      : "bg-slate-700 text-slate-200"
                  }`}
                >
                  <FiMinusCircle /> Withdraw
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Receipt, reason, etc."
              className="mt-1 w-full rounded p-2 bg-slate-900 text-slate-100 border border-slate-700"
            />
          </div>

          {type === "withdraw" && (
            <div className="text-sm text-slate-300 flex items-center gap-3">
              <input
                id="neg"
                type="checkbox"
                checked={allowNegative}
                onChange={(e) => setAllowNegative(e.target.checked)}
              />
              <label htmlFor="neg">
                Allow negative balance (override insufficient funds)
              </label>
            </div>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-800 p-3 rounded text-red-200 flex items-center gap-2">
              <FiAlertCircle /> <div>{error}</div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              disabled={loading}
              type="submit"
              className="px-4 py-2 rounded bg-cyan-600 text-white"
            >
              {loading
                ? "Processing..."
                : type === "deposit"
                ? "Deposit"
                : "Withdraw"}
            </button>
            <button
              type="button"
              onClick={() => {
                setUserKey("");
                setAmount("");
                setNote("");
                setError(null);
                setResultMsg(null);
                setUserAfter(null);
              }}
              className="px-4 py-2 rounded bg-slate-700 text-slate-200"
            >
              Clear
            </button>
          </div>

          {resultMsg && (
            <div className="bg-slate-800/50 border border-slate-700 rounded p-3 text-slate-200">
              <div className="font-medium">Success</div>
              <div className="text-sm">{resultMsg}</div>
              {userAfter && (
                <div className="mt-2 text-sm text-slate-300">
                  User: {userAfter.name}{" "}
                  {userAfter.regNumber ? `(${userAfter.regNumber})` : ""} —
                  Balance: {fmt(userAfter.balance ?? 0)}
                </div>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
