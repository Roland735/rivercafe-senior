// app/api/canteen/orders/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, Order } from '@/models/allModels.js';
import { getServerSession } from 'next-auth/next';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

/**
 * Resolve session-like object from request (prefer getToken).
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

        const session = await getSessionLike(req);
        if (!session) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
        }

        // allow optional status filter or two modes (grouped or flat)
        const url = new URL(req.url);
        const statusFilter = url.searchParams.get('status'); // e.g. placed, preparing, ready
        const limit = Math.min(500, Math.max(20, parseInt(url.searchParams.get('limit') || '200', 10)));

        const baseQuery = {}; // can be extended (e.g. prepStation filter) later

        // If status provided, return flat list filtered by that status
        if (statusFilter) {
            const orders = await Order.find({ ...baseQuery, status: statusFilter })
                .sort({ createdAt: 1 })
                .limit(limit)
                .lean();

            const normalized = orders.map(o => ({
                id: o._id?.toString ? o._id.toString() : o._id,
                code: o.code,
                status: o.status,
                items: o.items || [],
                total: o.total,
                regNumber: o.regNumber || null,
                createdAt: o.createdAt,
                orderingWindow: o.orderingWindow || null,
                prepStation: o.prepStation || null,
                meta: o.meta || {},
            }));

            return NextResponse.json({ ok: true, orders: normalized }, { status: 200 });
        }

        // otherwise return grouped summary for canteen dashboard
        const placed = await Order.find({ ...baseQuery, status: 'placed' }).sort({ createdAt: 1 }).limit(limit).lean();
        const preparing = await Order.find({ ...baseQuery, status: 'preparing' }).sort({ createdAt: 1 }).limit(limit).lean();
        const ready = await Order.find({ ...baseQuery, status: 'ready' }).sort({ createdAt: 1 }).limit(limit).lean();

        const map = (arr) => arr.map(o => ({
            id: o._id?.toString ? o._id.toString() : o._id,
            code: o.code,
            status: o.status,
            items: o.items || [],
            total: o.total,
            regNumber: o.regNumber || null,
            createdAt: o.createdAt,
            orderingWindow: o.orderingWindow || null,
            prepStation: o.prepStation || null,
            meta: o.meta || {},
        }));

        return NextResponse.json({
            ok: true,
            groups: {
                placed: map(placed),
                preparing: map(preparing),
                ready: map(ready)
            },
            counts: {
                placed: placed.length,
                preparing: preparing.length,
                ready: ready.length
            }
        }, { status: 200 });
    } catch (err) {
        console.error('GET /api/canteen/orders error', err);
        return NextResponse.json({ ok: false, error: err.message || 'Server error' }, { status: 500 });
    }
}
