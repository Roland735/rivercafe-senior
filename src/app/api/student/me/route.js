// app/api/student/me/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, User } from '@/models/allModels.js';
// next-auth helpers
import { getServerSession } from 'next-auth/next';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

/**
 * Try several ways of obtaining the NextAuth session from a Route Handler request.
 * - Preferred: getToken({ req }) to read the JWT/cookie from the NextRequest.
 * - Fallback: getServerSession(req, undefined, authOptions) (works in some server contexts).
 */
async function getServerSessionFromRequest(req) {
    try {
        const secret = authOptions?.secret || process.env.NEXTAUTH_SECRET;
        console.log("NEXTAUTH_SECRET present?", !!secret);

        // Debug headers (do not print secrets)
        try {
            console.log("Request method/url:", req.method, req.url || "(no url)");
            console.log("Incoming cookie header present?", !!req.headers?.get("cookie"));
            console.log("Incoming Authorization header present?", !!req.headers?.get("authorization"));
        } catch (hdrErr) {
            console.warn("Could not read request headers:", hdrErr?.message || hdrErr);
        }

        const cookieName =
            process.env.NODE_ENV === "production"
                ? "__Secure-next-auth.session-token"
                : "next-auth.session-token";

        // Try to read token from the request (cookies / bearer). Works with NextRequest.
        try {
            const token = await getToken({
                req,
                secret,
                secureCookie: process.env.NODE_ENV === "production",
                cookieName,
            });

            if (token) {
                console.log("getToken -> token found. token.user present?", !!token.user);
                return { user: token.user || token };
            }

            console.log("getToken -> no token returned");
        } catch (getTokenErr) {
            console.warn("getToken threw:", getTokenErr?.message || getTokenErr);
        }

        // Final fallback: try getServerSession with authOptions (some environments allow this)
        try {
            const session = await getServerSession(req, undefined, authOptions);
            if (session) {
                console.log("getServerSession fallback -> session found");
                return session;
            }
            console.log("getServerSession fallback -> no session");
        } catch (gsErr) {
            console.warn("getServerSession fallback threw:", gsErr?.message || gsErr);
        }
    } catch (err) {
        console.warn("getServerSessionFromRequest unexpected error:", err?.message || err);
    }
    return null;
}

export async function GET(req) {
    try {
        await connectToDatabase();

        const session = await getServerSessionFromRequest(req);
        // session.user should contain the minimal object set in your NextAuth authorize/jwt callbacks
        let userIdOrReg = session?.user?.id || session?.user?.regNumber || null;

        // dev fallback: allow ?userId=... or ?regNumber=... (only for local testing)
        const url = new URL(req.url);
        const qUser = url.searchParams.get('userId') || url.searchParams.get('regNumber');
        if (!userIdOrReg && qUser) userIdOrReg = qUser;

        if (!userIdOrReg) {
            return NextResponse.json({ ok: false, error: 'Not authenticated (no user)' }, { status: 401 });
        }

        // resolve by objectId or regNumber
        let user;
        const isObjectId = /^[0-9a-fA-F]{24}$/.test(String(userIdOrReg));
        if (isObjectId) {
            user = await User.findById(userIdOrReg).lean();
        } else {
            user = await User.findOne({ regNumber: userIdOrReg }).lean();
        }

        if (!user) {
            return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
        }

        const profile = {
            id: user._id?.toString ? user._id.toString() : user._id,
            name: user.name,
            regNumber: user.regNumber || null,
            balance: typeof user.balance === 'number' ? user.balance : (user.balance || 0),
            favorites: user.favorites || []
        };

        return NextResponse.json({ ok: true, profile }, { status: 200 });
    } catch (err) {
        console.error('GET /api/student/me error', err);
        return NextResponse.json({ ok: false, error: err.message || 'Server error' }, { status: 500 });
    }
}
