// app/api/admin/settings/[key]/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, Setting, AuditLog } from '@/models/allModels';

/**
 * GET /api/admin/settings/[key]  -> returns setting
 * PUT /api/admin/settings/[key]  -> update setting { value, description?, editable? , actor? }
 * DELETE /api/admin/settings/[key] -> remove setting
 *
 * NOTE: Add session/role checks.
 */

export async function GET(req, { params }) {
    try {
        await connectToDatabase();
        const { key } = params;
        const doc = await Setting.findOne({ key }).lean();
        if (!doc) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
        return NextResponse.json({ ok: true, setting: { key: doc.key, value: doc.value, description: doc.description, editable: doc.editable } });
    } catch (err) {
        console.error('GET /api/admin/settings/[key] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function PUT(req, { params }) {
    try {
        await connectToDatabase();
        const { key } = params;
        const body = await req.json();
        const allow = {};
        if (typeof body.value !== 'undefined') allow.value = body.value;
        if (typeof body.description !== 'undefined') allow.description = body.description;
        if (typeof body.editable !== 'undefined') allow.editable = body.editable;

        const before = await Setting.findOne({ key }).lean();
        const doc = await Setting.findOneAndUpdate({ key }, { $set: allow }, { upsert: true, new: true }).lean();

        // Audit
        try {
            await AuditLog.create({
                actor: body.actor || null,
                action: 'setting_update',
                collectionName: 'settings',
                documentId: null,
                changes: { key, before, after: doc }
            });
        } catch (e) { console.warn('Audit log failed', e); }

        return NextResponse.json({ ok: true, setting: { key: doc.key, value: doc.value, description: doc.description, editable: doc.editable } });
    } catch (err) {
        console.error('PUT /api/admin/settings/[key] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(req, { params }) {
    try {
        await connectToDatabase();
        const { key } = params;
        const doc = await Setting.findOneAndDelete({ key }).lean();
        if (!doc) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        // Audit
        try {
            await AuditLog.create({
                actor: null,
                action: 'setting_delete',
                collectionName: 'settings',
                documentId: null,
                changes: { key, deleted: doc }
            });
        } catch (e) { console.warn('Audit log failed', e); }

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/admin/settings/[key] error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
