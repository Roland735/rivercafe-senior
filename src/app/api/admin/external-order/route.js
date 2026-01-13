// app/api/admin/external-order/route.js
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
// adjust this relative path if your NextAuth route is in a different location
import { authOptions } from "../../auth/[...nextauth]/route";
import {
    connectToDatabase,
    Product,
    ExternalCode,
    placeOrderAtomic,
} from "../../../../models/allModels.js";

/**
 * POST /api/admin/external-order
 * Body: { items: [{ productId, qty }], prepStationId?, orderingWindowId?, issuedToName?, expiresInMinutes?, note? }
 *
 * Returns:
 *  { ok: true, order, pickupCode: <order.code>, externalCode: <externalCodeDoc> }
 */
export async function POST(req) {
    try {
        // auth: admin only
        const session = await getServerSession(authOptions);
        if (!session || !session.user || session.user.role !== "admin") {
            return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const {
            items = [],
            prepStationId = null,
            orderingWindowId = null,
            issuedToName = "",
            expiresInMinutes = 60,
            note = "",
        } = body || {};

        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ ok: false, error: "Cart is empty" }, { status: 400 });
        }

        await connectToDatabase();

        // validate product ids exist
        const productIds = items.map((i) => i.productId);
        const prods = await Product.find({ _id: { $in: productIds } }).lean();
        if (prods.length !== new Set(productIds).size) {
            return NextResponse.json({ ok: false, error: "One or more products not found" }, { status: 400 });
        }

        // Create the order (external: true). placeOrderAtomic will create Order.code internally.
        const orderRes = await placeOrderAtomic(null, {
            items: items.map((it) => ({ productId: it.productId, qty: it.qty || 1, notes: it.notes || "" })),
            prepStationId,
            orderingWindowId,
            external: true,
            issuedByAdminId: session.user.id,
        }, { trustBalanceCheck: false });

        if (!orderRes || !orderRes.ok || !orderRes.order) {
            return NextResponse.json({ ok: false, error: "Failed to create order" }, { status: 500 });
        }

        const order = orderRes.order;

        // Use the order's code as the pickup code. Create ExternalCode record with same code.
        const expiresAt = expiresInMinutes && Number(expiresInMinutes) > 0
            ? new Date(Date.now() + Number(expiresInMinutes) * 60 * 1000)
            : null;

        const extDoc = await ExternalCode.create({
            code: order.code,              // <-- use ORDER's code as the pickup code
            value: null,
            order: order._id || order.id || order._doc?._id || null,
            issuedToName: issuedToName || null,
            issuedBy: session.user.id,
            expiresAt,
            used: false,
            meta: { note },
        });

        return NextResponse.json(
            { ok: true, order, pickupCode: order.code, externalCode: extDoc },
            { status: 201 }
        );
    } catch (err) {
        console.error("external-order error", err?.message || err);
        return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
    }
}
