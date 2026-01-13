// app/api/admin/accounting/transactions/route.js
import { NextResponse } from 'next/server';

import mongoose from 'mongoose';
import { connectToDatabase, Transaction, User } from '@/models/allModels';
;

/**
 * GET: /api/admin/accounting/transactions
 * Query params:
 *  - user (regNumber or userId)
 *  - type (topup, order, refund, adjustment, reconciliation)
 *  - from (ISO date)
 *  - to (ISO date)
 *  - limit (default 50)
 *  - skip
 *
 * Returns { ok: true, total, transactions: [...] }
 *
 * NOTE: Add session/role check to restrict to admin/accounting users.
 */

export async function GET(req) {
    try {
        await connectToDatabase();

        const url = new URL(req.url);
        const qUser = url.searchParams.get('user');
        const type = url.searchParams.get('type');
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const limit = Math.min(200, Number(url.searchParams.get('limit') || 50));
        const skip = Number(url.searchParams.get('skip') || 0);

        const filter = {};

        if (type) filter.type = type;

        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = new Date(from);
            if (to) filter.createdAt.$lte = new Date(to);
        }

        // If user is provided: try ID first, then regNumber
        if (qUser) {
            if (mongoose.Types.ObjectId.isValid(qUser)) {
                filter.user = mongoose.Types.ObjectId(qUser);
            } else {
                // find user by regNumber or name
                const u = await User.findOne({ $or: [{ regNumber: qUser }, { name: new RegExp(`^${qUser}$`, 'i') }] }).lean();
                if (u) filter.user = u._id;
                else {
                    // no user found — return empty set
                    return NextResponse.json({ ok: true, total: 0, transactions: [] });
                }
            }
        }

        // count total
        const total = await Transaction.countDocuments(filter);

        // query with pagination and populate user basic fields
        const docs = await Transaction.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('user', 'name regNumber')
            .lean();

        // normalize output: show user as small object
        const transactions = docs.map(d => ({
            _id: d._id,
            user: d.user ? { id: d.user._id, name: d.user.name, regNumber: d.user.regNumber } : null,
            type: d.type,
            amount: d.amount,
            balanceBefore: d.balanceBefore,
            balanceAfter: d.balanceAfter,
            relatedOrder: d.relatedOrder || null,
            note: d.note || '',
            meta: d.meta || {},
            createdAt: d.createdAt
        }));

        return NextResponse.json({ ok: true, total, transactions });
    } catch (err) {
        console.error('GET /api/admin/accounting/transactions error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
