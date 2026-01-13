// app/api/admin/products/import/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, Product, AuditLog } from '@/models/allModels';

/**
 * Accepts:
 *  - JSON body: { products: [ { name, price, ... }, ... ] }
 *  - Or plain text CSV body (first line headers: name,sku,category,price,available,prepTimeMinutes,imageUrl,tags)
 *
 * Returns an import report with created / failed rows.
 */

function parseCSV(csvText) {
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
        const parts = line.split(',').map(p => p.trim());
        const obj = {};
        headers.forEach((h, i) => { obj[h] = parts[i] ?? ''; });
        return obj;
    });
    return rows;
}

export async function POST(req) {
    try {
        await connectToDatabase();

        const contentType = (req.headers.get('content-type') || '').toLowerCase();

        let payloadProducts = [];

        if (contentType.includes('application/json')) {
            const body = await req.json();
            payloadProducts = Array.isArray(body.products) ? body.products : (Array.isArray(body) ? body : (body?.products || []));
        } else {
            // treat as text (CSV)
            const bodyText = await req.text();
            payloadProducts = parseCSV(bodyText);
        }

        if (!payloadProducts || !payloadProducts.length) {
            return NextResponse.json({ ok: false, error: 'No products provided' }, { status: 400 });
        }

        const created = [];
        const failed = [];

        for (const row of payloadProducts) {
            try {
                // normalize some fields
                const price = Number(row.price || row.priceValue || 0);
                if (!row.name || isNaN(price)) throw new Error('Missing name or invalid price');

                const doc = await Product.create({
                    name: row.name,
                    sku: row.sku || null,
                    category: row.category || 'General',
                    price,
                    available: (String(row.available || 'true').toLowerCase() === 'true'),
                    prepTimeMinutes: Number(row.prepTimeMinutes || row.prepTime || 5),
                    imageUrl: row.imageUrl || '',
                    tags: row.tags ? String(row.tags).split('|').map(s => s.trim()).filter(Boolean) : [],
                    allergens: row.allergens ? String(row.allergens).split('|').map(s => s.trim()).filter(Boolean) : [],
                    notes: row.notes || ''
                });

                created.push(doc);
            } catch (err) {
                failed.push({ row, error: err.message });
            }
        }

        // Audit log for bulk import
        try {
            await AuditLog.create({
                actor: null,
                action: 'menu_bulk_import',
                collectionName: 'products',
                documentId: null,
                changes: { importedCount: created.length, failedCount: failed.length }
            });
        } catch (e) { /* ignore */ }

        return NextResponse.json({ ok: true, created: created.length, failed });
    } catch (err) {
        console.error('POST /api/admin/products/import error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
