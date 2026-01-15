import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { AuditLog, connectToDatabase, SpecialOrderingWindow } from '@/models/allModels';

export async function GET(req, { params }) {
    try {
        await connectToDatabase();
        const { id } = await params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
        }

        const doc = await SpecialOrderingWindow.findById(id).lean();
        if (!doc) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        return NextResponse.json({ ok: true, window: doc });
    } catch (err) {
        console.error('GET /api/admin/special-ordering-windows/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function PUT(req, { params }) {
    try {
        await connectToDatabase();
        const { id } = await params;

        const body = await req.json();
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
        }

        const allowed = {};
        const fields = [
            'category',
            'name',
            'daysOfWeek',
            'startTime',
            'endTime',
            'active',
            'priority',
            'timezone',
            'description'
        ];
        for (const f of fields) {
            if (typeof body[f] !== 'undefined') allowed[f] = body[f];
        }

        const before = await SpecialOrderingWindow.findById(id).lean();
        const doc = await SpecialOrderingWindow.findByIdAndUpdate(id, { $set: allowed }, { new: true }).lean();

        try {
            await AuditLog.create({
                actor: body.actor || null,
                action: 'special_ordering_window_update',
                collectionName: 'specialorderingwindows',
                documentId: doc._id,
                changes: { before, after: doc }
            });
        } catch (e) {
        }

        return NextResponse.json({ ok: true, window: doc });
    } catch (err) {
        console.error('PUT /api/admin/special-ordering-windows/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(req, { params }) {
    try {
        await connectToDatabase();
        const { id } = await params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
        }

        const doc = await SpecialOrderingWindow.findByIdAndDelete(id).lean();
        if (!doc) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        try {
            await AuditLog.create({
                actor: null,
                action: 'special_ordering_window_delete',
                collectionName: 'specialorderingwindows',
                documentId: id,
                changes: { deleted: doc }
            });
        } catch (e) {
        }

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/admin/special-ordering-windows/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

