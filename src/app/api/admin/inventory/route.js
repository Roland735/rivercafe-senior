export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { connectToDatabase, Product, Inventory, AuditLog } from "@/models/allModels.js";
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
        if (!session || !session.user || !["admin", "inventory"].includes(role)) {
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
        return NextResponse.json({ ok: true, products: productsWithTotals, inventories: invRows }, { status: 200 });
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
        if (!session || !session.user || !["admin", "inventory"].includes(role)) {
            return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const { productId, quantity = 0, location = "Main", lowStockThreshold = 0, active = true } = body || {};

        if (!productId) return NextResponse.json({ ok: false, error: "Missing productId" }, { status: 400 });
        // validate product exists
        const product = await Product.findById(productId).lean();
        if (!product) return NextResponse.json({ ok: false, error: "Product not found" }, { status: 404 });

        // Try find existing inventory row for product+location
        const existing = await Inventory.findOne({ product: productId, location: String(location || "").trim() });

        let saved;
        if (existing) {
            existing.quantity = Number(quantity);
            existing.lowStockThreshold = Number(lowStockThreshold || 0);
            existing.active = active === false ? false : true;
            existing.metadata = existing.metadata || {};
            saved = await existing.save();
            // audit
            try {
                await AuditLog.create({
                    actor: session.user.id || session.user.sub || null,
                    action: "inventory_update",
                    collectionName: "inventories",
                    documentId: saved._id,
                    changes: { quantity: saved.quantity, location: saved.location, lowStockThreshold: saved.lowStockThreshold },
                    meta: { productId },
                });
            } catch (e) { /* ignore audit errors */ }
        } else {
            // create one inventory row (auto-create when product has none)
            const doc = {
                product: productId,
                quantity: Number(quantity),
                location: String(location || "").trim(),
                lowStockThreshold: Number(lowStockThreshold || 0),
                active: active === false ? false : true,
                metadata: {},
            };
            saved = await Inventory.create(doc);
            // audit
            try {
                await AuditLog.create({
                    actor: session.user.id || session.user.sub || null,
                    action: "inventory_create",
                    collectionName: "inventories",
                    documentId: saved._id,
                    changes: { quantity: saved.quantity, location: saved.location, lowStockThreshold: saved.lowStockThreshold },
                    meta: { productId },
                });
            } catch (e) { /* ignore audit errors */ }
        }

        // populate product info
        const populated = await Inventory.findById(saved._id).populate({ path: "product", select: "name sku" }).lean();

        return NextResponse.json({ ok: true, inventory: populated }, { status: 200 });
    } catch (err) {
        console.error("POST /api/admin/inventory error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}

export async function PATCH(req) {
    try {
        await connectToDatabase();
        const session = await getSessionLike(req);
        const role = String(session?.user?.role || "").toLowerCase();
        if (!session || !session.user || !["admin", "inventory"].includes(role)) {
            return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const { inventoryId, quantity, location, lowStockThreshold, active } = body || {};

        if (!inventoryId) return NextResponse.json({ ok: false, error: "Missing inventoryId" }, { status: 400 });

        const inv = await Inventory.findById(inventoryId);
        if (!inv) return NextResponse.json({ ok: false, error: "Inventory row not found" }, { status: 404 });

        if (quantity !== undefined) inv.quantity = Number(quantity);
        if (location !== undefined) inv.location = String(location);
        if (lowStockThreshold !== undefined) inv.lowStockThreshold = Number(lowStockThreshold);
        if (active !== undefined) inv.active = !!active;

        const saved = await inv.save();

        try {
            await AuditLog.create({
                actor: session.user.id || session.user.sub || null,
                action: "inventory_update",
                collectionName: "inventories",
                documentId: saved._id,
                changes: { quantity: saved.quantity, location: saved.location, lowStockThreshold: saved.lowStockThreshold, active: saved.active },
                meta: { productId: saved.product?.toString ? saved.product.toString() : saved.product },
            });
        } catch (e) { /* ignore */ }

        const populated = await Inventory.findById(saved._id).populate({ path: "product", select: "name sku" }).lean();
        return NextResponse.json({ ok: true, inventory: populated }, { status: 200 });
    } catch (err) {
        console.error("PATCH /api/admin/inventory error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}

export async function DELETE(req) {
    try {
        await connectToDatabase();
        const session = await getSessionLike(req);
        const role = String(session?.user?.role || "").toLowerCase();
        if (!session || !session.user || !["admin", "inventory"].includes(role)) {
            return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const { inventoryId } = body || {};
        if (!inventoryId) return NextResponse.json({ ok: false, error: "Missing inventoryId" }, { status: 400 });

        const inv = await Inventory.findById(inventoryId);
        if (!inv) return NextResponse.json({ ok: false, error: "Inventory row not found" }, { status: 404 });

        await Inventory.deleteOne({ _id: inventoryId });

        try {
            await AuditLog.create({
                actor: session.user.id || session.user.sub || null,
                action: "inventory_delete",
                collectionName: "inventories",
                documentId: inv._id,
                changes: { deleted: true, product: inv.product?.toString ? inv.product.toString() : inv.product, location: inv.location },
            });
        } catch (e) { /* ignore */ }

        return NextResponse.json({ ok: true, deletedId: inventoryId }, { status: 200 });
    } catch (err) {
        console.error("DELETE /api/admin/inventory error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}
