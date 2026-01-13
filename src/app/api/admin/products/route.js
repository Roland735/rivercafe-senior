// app/api/admin/products/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, Product, AuditLog } from '../../../../models/allModels.js';

/**
 * GET: list products (query params: search, category, available)
 * POST: create product (body: product fields)
 *
 * NOTE: Add auth/role-checks here (NextAuth/session) to restrict to admin/it roles.
 */

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

        const products = await Product.find(q).sort({ name: 1 }).lean();
        return NextResponse.json({ ok: true, products });
    } catch (err) {
        console.error('GET /api/admin/products error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        await connectToDatabase();
        const body = await req.json();

        // basic validation
        if (!body.name || typeof body.price !== 'number') {
            return NextResponse.json({ ok: false, error: 'Missing required fields: name, price (number)' }, { status: 400 });
        }

        const doc = await Product.create({
            name: body.name,
            sku: body.sku || null,
            category: body.category || 'General',
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

        // Audit log (actor should be set to admin user id — integrate session to populate).
        try {
            await AuditLog.create({
                actor: body._actor || null,
                action: 'menu_create',
                collectionName: 'products',
                documentId: doc._id,
                changes: { created: doc.toObject ? doc.toObject() : doc }
            });
        } catch (e) {
            console.warn('Audit log failed', e);
        }

        return NextResponse.json({ ok: true, product: doc });
    } catch (err) {
        console.error('POST /api/admin/products error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
