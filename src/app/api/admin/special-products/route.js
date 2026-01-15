import { NextResponse } from 'next/server';
import { connectToDatabase, SpecialProduct, SpecialOrderingWindow, AuditLog } from '../../../../models/allModels.js';

export async function GET(req) {
    try {
        await connectToDatabase();

        const url = new URL(req.url);
        const search = url.searchParams.get('search') || '';
        const category = url.searchParams.get('category') || null;
        const available = url.searchParams.get('available');

        const q = {};
        if (search) {
            q.$or = [
                { name: new RegExp(search, 'i') },
                { category: new RegExp(search, 'i') },
                { sku: new RegExp(search, 'i') }
            ];
        }
        if (category) q.category = category;
        if (available === 'true') q.available = true;
        if (available === 'false') q.available = false;

        const products = await SpecialProduct.find(q).sort({ category: 1, name: 1 }).lean();
        return NextResponse.json({ ok: true, products });
    } catch (err) {
        console.error('GET /api/admin/special-products error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        await connectToDatabase();
        const body = await req.json();

        if (!body.name || typeof body.price !== 'number' || !body.category) {
            return NextResponse.json({ ok: false, error: 'Missing required fields: name, category, price (number)' }, { status: 400 });
        }

        const doc = await SpecialProduct.create({
            name: body.name,
            sku: body.sku || null,
            category: body.category,
            price: body.price,
            available: typeof body.available === 'boolean' ? body.available : true,
            availablePeriods: body.availablePeriods || [],
            prepTimeMinutes: body.prepTimeMinutes || 5,
            prepStation: body.prepStation || null,
            imageUrl: body.imageUrl || '',
            tags: Array.isArray(body.tags) ? body.tags : [],
            allergens: Array.isArray(body.allergens) ? body.allergens : [],
            notes: body.notes || '',
            metadata: body.metadata || {}
        });

        try {
            await SpecialOrderingWindow.findOneAndUpdate(
                { category: String(doc.category).trim() },
                {
                    $setOnInsert: {
                        category: String(doc.category).trim(),
                        name: `${String(doc.category).trim()} (Special)`,
                        daysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                        startTime: '00:00',
                        endTime: '23:59',
                        active: true,
                        priority: 0,
                        timezone: 'Africa/Harare',
                        description: ''
                    }
                },
                { upsert: true, new: true }
            );
        } catch (e) {
        }

        try {
            await AuditLog.create({
                actor: body._actor || null,
                action: 'special_menu_create',
                collectionName: 'specialproducts',
                documentId: doc._id,
                changes: { created: doc.toObject ? doc.toObject() : doc }
            });
        } catch (e) {
        }

        return NextResponse.json({ ok: true, product: doc });
    } catch (err) {
        console.error('POST /api/admin/special-products error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

