// app/api/admin/accounting/export/route.js

import { connectToDatabase, Transaction, User } from '@/models/allModels';
import mongoose from 'mongoose';

/**
 * GET: /api/admin/accounting/export
 * Query params same as /transactions
 * Returns CSV text with Content-Type: text/csv and Content-Disposition attachment
 */

function escapeCsv(value = '') {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

export async function GET(req) {
    try {
        await connectToDatabase();
        const url = new URL(req.url);
        const qUser = url.searchParams.get('user');
        const type = url.searchParams.get('type');
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');

        const filter = {};
        if (type) filter.type = type;
        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = new Date(from);
            if (to) filter.createdAt.$lte = new Date(to);
        }

        if (qUser) {
            if (mongoose.Types.ObjectId.isValid(qUser)) {
                filter.user = mongoose.Types.ObjectId(qUser);
            } else {
                const u = await User.findOne({ $or: [{ regNumber: qUser }, { name: new RegExp(`^${qUser}$`, 'i') }] }).lean();
                if (u) filter.user = u._id;
                else {
                    // return empty CSV with header
                    const header = 'createdAt,userReg,userName,type,amount,before,after,note,meta\n';
                    return new Response(header, {
                        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="transactions.csv"' }
                    });
                }
            }
        }

        // retrieve up to 5000 rows (safety cap)
        const docs = await Transaction.find(filter)
            .sort({ createdAt: -1 })
            .limit(5000)
            .populate('user', 'name regNumber')
            .lean();

        // CSV header
        const header = ['createdAt', 'userReg', 'userName', 'type', 'amount', 'balanceBefore', 'balanceAfter', 'note', 'meta'];
        const rows = [header.join(',')];

        for (const d of docs) {
            const createdAt = d.createdAt ? new Date(d.createdAt).toISOString() : '';
            const userReg = d.user?.regNumber ?? '';
            const userName = d.user?.name ?? '';
            const type = d.type ?? '';
            const amount = d.amount ?? '';
            const before = d.balanceBefore ?? '';
            const after = d.balanceAfter ?? '';
            const note = d.note ?? '';
            const meta = d.meta ? JSON.stringify(d.meta) : '';

            const line = [
                escapeCsv(createdAt),
                escapeCsv(userReg),
                escapeCsv(userName),
                escapeCsv(type),
                escapeCsv(amount),
                escapeCsv(before),
                escapeCsv(after),
                escapeCsv(note),
                escapeCsv(meta)
            ].join(',');

            rows.push(line);
        }

        const csv = rows.join('\n');
        return new Response(csv, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="transactions_${Date.now()}.csv"`
            }
        });
    } catch (err) {
        console.error('GET /api/admin/accounting/export error', err);
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
