// app/api/admin/external-codes/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, ExternalCode, Order } from '../../../../models/allModels.js';

/**
 * GET /api/admin/external-codes
 * Query params:
 *  - status=pending (unused & not expired) [default]
 *  - status=all (all codes)
 * Optional: ?limit=100
 *
 * Response:
 * { ok: true, codes: [ { code, value, issuedToName, orderId, issuedAt, expiresAt, used } ] }
 */

export async function GET(req) {
    try {
        await connectToDatabase();
        const url = new URL(req.url);
        const status = url.searchParams.get('status') || 'pending';
        const limit = Math.min(500, Number(url.searchParams.get('limit') || 200));

        const now = new Date();
        const filter = {};
        if (status === 'pending') {
            filter.used = false;
            filter.$or = [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }];
        }

        const docs = await ExternalCode.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        // Optionally populate details about the linked order (small)
        const orderIds = docs.filter(d => d.order).map(d => d.order);
        const orders = orderIds.length ? await Order.find({ _id: { $in: orderIds } }).lean().select('_id total status regNumber') : [];
        const ordersMap = new Map(orders.map(o => [String(o._id), o]));

        const codes = docs.map(d => ({
            _id: d._id,
            code: d.code,
            value: d.value,
            issuedToName: d.issuedToName || d.meta?.issuedToName || '',
            orderId: d.order ? String(d.order) : null,
            order: d.order ? ordersMap.get(String(d.order)) || null : null,
            issuedBy: d.issuedBy || null,
            issuedAt: d.createdAt,
            expiresAt: d.expiresAt || null,
            used: d.used,
            usedAt: d.usedAt || null
        }));

        return NextResponse.json({ ok: true, codes });
    } catch (err) {
        console.error('GET /api/admin/external-codes error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
