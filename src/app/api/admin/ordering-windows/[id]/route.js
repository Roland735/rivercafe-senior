// app/api/admin/ordering-windows/[id]/route.js
import { NextResponse } from 'next/server';

import mongoose from 'mongoose';
import { AuditLog, connectToDatabase, OrderingWindow } from '@/models/allModels';

export async function GET(req, { params }) {
    try {
        await connectToDatabase();

        // params is async in Next.js 15+ — await it before accessing properties
        const { id } = await params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
        }

        const doc = await OrderingWindow.findById(id).lean();
        if (!doc) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        return NextResponse.json({ ok: true, window: doc });
    } catch (err) {
        console.error('GET /api/admin/ordering-windows/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function PUT(req, { params }) {
    try {
        await connectToDatabase();

        // await params here as required by Next.js
        const { id } = await params;

        const body = await req.json();
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
        }

        const allowed = {};
        const fields = [
            'name',
            'daysOfWeek',
            'startTime',
            'endTime',
            'active',
            'allowedProductIds',
            'priority',
            'timezone',
            'description'
        ];
        for (const f of fields) {
            if (typeof body[f] !== 'undefined') allowed[f] = body[f];
        }

        const before = await OrderingWindow.findById(id).lean();
        const doc = await OrderingWindow.findByIdAndUpdate(id, { $set: allowed }, { new: true }).lean();

        try {
            await AuditLog.create({
                actor: body.actor || null,
                action: 'ordering_window_update',
                collectionName: 'orderingwindows',
                documentId: doc._id,
                changes: { before, after: doc }
            });
        } catch (e) {
            console.warn('Audit log failed', e);
        }

        return NextResponse.json({ ok: true, window: doc });
    } catch (err) {
        console.error('PUT /api/admin/ordering-windows/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(req, { params }) {
    try {
        await connectToDatabase();

        // await params here as required by Next.js
        const { id } = await params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
        }

        const doc = await OrderingWindow.findByIdAndDelete(id).lean();
        if (!doc) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        try {
            await AuditLog.create({
                actor: null,
                action: 'ordering_window_delete',
                collectionName: 'orderingwindows',
                documentId: id,
                changes: { deleted: doc }
            });
        } catch (e) {
            console.warn('Audit log failed', e);
        }

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/admin/ordering-windows/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
