// app/(admin)/reports/sales/page.jsx
"use client";

import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
} from "recharts";
import { FiDownload } from "react-icons/fi";

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

export default function AdminSalesReportPage() {
  const [period, setPeriod] = useState("daily");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [thresholdMinutes, setThresholdMinutes] = useState(30);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Palette (high contrast)
  const palette = {
    bg: "#0f1724", // slate-900-ish
    chartRevenue: "#06b6d4", // cyan-500 (bright)
    chartOrders: "#f59e0b", // amber-500 (warm)
    chartTimely: "#10b981", // emerald-500 (green)
    axis: "#94a3b8", // slate-400-ish for ticks
    grid: "#1f2937", // slate-800 for grid lines
    cardText: "text-slate-100",
    muted: "text-slate-400",
  };

  async function load(category = null) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("period", period);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("thresholdMinutes", String(thresholdMinutes || 30));
      const res = await fetch(`/api/admin/reports/sales?${params.toString()}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!body.ok)
        throw new Error(body.error || "Failed to load sales report");
      setReport(body);
      setSelectedCategory("All");
    } catch (err) {
      alert(err.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // default date range: last 7 days
    if (!from && !to) {
      const t = new Date();
      const f = new Date();
      f.setDate(t.getDate() - 6);
      const iso = (d) => d.toISOString().slice(0, 10);
      setFrom(iso(f));
      setTo(iso(t));
    }
  }, []);

  useEffect(() => {
    if (from && to) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, from, to, thresholdMinutes]);

  function exportCsv() {
    if (!report) return alert("Generate report first");

    const header = [
      "category",
      "periodKey",
      "startDate",
      "endDate",
      "totalOrders",
      "totalRevenue",
      "avgOrderValue",
      "timelyCount",
      "timelyRate",
      "topItems",
    ];

    const rows = [];

    const categories = ["All", ...(report.categories || [])];
    for (const cat of categories) {
      for (const g of report.groups) {
        const catMetrics =
          g.categoryMetrics && g.categoryMetrics[cat]
            ? g.categoryMetrics[cat]
            : { revenue: 0, orders: 0, units: 0, topItems: [] };
        rows.push([
          cat,
          g.key,
          g.startDate,
          g.endDate,
          catMetrics.orders,
          catMetrics.revenue,
          catMetrics.orders
            ? (catMetrics.revenue / catMetrics.orders).toFixed(2)
            : 0,
          g.timelyCount || 0,
          g.timelyRate || 0,
          (catMetrics.topItems || [])
            .map((it) => `${it.qty}× ${it.name}`)
            .join("; "),
        ]);
      }
    }

    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell ?? "")}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-report-${report.period}-${report.from}-to-${report.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const chartData = (report?.groups || []).map((g) => {
    const catMetrics =
      g.categoryMetrics && g.categoryMetrics[selectedCategory]
        ? g.categoryMetrics[selectedCategory]
        : { revenue: 0, orders: 0, units: 0, topItems: [] };
    return {
      name: g.key,
      revenue: Number(catMetrics.revenue || 0),
      orders: Number(catMetrics.orders || 0),
      timelyRate: Number(g.timelyRate || 0),
    };
  });

  function totalsForCategory(cat) {
    if (!report) return null;
    if (!cat || cat === "All") return report.totals;
    return report.byCategory && report.byCategory[cat]
      ? report.byCategory[cat]
      : {
          totalOrders: 0,
          totalRevenue: 0,
          totalUnits: 0,
          topProducts: [],
          inventoryValue: 0,
        };
  }

  const categories = report ? ["All", ...(report.categories || [])] : ["All"];
  const totals = totalsForCategory(selectedCategory);

  // Ranked products for the selected category (ranking by units sold)
  function rankedProductsForSelected() {
    if (!report) return [];
    if (selectedCategory === "All") {
      return (report.totals?.topItems || []).map((it, idx) => ({
        rank: idx + 1,
        name: it.name,
        qty: it.qty,
      }));
    }
    const cat = report.byCategory && report.byCategory[selectedCategory];
    if (!cat) return [];
    return (cat.topProducts || []).map((it, idx) => ({
      rank: idx + 1,
      name: it.name,
      qty: it.qty,
    }));
  }

  const rankedList = rankedProductsForSelected();

  // Custom tooltip for dark UI (better contrast)
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    // payload may contain multiple entries (revenue, orders, timelyRate)
    const revenue = payload.find((p) => p.dataKey === "revenue")?.value ?? 0;
    const orders = payload.find((p) => p.dataKey === "orders")?.value ?? 0;
    const timely = payload.find((p) => p.dataKey === "timelyRate")?.value ?? 0;

    return (
      <div
        className="rounded-lg shadow-lg p-2"
        style={{
          background: "#0b1220",
          border: "1px solid rgba(148,163,184,0.08)",
          color: "#e6eef8",
          minWidth: 180,
          fontSize: 13,
        }}
      >
        <div className="text-xs text-slate-400 mb-1">{label}</div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-300">Revenue</div>
          <div className="font-medium">{fmtCurrency(revenue)}</div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <div className="text-xs text-slate-300">Orders</div>
          <div className="font-medium">{orders}</div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <div className="text-xs text-slate-300">Timely</div>
          <div className="font-medium">{timely}%</div>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Sales Reports</h1>
          <p className="text-sm text-slate-300">
            Daily / Weekly overview with category tabs, inventory valuation,
            best-performing products and top item breakdown.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded"
          >
            <FiDownload /> Export CSV
          </button>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
          <div>
            <label className="block text-sm text-slate-300">Period</label>
            <select
              className="p-2 bg-slate-900 rounded text-slate-100 w-full"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-300">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="p-2 bg-slate-900 rounded text-slate-100 w-full"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="p-2 bg-slate-900 rounded text-slate-100 w-full"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300">
              Timely threshold (minutes)
            </label>
            <input
              type="number"
              min="1"
              value={thresholdMinutes}
              onChange={(e) => setThresholdMinutes(Number(e.target.value || 0))}
              className="p-2 bg-slate-900 rounded text-slate-100 w-full"
            />
          </div>

          <div className="col-span-2 flex items-end gap-2">
            <button
              onClick={() => load()}
              disabled={loading}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-white"
            >
              {loading ? "Loading…" : "Generate Report"}
            </button>
            <button
              onClick={() => {
                setFrom("");
                setTo("");
                setReport(null);
              }}
              className="px-4 py-2 border rounded text-slate-200"
            >
              Reset
            </button>
          </div>
        </div>

        {!report && (
          <div className="text-slate-400">
            No report generated yet. Pick dates and click "Generate Report".
          </div>
        )}

        {report && (
          <div className="space-y-4">
            {/* CATEGORY TABS */}
            <div className="flex gap-2 flex-wrap">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedCategory(c)}
                  className={`px-3 py-1.5 rounded-full text-sm ${
                    selectedCategory === c
                      ? "bg-cyan-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-900 rounded">
                <div className="text-sm text-slate-400">Range</div>
                <div className="text-lg text-slate-100">
                  {report.from} → {report.to}
                </div>
                <div className="text-xs text-slate-400">
                  Period: {report.period}, threshold: {report.thresholdMinutes}{" "}
                  minutes
                </div>
              </div>

              <div className="p-3 bg-slate-900 rounded">
                <div className="text-sm text-slate-400">Total Orders</div>
                <div className="text-2xl text-slate-100">
                  {totals?.totalOrders ?? 0}
                </div>
              </div>

              <div className="p-3 bg-slate-900 rounded">
                <div className="text-sm text-slate-400">Total Revenue</div>
                <div className="text-2xl text-slate-100">
                  {fmtCurrency(totals?.totalRevenue ?? 0)}
                </div>
                <div className="text-xs text-slate-400">
                  Timely: {report.totals?.timelyCount ?? 0} (
                  {report.totals?.timelyRate ?? 0}%)
                </div>
              </div>

              <div className="p-3 bg-slate-900 rounded">
                <div className="text-sm text-slate-400">Inventory Value</div>
                <div className="text-2xl text-slate-100">
                  {fmtCurrency(report.inventoryTotals?.totalValue ?? 0)}
                </div>
                <div className="text-xs text-slate-400">
                  {selectedCategory !== "All"
                    ? `Category inventory: ${fmtCurrency(
                        totals?.inventoryValue ?? 0
                      )}`
                    : "All categories value shown above"}
                </div>
              </div>
            </div>

            {/* BEST PERFORMERS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 bg-slate-900 rounded">
                <div className="text-sm text-slate-400">
                  Top by Units (overall)
                </div>
                <div className="mt-2 text-sm">
                  {report.bestByUnits ? (
                    <>
                      <div className="font-medium text-slate-100">
                        {report.bestByUnits.name}
                      </div>
                      <div className="text-xs text-slate-400">
                        {report.bestByUnits.qty} units sold
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-500">—</div>
                  )}
                </div>
              </div>

              <div className="p-3 bg-slate-900 rounded">
                <div className="text-sm text-slate-400">
                  Top by Revenue (overall)
                </div>
                <div className="mt-2 text-sm">
                  {report.bestByRevenue ? (
                    <>
                      <div className="font-medium text-slate-100">
                        {report.bestByRevenue.name}
                      </div>
                      <div className="text-xs text-slate-400">
                        {fmtCurrency(report.bestByRevenue.revenue)}
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-500">—</div>
                  )}
                </div>
              </div>

              <div className="p-3 bg-slate-900 rounded">
                <div className="text-sm text-slate-400">
                  Top products (selected & ranked)
                </div>
                <div className="mt-2 text-sm">
                  {rankedList.length ? (
                    <div className="space-y-2">
                      {rankedList.slice(0, 20).map((it) => (
                        <div
                          key={it.name}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-6 text-xs font-mono text-amber-300">
                              #{it.rank}
                            </div>
                            <div className="truncate text-slate-100">
                              {it.name}
                            </div>
                          </div>
                          <div className="font-medium text-slate-200">
                            {it.qty}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-slate-500">
                      No sales for this category in range
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* CHART */}
            <div style={{ height: 360 }} className="bg-slate-900 p-3 rounded">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 10, right: 20, left: 0, bottom: 38 }}
                >
                  <CartesianGrid stroke={palette.grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: palette.axis, fontSize: 12 }}
                    axisLine={{ stroke: "rgba(148,163,184,0.06)" }}
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={70}
                  />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    tick={{ fill: palette.axis }}
                    axisLine={{ stroke: "rgba(148,163,184,0.06)" }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fill: palette.axis }}
                    axisLine={{ stroke: "rgba(148,163,184,0.06)" }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    verticalAlign="top"
                    wrapperStyle={{
                      color: "#e6eef8",
                      paddingBottom: 8,
                    }}
                    formatter={(value) => (
                      <span style={{ color: "#e6eef8" }}>{value}</span>
                    )}
                  />

                  {/* Revenue (primary metric) */}
                  <Bar
                    yAxisId="left"
                    dataKey="revenue"
                    name="Revenue"
                    stackId="a"
                    fill={palette.chartRevenue}
                    barSize={18}
                    radius={[8, 8, 0, 0]}
                    isAnimationActive={false}
                  />

                  {/* Orders */}
                  <Bar
                    yAxisId="left"
                    dataKey="orders"
                    name="Orders"
                    stackId="b"
                    fill={palette.chartOrders}
                    barSize={14}
                    radius={[6, 6, 0, 0]}
                    isAnimationActive={false}
                  />

                  {/* Timely % — show as thinner bar for visibility */}
                  <Bar
                    yAxisId="right"
                    dataKey="timelyRate"
                    name="Timely %"
                    fill={palette.chartTimely}
                    barSize={8}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto bg-slate-900 p-3 rounded">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-300">
                  <tr>
                    <th className="p-2">Bucket</th>
                    <th className="p-2">Start</th>
                    <th className="p-2">End</th>
                    <th className="p-2">Orders</th>
                    <th className="p-2">Revenue</th>
                    <th className="p-2">Avg Order</th>
                    <th className="p-2">Timely</th>
                    <th className="p-2">Timely %</th>
                    <th className="p-2">Top Items (selected)</th>
                  </tr>
                </thead>
                <tbody>
                  {report.groups.map((g) => {
                    const catMetrics =
                      g.categoryMetrics && g.categoryMetrics[selectedCategory]
                        ? g.categoryMetrics[selectedCategory]
                        : { revenue: 0, orders: 0, units: 0, topItems: [] };
                    return (
                      <tr key={g.key} className="border-t border-slate-700">
                        <td className="p-2 text-slate-100">{g.key}</td>
                        <td className="p-2 text-slate-200">
                          {new Date(g.startDate).toLocaleString()}
                        </td>
                        <td className="p-2 text-slate-200">
                          {new Date(g.endDate).toLocaleString()}
                        </td>
                        <td className="p-2 text-slate-100">
                          {catMetrics.orders}
                        </td>
                        <td className="p-2 text-slate-100">
                          {fmtCurrency(catMetrics.revenue)}
                        </td>
                        <td className="p-2 text-slate-100">
                          {catMetrics.orders
                            ? fmtCurrency(
                                catMetrics.revenue / catMetrics.orders
                              )
                            : fmtCurrency(0)}
                        </td>
                        <td className="p-2 text-slate-100">{g.timelyCount}</td>
                        <td className="p-2 text-slate-100">{g.timelyRate}%</td>
                        <td className="p-2">
                          {(catMetrics.topItems || [])
                            .slice(0, 6)
                            .map((it, idx) => (
                              <div
                                key={it.name + idx}
                                className="flex justify-between text-xs"
                              >
                                <div className="truncate mr-2 text-slate-200">
                                  {it.name}
                                </div>
                                <div className="font-medium ml-2 text-slate-100">
                                  {it.qty}
                                </div>
                              </div>
                            ))}
                          {!catMetrics.topItems?.length && (
                            <div className="text-slate-500 text-xs">—</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* small product inventory table */}
            <div className="bg-slate-900 p-3 rounded">
              <h3 className="text-sm text-slate-300 mb-2">
                Inventory valuation (per product)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-300">
                    <tr>
                      <th className="p-2">Product</th>
                      <th className="p-2">Category</th>
                      <th className="p-2">Price</th>
                      <th className="p-2">Stock (total)</th>
                      <th className="p-2">Inventory Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.inventoryTotals?.perProduct || []).map((p) => (
                      <tr
                        key={p.productId}
                        className="border-t border-slate-700"
                      >
                        <td className="p-2 text-slate-100">{p.name}</td>
                        <td className="p-2 text-slate-200">
                          {p.category || "-"}
                        </td>
                        <td className="p-2 text-slate-100">
                          {fmtCurrency(p.price)}
                        </td>
                        <td className="p-2 text-slate-100">
                          {p.totalInventory}
                        </td>
                        <td className="p-2 text-slate-100">
                          {fmtCurrency(p.inventoryValue)}
                        </td>
                      </tr>
                    ))}
                    {!report.inventoryTotals?.perProduct?.length && (
                      <tr>
                        <td colSpan="5" className="p-4 text-slate-500">
                          No inventory data
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
