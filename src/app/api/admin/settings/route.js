// app/api/admin/settings/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, Setting } from '../../../../models/allModels.js';

/**
 * GET  -> list all settings as { key, value, description, editable }
 * POST -> bulk upsert settings: body { settings: [ { key, value, description?, editable? }, ... ] }
 *
 * NOTE: Add session/role checks (admin/accounting) in production.
 */

export async function GET() {
    try {
        await connectToDatabase();
        const docs = await Setting.find().lean();
        const settings = docs.map(d => ({ key: d.key, value: d.value, description: d.description, editable: d.editable }));
        return NextResponse.json({ ok: true, settings });
    } catch (err) {
        console.error('GET /api/admin/settings error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        await connectToDatabase();
        const body = await req.json();
        const items = Array.isArray(body.settings) ? body.settings : [];

        if (!items.length) {
            return NextResponse.json({ ok: false, error: 'No settings provided' }, { status: 400 });
        }

        const results = [];
        for (const it of items) {
            if (!it.key) {
                results.push({ key: null, ok: false, error: 'Missing key' });
                continue;
            }
            // upsert
            const doc = await Setting.findOneAndUpdate(
                { key: it.key },
                { $set: { value: it.value, description: it.description || '', editable: typeof it.editable === 'boolean' ? it.editable : true } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ).lean();
            results.push({ key: it.key, ok: true, setting: { key: doc.key, value: doc.value } });
        }

        return NextResponse.json({ ok: true, results });
    } catch (err) {
        console.error('POST /api/admin/settings error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
