// components/canteen/OrderCard.jsx
"use client";

import React from "react";

export default function OrderCard({
  order,
  onInc,
  onDec,
  onSetStatus,
  showControls = true,
}) {
  // Number of items helper
  const totalItemsCount = (order?.items || []).reduce(
    (s, it) => s + (Number(it.qty) || 0),
    0
  );

  return (
    <div className="bg-slate-800 p-4 rounded shadow-sm">
      <div className="flex items-center gap-3">
        <div className="font-mono text-slate-100 font-semibold">
          {order.code}
        </div>

        <div
          className="text-xs px-2 py-1 rounded-full"
          style={{ background: "#e2e8f0", color: "#0f172a" }}
        >
          {String(order.status || "").toUpperCase()}
        </div>

        <div className="ml-auto text-sm text-slate-400">
          {order.createdAt
            ? new Date(order.createdAt).toLocaleTimeString()
            : ""}
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
          <div>Items ({totalItemsCount})</div>
          <div>{order.regNumber ? `Reg: ${order.regNumber}` : "External"}</div>
        </div>

        <ul className="text-sm text-slate-100 space-y-1">
          {order.items?.map((it, i) => (
            <li key={i} className="flex justify-between">
              <span className="truncate">
                {it.name} ×{it.qty}
              </span>
              {/* price intentionally hidden */}
              <span className="text-slate-500 ml-4" aria-hidden="true">
                &nbsp;
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="text-sm text-slate-400">Notes</div>
        <div className="text-sm text-slate-100">
          {order.remarks || order.meta?.note || "—"}
        </div>
      </div>

      {showControls && (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex items-center bg-slate-900 rounded">
            <button
              aria-label="decrease prepared count"
              className="px-3 py-2"
              onClick={() => onDec && onDec(order)}
            >
              −
            </button>

            <div className="px-3 py-2 text-sm">
              {(order.meta && Number(order.meta.preparedCount)) || 0}
            </div>

            <button
              aria-label="increase prepared count"
              className="px-3 py-2"
              onClick={() => onInc && onInc(order)}
            >
              +
            </button>
          </div>

          <div className="ml-auto flex gap-2">
            <button
              className="px-3 py-2 rounded bg-amber-600 hover:bg-amber-700 text-sm"
              onClick={() => onSetStatus && onSetStatus(order, "preparing")}
            >
              Mark Preparing
            </button>
            <button
              className="px-3 py-2 rounded bg-green-600 hover:bg-green-700 text-sm"
              onClick={() => onSetStatus && onSetStatus(order, "ready")}
            >
              Mark Ready
            </button>
            <button
              className="px-3 py-2 rounded border text-sm"
              onClick={() => onSetStatus && onSetStatus(order, "collected")}
            >
              Collected
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
