import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { AuditLog, connectToDatabase, SpecialProduct } from '@/models/allModels';

export async function GET(req, { params }) {
    try {
        await connectToDatabase();
        const { id } = params;
        if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });

        const product = await SpecialProduct.findById(id).lean();
        if (!product) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
        return NextResponse.json({ ok: true, product });
    } catch (err) {
        console.error('GET /api/admin/special-products/[id] error', err);
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

        const before = await SpecialProduct.findById(id).lean();
        if (!before) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        await SpecialProduct.updateOne({ _id: id }, { $set: updates });
        const after = await SpecialProduct.findById(id).lean();

        try {
            await AuditLog.create({
                actor: body._actor || null,
                action: 'special_menu_update',
                collectionName: 'specialproducts',
                documentId: id,
                changes: { before, after }
            });
        } catch (e) {
        }

        return NextResponse.json({ ok: true, product: after });
    } catch (err) {
        console.error('PUT /api/admin/special-products/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(req, { params }) {
    try {
        await connectToDatabase();
        const { id } = params;
        if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });

        const doc = await SpecialProduct.findByIdAndDelete(id);
        if (!doc) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        try {
            await AuditLog.create({
                actor: null,
                action: 'special_menu_delete',
                collectionName: 'specialproducts',
                documentId: id,
                changes: { deleted: doc }
            });
        } catch (e) {
        }

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/admin/special-products/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

