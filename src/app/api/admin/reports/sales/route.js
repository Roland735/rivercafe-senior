// app/api/admin/reports/sales/route.js
export const runtime = "nodejs";

import { connectToDatabase, Order, Product, Inventory } from "@/models/allModels.js";

/**
 * GET /api/admin/reports/sales
 * (Robust version — parallel inventory lookups, guarded calls, extra logging)
 */

function parseISODateDay(s) {
    if (!s) return null;
    const d = new Date(s + "T00:00:00");
    if (Number.isNaN(d.getTime())) return null;
    return d;
}
function formatDateYYYYMMDD(d) {
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
}
/** weekStart = Monday */
function startOfWeek(d) {
    const x = new Date(d);
    const day = x.getDay(); // 0 Sunday ... 6
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    x.setDate(x.getDate() + diffToMonday);
    x.setHours(0, 0, 0, 0);
    return x;
}
function endOfWeek(d) {
    const s = startOfWeek(d);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return e;
}

export async function GET(req) {
    try {
        await connectToDatabase();

        const url = new URL(req.url);
        const qp = url.searchParams;

        const period = (qp.get("period") || "daily").toLowerCase();
        const thresholdMinutes = Number(qp.get("thresholdMinutes") || 30);

        const toParam = qp.get("to");
        const fromParam = qp.get("from");

        const today = startOfDay(new Date());
        const toDate = parseISODateDay(toParam) || today;
        const fromDate =
            parseISODateDay(fromParam) ||
            startOfDay(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));

        if (fromDate > toDate) {
            return new Response(
                JSON.stringify({ ok: false, error: "'from' must be <= 'to'" }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        const createdAtFilter = {
            $gte: startOfDay(fromDate),
            $lte: endOfDay(toDate),
        };

        // fetch orders in range, exclude cancelled
        const orders = await Order.find({
            createdAt: createdAtFilter,
            status: { $ne: "cancelled" },
        })
            .select("createdAt updatedAt status total items")
            .lean();

        // load products (for mapping name -> category/price)
        const products = await Product.find().select("name category price sku").lean();
        const productById = new Map();
        const productByName = new Map();
        for (const p of products) {
            if (p && p._id) productById.set(String(p._id), p);
            if (p && p.name) productByName.set(String(p.name).toLowerCase(), p);
        }

        function getCollectedAt(order) {
            if (order.status === "collected") {
                return order.updatedAt ? new Date(order.updatedAt) : null;
            }
            return null;
        }

        // grouping maps
        const groupsMap = new Map();

        // helper to process an order item into a bucket
        function processItemIntoBucket(bucket, it) {
            const qty = Number(it?.qty || 1);
            let prod = null;
            if (it?.product) prod = productById.get(String(it.product));
            if (!prod && it?.name) prod = productByName.get(String(it.name).toLowerCase());
            const price = Number(it?.price ?? (prod ? prod.price : 0)) || 0;
            const name = it?.name || (prod ? prod.name : String(it?.product || "Unknown"));
            const category = (prod && prod.category) ? prod.category : "Uncategorized";

            const prevCount = bucket.productCounts.get(name) || 0;
            bucket.productCounts.set(name, prevCount + qty);

            const prevRev = bucket.productRevenue.get(name) || 0;
            bucket.productRevenue.set(name, prevRev + price * qty);

            const prevCatRev = bucket.categoryRevenue.get(category) || 0;
            bucket.categoryRevenue.set(category, prevCatRev + price * qty);

            const prevCatUnits = bucket.categoryUnits.get(category) || 0;
            bucket.categoryUnits.set(category, prevCatUnits + qty);
        }

        if (period === "weekly") {
            for (const ord of orders) {
                const day = new Date(ord.createdAt);
                const wkStart = startOfWeek(day);
                const wkEnd = endOfWeek(day);
                const key = `${formatDateYYYYMMDD(wkStart)}_to_${formatDateYYYYMMDD(wkEnd)}`;
                if (!groupsMap.has(key)) {
                    groupsMap.set(key, {
                        startDate: wkStart,
                        endDate: wkEnd,
                        orders: [],
                        productCounts: new Map(),
                        productRevenue: new Map(),
                        categoryRevenue: new Map(),
                        categoryUnits: new Map(),
                    });
                }
                const bucket = groupsMap.get(key);
                bucket.orders.push(ord);

                if (Array.isArray(ord.items)) {
                    for (const it of ord.items) {
                        try {
                            processItemIntoBucket(bucket, it);
                        } catch (e) {
                            // guard per-item so a malformed item doesn't break everything
                            console.warn("Malformed order item skipped in weekly bucket:", e?.message || e, it);
                        }
                    }
                }
            }
        } else {
            // daily
            for (const ord of orders) {
                const day = startOfDay(new Date(ord.createdAt));
                const key = formatDateYYYYMMDD(day);
                if (!groupsMap.has(key)) {
                    groupsMap.set(key, {
                        startDate: day,
                        endDate: day,
                        orders: [],
                        productCounts: new Map(),
                        productRevenue: new Map(),
                        categoryRevenue: new Map(),
                        categoryUnits: new Map(),
                    });
                }
                const bucket = groupsMap.get(key);
                bucket.orders.push(ord);

                if (Array.isArray(ord.items)) {
                    for (const it of ord.items) {
                        try {
                            processItemIntoBucket(bucket, it);
                        } catch (e) {
                            console.warn("Malformed order item skipped in daily bucket:", e?.message || e, it);
                        }
                    }
                }
            }
        }

        // ensure buckets present for whole range
        if (period === "weekly") {
            let cur = startOfWeek(fromDate);
            const last = endOfWeek(toDate);
            while (cur <= last) {
                const wkStart = startOfWeek(cur);
                const wkEnd = endOfWeek(cur);
                const key = `${formatDateYYYYMMDD(wkStart)}_to_${formatDateYYYYMMDD(wkEnd)}`;
                if (!groupsMap.has(key)) {
                    groupsMap.set(key, {
                        startDate: wkStart,
                        endDate: wkEnd,
                        orders: [],
                        productCounts: new Map(),
                        productRevenue: new Map(),
                        categoryRevenue: new Map(),
                        categoryUnits: new Map(),
                    });
                }
                cur = new Date(wkStart);
                cur.setDate(cur.getDate() + 7);
            }
        } else {
            let cur = startOfDay(fromDate);
            const last = startOfDay(toDate);
            while (cur <= last) {
                const key = formatDateYYYYMMDD(cur);
                if (!groupsMap.has(key)) {
                    groupsMap.set(key, {
                        startDate: new Date(cur),
                        endDate: new Date(cur),
                        orders: [],
                        productCounts: new Map(),
                        productRevenue: new Map(),
                        categoryRevenue: new Map(),
                        categoryUnits: new Map(),
                    });
                }
                cur = new Date(cur);
                cur.setDate(cur.getDate() + 1);
            }
        }

        // compute metrics per group and aggregate overall
        const groups = [];
        let overallOrders = 0;
        let overallRevenue = 0;
        let overallTimely = 0;
        const overallProductCounts = new Map();
        const overallProductRevenue = new Map();
        const overallCategoryTotals = new Map();

        const sortedEntries = Array.from(groupsMap.entries()).sort((a, b) => {
            const aStart = new Date(a[1].startDate).getTime();
            const bStart = new Date(b[1].startDate).getTime();
            return aStart - bStart;
        });

        for (const [key, bucket] of sortedEntries) {
            const os = bucket.orders || [];
            const totalOrders = os.length;
            const totalRevenue = os.reduce((s, o) => s + Number(o.total || 0), 0);
            const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;

            // timely count
            let timelyCount = 0;
            for (const o of os) {
                try {
                    const collectedAt = getCollectedAt(o);
                    if (collectedAt) {
                        const diffMs = collectedAt.getTime() - new Date(o.createdAt).getTime();
                        const diffMin = diffMs / (1000 * 60);
                        if (diffMin <= thresholdMinutes) timelyCount++;
                    }
                } catch (e) {
                    console.warn("timely calc error for order:", e?.message || e, o._id || o.id);
                }
            }

            // product counts array
            const productCountsArr = Array.from((bucket.productCounts || new Map()).entries()).map(([name, qty]) => ({ name, qty }));
            productCountsArr.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

            const productRevenueArr = Array.from((bucket.productRevenue || new Map()).entries()).map(([name, revenue]) => ({ name, revenue }));
            productRevenueArr.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));

            // category arrays
            // estimate orderCategoryPresence
            const orderCategoryPresence = new Map();
            for (const o of os) {
                const present = new Set();
                if (Array.isArray(o.items)) {
                    for (const it of o.items) {
                        let prod = null;
                        if (it?.product) prod = productById.get(String(it.product));
                        if (!prod && it?.name) prod = productByName.get(String(it.name).toLowerCase());
                        const category = (prod && prod.category) ? prod.category : "Uncategorized";
                        present.add(category);
                    }
                }
                orderCategoryPresence.set(String(o._id || o.id || Math.random()), present);
            }

            const categoryMetricsObj = {};
            const catsSeen = new Set([...bucket.categoryRevenue.keys()].concat([...bucket.categoryUnits.keys()]));
            for (const cat of catsSeen) {
                const revenue = Number(bucket.categoryRevenue.get(cat) || 0);
                const units = Number(bucket.categoryUnits.get(cat) || 0);
                let ordersCount = 0;
                for (const s of orderCategoryPresence.values()) {
                    if (s.has(cat)) ordersCount++;
                }

                const topItems = [];
                for (const { name, qty } of productCountsArr) {
                    const prod = productByName.get(String(name).toLowerCase());
                    const prodCategory = (prod && prod.category) ? prod.category : (name === "Unknown" ? "Uncategorized" : null);
                    if (prodCategory === cat) topItems.push({ name, qty });
                }

                categoryMetricsObj[cat] = {
                    revenue,
                    orders: ordersCount,
                    units,
                    topItems: topItems.slice(0, 10),
                };

                const prev = overallCategoryTotals.get(cat) || { revenue: 0, units: 0, orders: 0 };
                prev.revenue += revenue;
                prev.units += units;
                prev.orders += ordersCount;
                overallCategoryTotals.set(cat, prev);
            }

            // update overall product counts & revenue
            for (const [name, qty] of (bucket.productCounts || new Map()).entries()) {
                const prev = overallProductCounts.get(name) || 0;
                overallProductCounts.set(name, prev + qty);
            }
            for (const [name, rev] of (bucket.productRevenue || new Map()).entries()) {
                const prevR = overallProductRevenue.get(name) || 0;
                overallProductRevenue.set(name, prevR + rev);
            }

            const timelyRate = totalOrders ? (timelyCount / totalOrders) * 100 : 0;

            const topItemsForBucket = productCountsArr.slice(0, 10);

            // prepare categoryMetrics for response (includes All)
            const categoryMetricsForResponse = {};
            categoryMetricsForResponse["All"] = {
                revenue: totalRevenue,
                orders: totalOrders,
                units: productCountsArr.reduce((s, it) => s + it.qty, 0),
                topItems: topItemsForBucket,
            };
            for (const [cat, obj] of Object.entries(categoryMetricsObj)) {
                categoryMetricsForResponse[cat] = {
                    revenue: Number(obj.revenue || 0),
                    orders: Number(obj.orders || 0),
                    units: Number(obj.units || 0),
                    topItems: obj.topItems || [],
                };
            }

            groups.push({
                key,
                startDate: bucket.startDate.toISOString(),
                endDate: bucket.endDate.toISOString(),
                totalOrders,
                totalRevenue,
                avgOrderValue: Number(avgOrderValue.toFixed(2)),
                timelyCount,
                timelyRate: Number(timelyRate.toFixed(2)),
                topItems: topItemsForBucket,
                categoryMetrics: categoryMetricsForResponse,
            });

            overallOrders += totalOrders;
            overallRevenue += totalRevenue;
            overallTimely += timelyCount;
        }

        const overallTopItemsUnits = Array.from(overallProductCounts.entries())
            .map(([name, qty]) => ({ name, qty }))
            .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

        const overallTopItemsRevenue = Array.from(overallProductRevenue.entries())
            .map(([name, revenue]) => ({ name, revenue }))
            .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));

        // compute inventory valuations in parallel (guard each call)
        const inventoryTotalsPerProduct = [];
        let inventoryTotalValue = 0;
        try {
            const perProductPromises = products.map(async (p) => {
                try {
                    const totalInventory = await Inventory.getTotalForProduct(p._id).catch((e) => {
                        console.warn("Inventory.getTotalForProduct failed for", p._id, e?.message || e);
                        return 0;
                    });
                    const price = Number(p.price || 0);
                    const inventoryValue = Number((price * (Number(totalInventory || 0))).toFixed(2));
                    return {
                        productId: String(p._id),
                        name: p.name,
                        sku: p.sku || "",
                        price,
                        category: p.category || "Uncategorized",
                        totalInventory: Number(totalInventory || 0),
                        inventoryValue,
                    };
                } catch (e) {
                    console.warn("Failed computing inventory for product", p._id, e?.message || e);
                    return {
                        productId: String(p._id || Math.random()),
                        name: p.name || "Unknown",
                        sku: p.sku || "",
                        price: Number(p.price || 0),
                        category: p.category || "Uncategorized",
                        totalInventory: 0,
                        inventoryValue: 0,
                    };
                }
            });

            const resolved = await Promise.all(perProductPromises);
            for (const it of resolved) {
                inventoryTotalsPerProduct.push(it);
                inventoryTotalValue += Number(it.inventoryValue || 0);
            }
        } catch (e) {
            console.warn("Parallel inventory computation failed", e?.message || e);
        }

        // inventory by category
        const inventoryValueByCategory = {};
        for (const item of inventoryTotalsPerProduct) {
            const cat = item.category || "Uncategorized";
            inventoryValueByCategory[cat] = (inventoryValueByCategory[cat] || 0) + item.inventoryValue;
        }

        // categories from both inventory and category totals
        const categories = Array.from(new Set([
            ...inventoryTotalsPerProduct.map(p => p.category || "Uncategorized"),
            ...Array.from(overallCategoryTotals.keys()),
        ])).sort();

        const byCategory = {};
        for (const cat of categories) {
            const catTotals = overallCategoryTotals.get(cat) || { revenue: 0, units: 0, orders: 0 };
            const topProducts = overallTopItemsUnits.filter(it => {
                const prod = productByName.get(String(it.name).toLowerCase());
                if (!prod) return false;
                return (prod.category || "Uncategorized") === cat;
            }).slice(0, 20);
            byCategory[cat] = {
                totalOrders: catTotals.orders || 0,
                totalRevenue: Number((catTotals.revenue || 0).toFixed(2)),
                totalUnits: catTotals.units || 0,
                topProducts,
                inventoryValue: Number((inventoryValueByCategory[cat] || 0).toFixed(2)),
            };
        }

        const overallTopItemsFinal = overallTopItemsUnits.slice(0, 20);
        const overallTopItemsRevenueFinal = overallTopItemsRevenue.slice(0, 20);
        const bestByUnits = overallTopItemsFinal.length ? overallTopItemsFinal[0] : null;
        const bestByRevenue = overallTopItemsRevenueFinal.length ? overallTopItemsRevenueFinal[0] : null;
        const overallTimelyRate = overallOrders ? (overallTimely / overallOrders) * 100 : 0;

        return new Response(
            JSON.stringify({
                ok: true,
                period,
                from: formatDateYYYYMMDD(startOfDay(fromDate)),
                to: formatDateYYYYMMDD(endOfDay(toDate)),
                thresholdMinutes,
                groups,
                totals: {
                    totalOrders: overallOrders,
                    totalRevenue: Number(overallRevenue.toFixed(2)),
                    timelyCount: overallTimely,
                    timelyRate: Number(overallTimelyRate.toFixed(2)),
                    topItems: overallTopItemsFinal,
                },
                categories,
                byCategory,
                inventoryTotals: {
                    totalValue: Number(inventoryTotalValue.toFixed(2)),
                    perProduct: inventoryTotalsPerProduct,
                    byCategory: inventoryValueByCategory,
                },
                bestByUnits,
                bestByRevenue: bestByRevenue ? { name: bestByRevenue.name, revenue: Number(bestByRevenue.revenue.toFixed(2)) } : null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    } catch (err) {
        // log full stack for easier debugging in server logs
        console.error("sales report error (full):", err && (err.stack || err.message || String(err)));
        return new Response(
            JSON.stringify({ ok: false, error: err && (err.message || String(err)) || "Unknown server error" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
