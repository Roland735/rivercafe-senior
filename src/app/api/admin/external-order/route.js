// app/api/admin/external-order/route.js
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
// adjust this relative path if your NextAuth route is in a different location
import { authOptions } from "../../auth/[...nextauth]/route";
import {
    connectToDatabase,
    Product,
    SpecialProduct,
    SpecialOrder,
    ExternalCode,
    Transaction,
    AuditLog,
    placeOrderAtomic,
    Order, // Import Order explicitly if needed for code generation
} from "../../../../models/allModels.js";

/**
 * POST /api/admin/external-order
 * Body: { items: [{ productId, qty }], prepStationId?, orderingWindowId?, issuedToName?, expiresInMinutes?, note?, isSpecial? }
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
            isSpecial = false,
        } = body || {};

        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ ok: false, error: "Cart is empty" }, { status: 400 });
        }

        await connectToDatabase();

        // --- SPECIAL ORDER PATH ---
        if (isSpecial) {
            // 1. Validate products
            const productIds = items.map((i) => i.productId);
            const prods = await SpecialProduct.find({ _id: { $in: productIds } }).lean();
            if (prods.length !== new Set(productIds).size) {
                return NextResponse.json({ ok: false, error: "One or more special products not found" }, { status: 400 });
            }
            const productMap = new Map(prods.map(p => [p._id.toString(), p]));

            // 2. Calculate total & build items
            let total = 0;
            const orderItems = items.map(it => {
                const p = productMap.get(it.productId);
                if (!p) throw new Error(`Product not found: ${it.productId}`);
                const qty = Math.max(1, Number(it.qty || 1));
                const price = p.price;
                total += price * qty;
                return {
                    product: p._id,
                    name: p.name,
                    price,
                    qty,
                    notes: it.notes || '',
                    allergens: p.allergens || [],
                    preparedCount: 0
                };
            });

            // 3. Create SpecialOrder
            const code = SpecialOrder.generateCode('SP-');
            const specialOrder = await SpecialOrder.create({
                code,
                user: null, // External
                items: orderItems,
                total,
                status: 'placed',
                orderingWindow: orderingWindowId || null,
                prepStation: prepStationId || null,
                // SpecialOrder schema doesn't have 'external' field explicitly but we can use meta or implied by user=null
                meta: { 
                    external: true, 
                    issuedByAdminId: session.user.id,
                    issuedToName 
                },
                remarks: note
            });

            // 4. Create Transaction (External)
            await Transaction.create({
                user: null,
                type: 'external',
                amount: total,
                relatedOrder: null, // Cannot ref SpecialOrder directly if strict, use meta
                createdBy: session.user.id,
                note: `External Special Order ${code}`,
                meta: { specialOrderId: specialOrder._id }
            });

            // 5. Audit Log
            await AuditLog.create({
                actor: session.user.id,
                action: 'place_special_order_external',
                collectionName: 'specialorders',
                documentId: specialOrder._id,
                changes: { total, items: orderItems.map(i => ({ name: i.name, qty: i.qty })) },
                meta: { external: true }
            });

            // 6. Create External Code
            const expiresAt = expiresInMinutes && Number(expiresInMinutes) > 0
                ? new Date(Date.now() + Number(expiresInMinutes) * 60 * 1000)
                : null;

            const extDoc = await ExternalCode.create({
                code: specialOrder.code,
                value: null,
                order: null, // Not a regular order
                issuedToName: issuedToName || null,
                issuedBy: session.user.id,
                expiresAt,
                used: false,
                meta: { 
                    note,
                    isSpecial: true,
                    specialOrderId: specialOrder._id
                },
            });

            return NextResponse.json(
                { ok: true, order: specialOrder, pickupCode: specialOrder.code, externalCode: extDoc },
                { status: 201 }
            );
        }

        // --- REGULAR ORDER PATH (Existing) ---
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
