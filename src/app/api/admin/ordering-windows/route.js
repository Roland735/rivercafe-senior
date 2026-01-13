// app/api/admin/ordering-windows/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, OrderingWindow, AuditLog } from '../../../../models/allModels.js';

/**
 * GET: list ordering windows
 * POST: create an ordering window
 *
 * Body for POST:
 * { name, daysOfWeek: [0..6], startTime: "07:30", endTime: "10:00", active:true, allowedProductIds:[], timezone }
 */

export async function GET() {
    try {
        await connectToDatabase();
        const docs = await OrderingWindow.find().sort({ priority: -1, startTime: 1 }).lean();
        return NextResponse.json({ ok: true, windows: docs });
    } catch (err) {
        console.error('GET /api/admin/ordering-windows error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        await connectToDatabase();
        const body = await req.json();
        if (!body.name || !body.startTime || !body.endTime) {
            return NextResponse.json({ ok: false, error: 'Missing required fields (name, startTime, endTime)' }, { status: 400 });
        }

        const doc = await OrderingWindow.create({
            name: body.name,
            daysOfWeek: Array.isArray(body.daysOfWeek) ? body.daysOfWeek : [],
            startTime: body.startTime,
            endTime: body.endTime,
            active: typeof body.active === 'boolean' ? body.active : true,
            allowedProductIds: Array.isArray(body.allowedProductIds) ? body.allowedProductIds : [],
            priority: typeof body.priority === 'number' ? body.priority : 0,
            timezone: body.timezone || 'Africa/Harare',
            description: body.description || ''
        });

        try {
            await AuditLog.create({ actor: body.actor || null, action: 'ordering_window_create', collectionName: 'orderingwindows', documentId: doc._id, changes: { created: doc } });
        } catch (e) { console.warn('Audit log failed', e); }

        return NextResponse.json({ ok: true, window: doc });
    } catch (err) {
        console.error('POST /api/admin/ordering-windows error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
