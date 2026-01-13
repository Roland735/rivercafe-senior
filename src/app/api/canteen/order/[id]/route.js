// app/api/canteen/order/[id]/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, Order, AuditLog } from '@/models/allModels.js';
import { getServerSession } from 'next-auth/next';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import mongoose from 'mongoose';

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


export async function PATCH(req, { params }) {
    try {
        await connectToDatabase();

        const session = await getSessionLike(req);
        if (!session) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

        const userId = session?.user?.id || null;

        const id = params?.id;
        if (!id || !/^[0-9a-fA-F]{24}$/.test(String(id))) {
            return NextResponse.json({ ok: false, error: 'Invalid order id' }, { status: 400 });
        }

        const body = await req.json().catch(() => ({}));
        const action = (body.action || '').toString();

        // Actions:
        //  - incPrepared / decPrepared : increments meta.preparedCount by ±1
        //  - setStatus: { status: 'preparing'|'ready'|'collected' } — set status; optionally set prepBy or collectedByRegNumber.
        //  - setPrepBy: sets prepBy to current user id
        //  - setCollectedBy: sets collectedByRegNumber
        // We'll perform small validations and return updated doc.

        let update = {};
        let options = { new: true };

        if (action === 'incPrepared') {
            update = { $inc: { 'meta.preparedCount': 1 } };
        } else if (action === 'decPrepared') {
            update = { $inc: { 'meta.preparedCount': -1 } };
        } else if (action === 'setPrepBy') {
            if (!userId) return NextResponse.json({ ok: false, error: 'No user in session to set as prepBy' }, { status: 400 });
            update = { $set: { prepBy: mongoose.Types.ObjectId(userId) } };
        } else if (action === 'setCollectedBy') {
            const collectedByRegNumber = body.collectedByRegNumber || null;
            if (!collectedByRegNumber) return NextResponse.json({ ok: false, error: 'collectedByRegNumber required' }, { status: 400 });
            update = { $set: { collectedByRegNumber } };
        } else if (action === 'setStatus') {
            const s = (body.status || '').toString();
            if (!['preparing', 'ready', 'collected', 'cancelled', 'placed'].includes(s)) {
                return NextResponse.json({ ok: false, error: 'Invalid status value' }, { status: 400 });
            }
            update = { $set: { status: s } };

            // convenience: if moving to preparing set prepBy
            if (s === 'preparing' && userId) {
                update.$set = { ...update.$set, prepBy: mongoose.Types.ObjectId(userId) };
            }

            // if moving to collected and a collectedByRegNumber provided, set it
            if (s === 'collected' && body.collectedByRegNumber) {
                update.$set = { ...update.$set, collectedByRegNumber: body.collectedByRegNumber };
            }
        } else {
            return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
        }

        // ensure preparedCount never below 0
        if (update.$inc && update.$inc['meta.preparedCount'] < 0) {
            // use aggregation/conditional update — simple approach: fetch first and then apply clamp
            const existing = await Order.findById(id).lean();
            const current = (existing?.meta && existing.meta.preparedCount) ? Number(existing.meta.preparedCount) : 0;
            const newVal = Math.max(0, current + update.$inc['meta.preparedCount']);
            update = { $set: { 'meta.preparedCount': newVal } };
        }

        const updated = await Order.findByIdAndUpdate(id, update, { ...options }).lean();
        if (!updated) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 });

        // write an AuditLog entry (best-effort)
        try {
            await AuditLog.create({
                actor: userId || null,
                action: `canteen_${action}`,
                collectionName: 'orders',
                documentId: updated._id,
                changes: { action, payload: body, updatedFields: update },
            });
        } catch (e) {
            console.warn('Failed to write audit log for canteen action', e?.message || e);
        }

        // normalize and return
        const out = {
            id: updated._id?.toString ? updated._id.toString() : updated._id,
            code: updated.code,
            status: updated.status,
            items: updated.items,
            total: updated.total,
            meta: updated.meta || {},
            prepBy: updated.prepBy || null,
            collectedByRegNumber: updated.collectedByRegNumber || null,
            createdAt: updated.createdAt
        };

        return NextResponse.json({ ok: true, order: out }, { status: 200 });
    } catch (err) {
        console.error('PATCH /api/canteen/order/[id] error', err);
        return NextResponse.json({ ok: false, error: err.message || 'Server error' }, { status: 500 });
    }
}
