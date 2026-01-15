import { NextResponse } from 'next/server';
import { connectToDatabase, SpecialOrderingWindow, AuditLog } from '../../../../models/allModels.js';

export async function GET() {
    try {
        await connectToDatabase();
        const docs = await SpecialOrderingWindow.find().sort({ priority: -1, startTime: 1 }).lean();
        return NextResponse.json({ ok: true, windows: docs });
    } catch (err) {
        console.error('GET /api/admin/special-ordering-windows error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        await connectToDatabase();
        const body = await req.json();
        if (!body.category || !body.name || !body.startTime || !body.endTime) {
            return NextResponse.json({ ok: false, error: 'Missing required fields (category, name, startTime, endTime)' }, { status: 400 });
        }

        const doc = await SpecialOrderingWindow.create({
            category: String(body.category).trim(),
            name: body.name,
            daysOfWeek: Array.isArray(body.daysOfWeek) ? body.daysOfWeek : [],
            startTime: body.startTime,
            endTime: body.endTime,
            active: typeof body.active === 'boolean' ? body.active : true,
            priority: typeof body.priority === 'number' ? body.priority : 0,
            timezone: body.timezone || 'Africa/Harare',
            description: body.description || ''
        });

        try {
            await AuditLog.create({ actor: body.actor || null, action: 'special_ordering_window_create', collectionName: 'specialorderingwindows', documentId: doc._id, changes: { created: doc } });
        } catch (e) {
        }

        return NextResponse.json({ ok: true, window: doc });
    } catch (err) {
        console.error('POST /api/admin/special-ordering-windows error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

