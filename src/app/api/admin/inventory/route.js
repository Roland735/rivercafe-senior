export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { connectToDatabase, Product, Inventory, AuditLog, StockEntry, StockAdjustment } from "@/models/allModels.js";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

/**
 * Helper to obtain a session-like object using next-auth jwt helper (works server-side)
 */
async function getSessionLike(req) {
    try {
        const secret = authOptions?.secret || process.env.NEXTAUTH_SECRET;
        const cookieName = process.env.NODE_ENV === "production"
            ? "__Secure-next-auth.session-token"
            : "next-auth.session-token";

        const token = await getToken({
            req,
            secret,
            secureCookie: process.env.NODE_ENV === "production",
            cookieName,
        }).catch(() => null);

        if (!token) return null;
        return { user: token.user || token };
    } catch (err) {
        console.warn("getSessionLike error:", err?.message || err);
        return null;
    }
}

/**
 * GET:
 *  - returns { ok, products: [...], inventories: [...] }
 *  - products include a totalInventory field (sum of inventory rows)
 *  - optional query: ?productId=... to filter inventories for a product
 *
 * New: automatically creates a single Inventory row with quantity:0 (location: "Main")
 * for any product that currently has no inventory rows. Uses atomic upsert to avoid races.
 */
export async function GET(req) {
    try {
        await connectToDatabase();
        const session = await getSessionLike(req);
        const role = String(session?.user?.role || "").toLowerCase();
        if (!session || !session.user || role !== "inventory") {
            return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 401 });
        }

        const url = new URL(req.url);
        const productId = url.searchParams.get("productId") || null;

        // fetch products (basic data)
        const products = await Product.find({})
            .select("name sku category price available")
            .lean();

        // Ensure inventory documents exist for products that have none.
        // If productId is provided, limit to that product; otherwise all products.
        const toEnsure = productId ? products.filter(p => String(p._id) === String(productId)) : products;

        // Use Promise.all to run upserts concurrently. Use findOneAndUpdate with $setOnInsert so we don't modify existing docs.
        await Promise.all(
            toEnsure.map(async (p) => {
                try {
                    // Only create a default inventory doc if none exists for that product.
                    const existingCount = await Inventory.countDocuments({ product: p._id });
                    if (existingCount === 0) {
                        await Inventory.findOneAndUpdate(
                            { product: p._id, location: "Main" }, // try to create a 'Main' location row by default
                            {
                                $setOnInsert: {
                                    product: p._id,
                                    quantity: 0,
                                    location: "Main",
                                    active: true,
                                    lowStockThreshold: 0,
                                    metadata: { autoCreated: true },
                                },
                            },
                            { upsert: true, new: true }
                        );
                    }
                } catch (e) {
                    // Don't fail the whole request if an upsert fails; log and continue.
                    console.warn(`Failed to ensure inventory for product ${p._id}:`, e?.message || e);
                }
            })
        );

        // fetch inventories (optionally filtered)
        const invRows = await Inventory.find(productId ? { product: productId } : {})
            .select("product quantity location active lowStockThreshold metadata createdAt updatedAt")
            .populate({ path: "product", select: "name sku" })
            .lean();

        const stockEntries = await StockEntry.find(productId ? { product: productId } : {})
            .sort({ createdAt: -1 }).limit(500)
            .populate({ path: "product", select: "name sku" })
            .populate({ path: "recordedBy", select: "name email" })
            .lean();
        const stockAdjustments = await StockAdjustment.find(productId ? { product: productId } : {})
            .sort({ occurredAt: -1 }).limit(500)
            .populate({ path: "product", select: "name sku" })
            .populate({ path: "inventory", select: "location" })
            .populate({ path: "recordedBy", select: "name email" })
            .lean();

        // compute totals for each product
        const totals = {};
        for (const r of invRows) {
            const pid = String(r.product?._id || r.product);
            totals[pid] = (totals[pid] || 0) + Number(r.quantity || 0);
        }

        const productsWithTotals = products.map((p) => ({
            id: p._id?.toString(),
            name: p.name,
            sku: p.sku,
            category: p.category,
            price: p.price,
            available: !!p.available,
            totalInventory: totals[String(p._id)] || 0,
        }));

        // return inventories and products
        return NextResponse.json({ ok: true, products: productsWithTotals, inventories: invRows, stockEntries, stockAdjustments }, { status: 200 });
    } catch (err) {
        console.error("GET /api/admin/inventory error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}

/* rest of file (POST, PATCH, DELETE) unchanged - keep your existing logic for create/update/delete */
export async function POST(req) {
    try {
        await connectToDatabase();
        const session = await getSessionLike(req);
        const role = String(session?.user?.role || "").toLowerCase();
        if (!session || !session.user || role !== "inventory") {
            return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const { productId, quantity = 0, location = "Main", lowStockThreshold = 0, note = "" } = body || {};

        if (!productId) return NextResponse.json({ ok: false, error: "Missing productId" }, { status: 400 });
        const quantityAdded = Number(quantity);
        if (!Number.isFinite(quantityAdded) || quantityAdded <= 0) return NextResponse.json({ ok: false, error: "Quantity added must be greater than zero" }, { status: 400 });
        // validate product exists
        const product = await Product.findById(productId).lean();
        if (!product) return NextResponse.json({ ok: false, error: "Product not found" }, { status: 404 });

        // Try find existing inventory row for product+location
        const existing = await Inventory.findOne({ product: productId, location: String(location || "").trim() });

        let saved;
        if (existing) {
            const beforeQuantity = Number(existing.quantity || 0);
            const nextQuantity = beforeQuantity + quantityAdded;
            const metadata = existing.metadata || {};
            const nextMetadata = {
                ...metadata,
                previousQuantity: beforeQuantity,
                lastStockChangeAt: new Date(),
                ...(beforeQuantity > 0 && nextQuantity <= 0
                    ? { lastOutOfStockAt: new Date() }
                    : {}),
                ...(beforeQuantity <= 0 && nextQuantity > 0
                    ? {
                        lastRestockedAt: new Date(),
                        restockedFromZeroCount: Number(metadata.restockedFromZeroCount || 0) + 1,
                    }
                    : {}),
            };
            saved = await Inventory.findByIdAndUpdate(existing._id, {
                $inc: { quantity: quantityAdded },
                $set: { metadata: nextMetadata, active: true },
            }, { new: true });
        } else {
            // create one inventory row (auto-create when product has none)
            const initialQuantity = quantityAdded;
            const doc = {
                product: productId,
                quantity: initialQuantity,
                location: String(location || "").trim(),
                lowStockThreshold: Number(lowStockThreshold || 0),
                active: true,
                metadata: {
                    previousQuantity: 0,
                    lastStockChangeAt: new Date(),
                    ...(initialQuantity > 0 ? { lastRestockedAt: new Date() } : {}),
                    ...(initialQuantity <= 0 ? { lastOutOfStockAt: new Date() } : {}),
                    restockedFromZeroCount: initialQuantity > 0 ? 1 : 0,
                },
            };
            saved = await Inventory.create(doc);
        }

        let stockEntry;
        try {
            const stockBefore = Number(saved.quantity) - quantityAdded;
            stockEntry = await StockEntry.create({
                inventory: saved._id,
                product: saved.product,
                quantityAdded,
                location: saved.location || "Main",
                stockBefore,
                stockAfter: Number(saved.quantity),
                recordedBy: session.user.id || session.user.sub,
                note: String(note || "").trim(),
            });
        } catch (entryError) {
            await Inventory.updateOne({ _id: saved._id }, { $inc: { quantity: -quantityAdded } }).catch(() => null);
            throw entryError;
        }

        await AuditLog.create({
            actor: session.user.id || session.user.sub || null,
            action: "inventory_stock_add",
            collectionName: "stockentries",
            documentId: stockEntry._id,
            changes: { quantityAdded, stockBefore: stockEntry.stockBefore, stockAfter: stockEntry.stockAfter },
            meta: { productId, inventoryId: saved._id, location: saved.location, note: stockEntry.note },
        }).catch(() => null);

        // populate product info
        const populated = await Inventory.findById(saved._id).populate({ path: "product", select: "name sku" }).lean();

        return NextResponse.json({ ok: true, inventory: populated, stockEntry }, { status: 201 });
    } catch (err) {
        console.error("POST /api/admin/inventory error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}

export async function PATCH(req) {
    return NextResponse.json({ ok: false, error: "Inventory is append-only. Record a stock addition or a documented loss." }, { status: 405 });
}

export async function DELETE(req) {
    return NextResponse.json({ ok: false, error: "Inventory records cannot be deleted." }, { status: 405 });
}
