// app/api/student/menu/route.js  (updated API route)
import { NextResponse } from "next/server";
import { connectToDatabase, Product, Inventory } from "@/models/allModels.js";

export async function GET(req) {
    try {
        await connectToDatabase();

        // Return available products sorted by category/name
        const products = await Product.find({ available: true })
            .select("name category price prepTimeMinutes imageUrl allergens notes metadata")
            .sort({ category: 1, name: 1 })
            .lean();

        // Enrich products with inventory totals and threshold info.
        // For each product we compute:
        //  - stock: total quantity across active inventory docs (number) OR null if no inventory docs
        //  - lowStockThreshold: sum of lowStockThreshold across active inventory docs (number)
        //  - lowStockHurry: true when there are inventory docs and stock <= lowStockThreshold
        const enriched = await Promise.all(
            products.map(async (p) => {
                try {
                    const invDocs = await Inventory.find({ product: p._id, active: true }).select("quantity lowStockThreshold").lean();
                    if (!invDocs || invDocs.length === 0) {
                        // no inventory docs -> keep legacy behaviour (untracked stock)
                        return { ...p, stock: null, lowStockThreshold: 0, lowStockHurry: false };
                    }
                    const stock = invDocs.reduce((s, d) => s + (Number(d.quantity || 0)), 0);
                    const lowStockThreshold = invDocs.reduce((s, d) => s + (Number(d.lowStockThreshold || 0)), 0);
                    const lowStockHurry = stock <= lowStockThreshold;
                    return { ...p, stock, lowStockThreshold, lowStockHurry };
                } catch (e) {
                    // on error, return product without inventory (fail-safe)
                    console.warn("Failed to compute inventory for product", p._id, e?.message || e);
                    return { ...p, stock: null, lowStockThreshold: 0, lowStockHurry: false };
                }
            })
        );

        return NextResponse.json({ ok: true, products: enriched }, { status: 200 });
    } catch (err) {
        console.error("GET /api/student/menu error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}
