// app/api/admin/products/[id]/route.js
import { NextResponse } from 'next/server';

import mongoose from 'mongoose';
import { AuditLog, connectToDatabase, Product } from '@/models/allModels';

export async function GET(req, { params }) {
    try {
        await connectToDatabase();
        const { id } = params;
        if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });

        const product = await Product.findById(id).lean();
        if (!product) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
        return NextResponse.json({ ok: true, product });
    } catch (err) {
        console.error('GET /api/admin/products/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function PUT(req, { params }) {
    try {
        await connectToDatabase();
        const { id } = params;
        if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });

        const body = await req.json();
        const updates = {};
        const allowed = ['name', 'sku', 'category', 'price', 'available', 'availablePeriods', 'prepTimeMinutes', 'prepStation', 'imageUrl', 'tags', 'allergens', 'notes', 'metadata'];
        for (const k of allowed) {
            if (typeof body[k] !== 'undefined') updates[k] = body[k];
        }

        const before = await Product.findById(id).lean();
        if (!before) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        await Product.updateOne({ _id: id }, { $set: updates });
        const after = await Product.findById(id).lean();

        // Audit log
        try {
            await AuditLog.create({
                actor: body._actor || null,
                action: 'menu_update',
                collectionName: 'products',
                documentId: id,
                changes: { before, after }
            });
        } catch (e) { console.warn('Audit log failed', e); }

        return NextResponse.json({ ok: true, product: after });
    } catch (err) {
        console.error('PUT /api/admin/products/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(req, { params }) {
    try {
        await connectToDatabase();
        const { id } = params;
        if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });

        const doc = await Product.findByIdAndDelete(id);
        if (!doc) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        try {
            await AuditLog.create({
                actor: null,
                action: 'menu_delete',
                collectionName: 'products',
                documentId: id,
                changes: { deleted: doc }
            });
        } catch (e) { console.warn('Audit log failed', e); }

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/admin/products/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
