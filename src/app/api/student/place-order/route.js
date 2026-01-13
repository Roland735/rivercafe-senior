// app/api/student/place-order/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, placeOrderAtomic, AuditLog } from '@/models/allModels';
import { getToken } from 'next-auth/jwt';

async function getServerToken(req) {
    const headersObj = {};
    for (const [k, v] of req.headers) headersObj[k] = v;
    return await getToken({ req: { headers: headersObj }, secret: process.env.NEXTAUTH_SECRET });
}

export async function POST(req) {
    try {
        await connectToDatabase();
        const body = await req.json();

        // Resolve user from NextAuth token
        const token = await getServerToken(req);
        let userIdOrReg = token?.user?.id || token?.user?.regNumber || null;

        // Dev/testing fallback: allow regNumber in body or query string
        if (!userIdOrReg) userIdOrReg = body.userId || body.regNumber || null;
        const url = new URL(req.url);
        if (!userIdOrReg && url.searchParams.get('regNumber')) userIdOrReg = url.searchParams.get('regNumber');

        if (!userIdOrReg) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) return NextResponse.json({ ok: false, error: 'No items provided' }, { status: 400 });

        const orderPayload = {
            items: items.map(it => ({ productId: it.productId, qty: Number(it.qty || 1), notes: it.notes || '' })),
            prepStationId: body.prepStationId || null,
            orderingWindowId: body.orderingWindowId || null,
            external: false,
            issuedByAdminId: body.issuedByAdminId || null
        };

        // place order atomically; placeOrderAtomic supports user lookup by id or regNumber
        const placed = await placeOrderAtomic(userIdOrReg, orderPayload, { trustBalanceCheck: true });

        // Audit (best-effort)
        try {
            await AuditLog.create({
                actor: token?.user?.id || body.issuedByAdminId || null,
                action: 'place_order_student',
                collectionName: 'orders',
                documentId: placed.order._id,
                changes: { orderId: placed.order._id.toString(), total: placed.order.total }
            });
        } catch (e) {
            console.warn('Audit log failed for student order', e);
        }

        return NextResponse.json({ ok: true, order: placed.order, tx: placed.tx || null });
    } catch (err) {
        console.error('POST /api/student/place-order error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
