// app/api/student/statement/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, Transaction, User, Order } from '@/models/allModels.js';
import { getServerSession } from 'next-auth/next';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

/**
 * Resolve session-like object from request (prefer getToken in route handlers).
 */
async function getSessionLike(req) {
    try {
        const secret = authOptions?.secret || process.env.NEXTAUTH_SECRET;
        console.log("NEXTAUTH_SECRET present?", !!secret);

        // Debug headers (do not print secrets)
        try {
            console.log("Request method/url:", req.method, req.url || "(no url)");
            console.log("Incoming cookie header:", req.headers?.get("cookie"));
            console.log("Incoming Authorization header present?", !!req.headers?.get("authorization"));
        } catch (hdrErr) {
            console.warn("Could not read request headers:", hdrErr?.message || hdrErr);
        }

        const cookieName =
            process.env.NODE_ENV === "production"
                ? "__Secure-next-auth.session-token"
                : "next-auth.session-token";

        // Ask getToken to consider secure cookie names in production and use explicit cookieName
        const token = await getToken({
            req,
            secret,
            secureCookie: process.env.NODE_ENV === "production",
            cookieName,
        }).catch((e) => {
            console.warn("getToken threw:", e?.message || e);
            return null;
        });

        if (token) {
            console.log("getToken -> token found. token.user present?", !!token.user);
            if (token.user) {
                console.log("token.user summary:", {
                    id: token.user.id || token.user.sub,
                    email: token.user.email,
                    role: token.user.role,
                });
            } else {
                console.log("token summary (no user field):", { sub: token.sub, name: token.name, email: token.email });
            }
            return { user: token.user || token };
        }

        console.log("getToken -> no token returned");
    } catch (err) {
        console.warn("getSessionLike unexpected error:", err?.message || err);
    }
    return null;
}

export async function GET(req) {
    try {
        await connectToDatabase();

        // Server-side diagnostic (logs only)
        try {
            console.debug('[/api/student/statement] cookie header present?', !!(typeof req?.headers?.get === 'function' && req.headers.get('cookie')));
        } catch (e) { }

        const session = await getSessionLike(req);
        const url = new URL(req.url);
        const devReg = url.searchParams.get('regNumber') || null;
        const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10)));
        const since = url.searchParams.get('since') || null; // optional ISO date

        let userIdOrReg = session?.user?.id || session?.user?.regNumber || devReg || null;
        if (!userIdOrReg) {
            return NextResponse.json({ ok: false, error: 'Not authenticated (no user)' }, { status: 401 });
        }

        // Resolve to ObjectId when possible; Transaction.user stores ObjectId.
        let userObjectId = null;
        if (/^[0-9a-fA-F]{24}$/.test(String(userIdOrReg))) {
            userObjectId = userIdOrReg;
        } else {
            // try find user by regNumber
            const u = await User.findOne({ regNumber: userIdOrReg }).lean();
            if (!u) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
            userObjectId = u._id;
        }

        const query = { user: userObjectId };
        if (since) {
            const d = new Date(since);
            if (!isNaN(d.getTime())) query.createdAt = { $gte: d };
        }

        // fetch transactions and attach minimal order info
        const txs = await Transaction.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate({ path: 'relatedOrder', select: 'code status total' })
            .lean();

        // compute running balances optionally and normalize
        const txsOut = txs.map(t => ({
            id: t._id?.toString ? t._id.toString() : t._id,
            type: t.type,
            amount: t.amount,
            balanceBefore: t.balanceBefore,
            balanceAfter: t.balanceAfter,
            relatedOrder: t.relatedOrder ? { id: t.relatedOrder._id?.toString ? t.relatedOrder._id.toString() : t.relatedOrder._id, code: t.relatedOrder.code, status: t.relatedOrder.status, total: t.relatedOrder.total } : null,
            note: t.note || '',
            createdAt: t.createdAt
        }));

        // Optionally return a small summary: current balance (from last transaction) and totals
        const currentBalance = txsOut.length ? txsOut[0].balanceAfter : null;
        const totals = txsOut.reduce((acc, t) => {
            acc.count += 1;
            acc.net += Number(t.amount || 0);
            if (t.type === 'topup') acc.topup += Number(t.amount || 0);
            if (t.type === 'order') acc.orders += Number(t.amount || 0);
            return acc;
        }, { count: 0, net: 0, topup: 0, orders: 0 });

        return NextResponse.json({ ok: true, transactions: txsOut, summary: { currentBalance, totals } }, { status: 200 });
    } catch (err) {
        console.error('GET /api/student/statement error', err);
        return NextResponse.json({ ok: false, error: err.message || 'Server error' }, { status: 500 });
    }
}
