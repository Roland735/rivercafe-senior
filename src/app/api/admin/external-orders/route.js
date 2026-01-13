// app/api/admin/external-orders/route.js
import { AuditLog, connectToDatabase, ExternalCode, placeOrderAtomic } from '@/models/allModels';
import { NextResponse } from 'next/server';


/**
 * POST /api/admin/external-orders
 * Body:
 * {
 *   items: [ { productId: "<id>", qty: 1, notes: "" }, ... ],
 *   issuedToName: "Visitor name",
 *   expiresInMinutes: 120,
 *   actor: "<adminId>" // optional, use session to derive in production
 * }
 *
 * Response:
 * { ok: true, order, externalCode }
 */
export async function POST(req) {
    try {
        await connectToDatabase();

        const body = await req.json();
        const { items = [], issuedToName = '', expiresInMinutes = 120, actor = null } = body;

        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ ok: false, error: 'No items provided' }, { status: 400 });
        }

        // Build order payload expected by placeOrderAtomic
        const orderPayload = {
            items: items.map(it => ({ productId: it.productId, qty: Number(it.qty || 1), notes: it.notes || '' })),
            prepStationId: body.prepStationId || null,
            orderingWindowId: body.orderingWindowId || null,
            external: true,
            issuedByAdminId: actor || null
        };

        // Create external order atomically (placeOrderAtomic will create Order and not deduct any user balance because external=true)
        const placed = await placeOrderAtomic(null, orderPayload, { trustBalanceCheck: false });

        // Create ExternalCode tied to the created order
        const exDoc = await ExternalCode.createOne({
            prefix: 'EX-',
            value: placed?.order?.total || null,
            order: placed.order._id,
            issuedBy: actor || null,
            expiresInMinutes: Number(expiresInMinutes || 120),
            meta: { issuedToName: issuedToName || '' }
        });

        // Audit
        try {
            await AuditLog.create({
                actor: actor || null,
                action: 'external_order_create',
                collectionName: 'orders',
                documentId: placed.order._id,
                changes: { orderId: placed.order._id.toString(), externalCode: exDoc.code, issuedToName }
            });
        } catch (e) {
            console.warn('Audit log failed for external order', e);
        }

        // return created order and code
        return NextResponse.json({ ok: true, order: placed.order, externalCode: exDoc });
    } catch (err) {
        console.error('POST /api/admin/external-orders error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
