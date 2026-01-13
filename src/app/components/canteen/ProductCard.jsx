// components/canteen/ProductCard.jsx
"use client";

import React from "react";
import { FiClock, FiCheckCircle, FiMinus, FiPlus } from "react-icons/fi";

export default function ProductCard({
  product, // { name, totalOrdered, unprepared, ready }
  variant = "countdown", // 'countdown' or 'ready'
  onPrepareOne, // fn(productName) -> Promise
  onUnprepareOne, // fn(productName) -> Promise
}) {
  const { name, totalOrdered = 0, unprepared = 0, ready = 0 } = product || {};

  return (
    <div className="bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-5 flex flex-col items-stretch h-full transition-all duration-300 hover:border-slate-600">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm font-medium text-slate-300 truncate flex-1 mr-2">
          {name}
        </div>
        <div className="text-xs text-slate-400 bg-slate-700/50 px-2 py-1 rounded-full">
          Ordered: {totalOrdered}
        </div>
      </div>

      {/* Big central number */}
      <div className="flex-1 flex items-center justify-center my-2">
        <div className="text-center">
          <div
            className={`text-5xl md:text-6xl font-extrabold ${
              variant === "countdown" ? "text-amber-400" : "text-green-400"
            }`}
            aria-live="polite"
          >
            {variant === "countdown" ? unprepared ?? 0 : ready ?? 0}
          </div>
          <div className="text-xs text-slate-400 mt-1 flex items-center justify-center gap-1">
            {variant === "countdown" ? (
              <>
                <FiClock size={12} /> to prepare
              </>
            ) : (
              <>
                <FiCheckCircle size={12} /> ready to collect
              </>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar for countdown variant */}
      {variant === "countdown" && totalOrdered > 0 && (
        <div className="w-full bg-slate-700 rounded-full h-1.5 mt-2 mb-3">
          <div
            className="bg-amber-500 h-1.5 rounded-full transition-all duration-500"
            style={{
              width: `${((totalOrdered - unprepared) / totalOrdered) * 100}%`,
            }}
          ></div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-3 flex items-center gap-2 justify-between">
        {variant === "countdown" ? (
          <>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onUnprepareOne && onUnprepareOne(name)}
                className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors duration-200"
                title="Undo prepared (decrement)"
                disabled={unprepared <= 0}
              >
                <FiMinus size={16} />
              </button>

              <button
                onClick={() => onPrepareOne && onPrepareOne(name)}
                className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors duration-200 flex items-center gap-1"
                title="Mark one prepared"
              >
                <FiPlus size={16} /> Prepare
              </button>
            </div>

            <div className="text-xs text-slate-400">
              {(((totalOrdered - unprepared) / totalOrdered) * 100).toFixed(0)}%
              done
            </div>
          </>
        ) : (
          <>
            <div className="text-sm text-slate-300">Ready for pickup</div>
            <div className="text-xs text-slate-400 bg-green-900/30 text-green-400 px-2 py-1 rounded-full">
              {ready} available
            </div>
          </>
        )}
      </div>
    </div>
  );
}
