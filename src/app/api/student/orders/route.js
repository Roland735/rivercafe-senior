// app/api/student/orders/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, Order } from '@/models/allModels.js';
import { getServerSession } from 'next-auth/next';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

/**
 * GET /api/student/orders
 * Query: ?limit=50 or ?regNumber=... (dev)
 * Returns recent orders for the authenticated student.
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
        const url = new URL(req.url);
        const devReg = url.searchParams.get('regNumber') || null;
        const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10) || 50);

        let userIdOrReg = session?.user?.id || session?.user?.regNumber || devReg || null;
        if (!userIdOrReg) {
            return NextResponse.json({ ok: false, error: 'Not authenticated (no user)' }, { status: 401 });
        }

        const isObjectId = /^[0-9a-fA-F]{24}$/.test(String(userIdOrReg));
        const query = isObjectId ? { user: userIdOrReg } : { regNumber: userIdOrReg };

        const orders = await Order.find(query)
            .select('code status total items createdAt orderingWindow prepStation external')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return NextResponse.json({ ok: true, orders }, { status: 200 });
    } catch (err) {
        console.error('GET /api/student/orders error', err);
        return NextResponse.json({ ok: false, error: err.message || 'Server error' }, { status: 500 });
    }
}
