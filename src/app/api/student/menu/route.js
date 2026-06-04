// app/api/student/menu/route.js  (updated API route)
import { NextResponse } from "next/server";
import { connectToDatabase, Product, Inventory, Order } from "@/models/allModels.js";

export async function GET(req) {
    try {
        await connectToDatabase();

        // Return available products sorted by category/name
        const products = await Product.find({ available: true })
            .select("name category price prepTimeMinutes imageUrl tags allergens notes metadata createdAt")
            .sort({ createdAt: -1, name: 1 })
            .lean();

        const productIds = products.map((p) => p._id);
        const inventoryRows = productIds.length
            ? await Inventory.find({ product: { $in: productIds }, active: true })
                .select("product quantity lowStockThreshold metadata createdAt updatedAt")
                .lean()
            : [];

        const inventoryByProduct = new Map();
        for (const row of inventoryRows) {
            const pid = String(row.product);
            if (!inventoryByProduct.has(pid)) inventoryByProduct.set(pid, []);
            inventoryByProduct.get(pid).push(row);
        }

        const recentOrders = productIds.length
            ? await Order.find({
                status: { $nin: ["cancelled", "refunded"] },
                "items.product": { $in: productIds },
            })
                .select("items")
                .sort({ createdAt: -1 })
                .limit(400)
                .lean()
            : [];

        const salesByProduct = new Map();
        for (const order of recentOrders) {
            for (const item of order.items || []) {
                const pid = item?.product ? String(item.product) : null;
                if (!pid) continue;
                salesByProduct.set(
                    pid,
                    Number(salesByProduct.get(pid) || 0) + Number(item.qty || 0),
                );
            }
        }

        const visibleCandidates = products.filter((p) => {
            const rows = inventoryByProduct.get(String(p._id)) || [];
            if (rows.length === 0) return true;
            const total = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
            return total > 0;
        });
        const newestVisibleIds = new Set(
            visibleCandidates.slice(0, 10).map((p) => String(p._id)),
        );

        // Enrich products with inventory totals and threshold info.
        // For each product we compute:
        //  - stock: total quantity across active inventory docs (number) OR null if no inventory docs
        //  - lowStockThreshold: sum of lowStockThreshold across active inventory docs (number)
        //  - lowStockHurry: true when there are inventory docs and stock <= lowStockThreshold
        const enriched = products.map((p) => {
            const invDocs = inventoryByProduct.get(String(p._id)) || [];
            if (!invDocs.length) {
                return {
                    ...p,
                    stock: null,
                    lowStockThreshold: 0,
                    lowStockHurry: false,
                    salesCount: Number(salesByProduct.get(String(p._id)) || 0),
                    isNewArrival: newestVisibleIds.has(String(p._id)),
                    isBackByDemand: false,
                    trendBadge: newestVisibleIds.has(String(p._id)) ? "New Arrival" : null,
                };
            }

            const stock = invDocs.reduce((s, d) => s + (Number(d.quantity || 0)), 0);
            const lowStockThreshold = invDocs.reduce((s, d) => s + (Number(d.lowStockThreshold || 0)), 0);
            const lowStockHurry = stock <= lowStockThreshold;
            const lastOutOfStockAt = invDocs
                .map((d) => d?.metadata?.lastOutOfStockAt)
                .filter(Boolean)
                .map((value) => new Date(value))
                .filter((value) => !Number.isNaN(value.getTime()))
                .sort((a, b) => b.getTime() - a.getTime())[0] || null;
            const lastRestockedAt = invDocs
                .map((d) => d?.metadata?.lastRestockedAt)
                .filter(Boolean)
                .map((value) => new Date(value))
                .filter((value) => !Number.isNaN(value.getTime()))
                .sort((a, b) => b.getTime() - a.getTime())[0] || null;
            const restockedFromZeroCount = invDocs.reduce(
                (sum, d) => sum + Number(d?.metadata?.restockedFromZeroCount || 0),
                0,
            );
            const isBackByDemand =
                stock > 0 &&
                !!lastRestockedAt &&
                (!!lastOutOfStockAt
                    ? lastRestockedAt.getTime() >= lastOutOfStockAt.getTime()
                    : restockedFromZeroCount > 0);
            const isNewArrival = newestVisibleIds.has(String(p._id));

            return {
                ...p,
                stock,
                lowStockThreshold,
                lowStockHurry,
                salesCount: Number(salesByProduct.get(String(p._id)) || 0),
                isNewArrival,
                isBackByDemand,
                lastOutOfStockAt,
                lastRestockedAt,
                trendBadge: isBackByDemand
                    ? "Back by Demand"
                    : isNewArrival
                        ? "New Arrival"
                        : null,
            };
        });

        const topBackByDemandIds = new Set(
            enriched
                .filter((p) => p.isBackByDemand)
                .sort((a, b) => {
                    if (b.salesCount !== a.salesCount) return b.salesCount - a.salesCount;
                    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
                })
                .slice(0, 10)
                .map((p) => String(p._id)),
        );

        const finalProducts = enriched
            .map((p) => ({
                ...p,
                isBackByDemand: topBackByDemandIds.has(String(p._id)),
                trendBadge: topBackByDemandIds.has(String(p._id))
                    ? "Back by Demand"
                    : p.isNewArrival
                        ? "New Arrival"
                        : p.trendBadge,
            }))
            .sort((a, b) => {
                const cat = String(a.category || "").localeCompare(String(b.category || ""));
                if (cat !== 0) return cat;
                return String(a.name || "").localeCompare(String(b.name || ""));
            });

        return NextResponse.json({ ok: true, products: finalProducts }, { status: 200 });
    } catch (err) {
        console.error("GET /api/student/menu error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}
