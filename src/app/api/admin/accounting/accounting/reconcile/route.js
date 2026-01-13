// app/api/admin/accounting/reconcile/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, Transaction, AuditLog } from '@/models/allModels';
import mongoose from 'mongoose';

/**
 * POST: /api/admin/accounting/reconcile
 * Body: { transactionIds: [id, ...], note: 'counted cash', actor: adminId? }
 *
 * This sets meta.reconciled = true and meta.reconciledAt / reconciledBy (if actor provided)
 * Also creates an AuditLog entry for the reconciliation action.
 */

export async function POST(req) {
    try {
        await connectToDatabase();
        const body = await req.json();
        const { transactionIds = [], note = '', actor = null } = body;

        if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
            return NextResponse.json({ ok: false, error: 'transactionIds required' }, { status: 400 });
        }

        // validate ids
        const validIds = transactionIds.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => mongoose.Types.ObjectId(id));
        if (!validIds.length) {
            return NextResponse.json({ ok: false, error: 'No valid transaction IDs' }, { status: 400 });
        }

        const now = new Date();

        const result = await Transaction.updateMany(
            { _id: { $in: validIds } },
            { $set: { 'meta.reconciled': true, 'meta.reconciledAt': now, 'meta.reconciledBy': actor, 'meta.reconciliationNote': note } }
        );

        // audit
        try {
            await AuditLog.create({
                actor: actor || null,
                action: 'accounting_reconcile',
                collectionName: 'transactions',
                documentId: null,
                changes: { reconciledCount: result.modifiedCount, transactionIds: validIds, note }
            });
        } catch (e) {
            console.warn('Audit log error (reconcile)', e);
        }

        return NextResponse.json({ ok: true, modifiedCount: result.modifiedCount });
    } catch (err) {
        console.error('POST /api/admin/accounting/reconcile error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
