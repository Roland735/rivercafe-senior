// app/api/products/route.js
import { NextResponse } from "next/server";
import { connectToDatabase, Product } from "../../../models/allModels.js";

/**
 * GET /api/products
 * Query params:
 *  - available=true|false   (optional)
 *  - category=<string>      (optional)
 *  - page=<number>          (optional, default 1)
 *  - limit=<number>         (optional, default 50, max 100)
 *
 * Returns JSON: { ok: true, products: [...] }
 */
export async function GET(req) {
    try {
        await connectToDatabase();

        const url = new URL(req.url);
        const available = url.searchParams.get("available");
        const category = url.searchParams.get("category");
        const page = Math.max(1, Number(url.searchParams.get("page") || 1));
        const limit = Math.min(100, Number(url.searchParams.get("limit") || 50));
        const skip = (page - 1) * limit;

        const q = {};
        if (available === "true") q.available = true;
        if (available === "false") q.available = false;
        if (category) q.category = category;

        const products = await Product.find(q)
            .sort({ category: 1, name: 1 })
            .skip(skip)
            .limit(limit)
            .lean();

        return NextResponse.json({ ok: true, products });
    } catch (err) {
        console.error("products GET error:", err?.message || err);
        return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
    }
}
