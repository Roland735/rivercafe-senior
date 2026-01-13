// app/api/canteen/process/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { connectToDatabase, Order, ExternalCode, AuditLog, User } from "@/models/allModels.js";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

/**
 * Helper to obtain a session-like object using next-auth jwt helper (works server-side)
 */
async function getSessionLike(req) {
    try {
        const secret = authOptions?.secret || process.env.NEXTAUTH_SECRET;
        const cookieName = process.env.NODE_ENV === "production"
            ? "__Secure-next-auth.session-token"
            : "next-auth.session-token";

        const token = await getToken({
            req,
            secret,
            secureCookie: process.env.NODE_ENV === "production",
            cookieName,
        }).catch(() => null);

        if (!token) return null;
        return { user: token.user || token };
    } catch (err) {
        console.warn("getSessionLike error:", err?.message || err);
        return null;
    }
}

/**
 * GET
 * - If query `code=RC-...` is provided -> return single order (existing behaviour).
 * - Else:
 *    - If `date=YYYY-MM-DD` provided -> return orders for that date (preparing|ready).
 *    - If no date provided -> return all uncollected orders (preparing|ready) regardless of date.
 *    - If `q` provided -> filter by student name (searches user.name, regNumber, meta.issuedToName).
 */
export async function GET(req) {
    try {
        await connectToDatabase();
        const session = await getSessionLike(req);
        if (!session) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

        const url = new URL(req.url);
        const code = (url.searchParams.get("code") || "").trim();
        const dateParam = (url.searchParams.get("date") || "").trim();
        const q = (url.searchParams.get("q") || "").trim();

        // Single-order lookup by code (existing)
        if (code) {
            const order = await Order.findOne({ code }).populate({ path: "user", select: "name regNumber" }).lean();
            if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

            if (order.expiresAt && new Date() > new Date(order.expiresAt)) {
                return NextResponse.json({ ok: false, error: "Order pickup code expired" }, { status: 410 });
            }

            let issuedToName = order.meta?.issuedToName || null;
            if (order.external) {
                try {
                    const ext = await ExternalCode.findOne({ $or: [{ order: order._id }, { code: order.code }] }).lean();
                    if (ext && ext.issuedToName) issuedToName = ext.issuedToName;
                } catch (e) { /* ignore */ }
            }

            // attempt to find student name:
            let studentName = null;
            if (order.user && order.user.name) studentName = order.user.name;
            else if (order.regNumber) {
                const u = await User.findOne({ regNumber: order.regNumber }).select("name").lean();
                if (u && u.name) studentName = u.name;
            }
            studentName = studentName || (order.external ? issuedToName : null);

            const safe = {
                id: order._id?.toString ? order._id.toString() : order._id,
                code: order.code,
                status: order.status,
                items: order.items || [],
                total: order.total,
                regNumber: order.regNumber || null,
                external: !!order.external,
                issuedToName,
                studentName,
                expiresAt: order.expiresAt || null,
                createdAt: order.createdAt,
                collectedAt: order.collectedAt || null
            };

            return NextResponse.json({ ok: true, order: safe }, { status: 200 });
        }

        // Build query for list
        const dayStart = dateParam ? new Date(dateParam + "T00:00:00") : null;
        const dayEnd = dateParam ? new Date(dateParam + "T23:59:59.999") : null;

        // statuses that can be collected (i.e. uncollected)
        const allowedStatuses = ["preparing", "ready"];

        const baseQuery = {
            status: { $in: allowedStatuses },
        };

        if (dateParam) {
            baseQuery.createdAt = { $gte: dayStart, $lte: dayEnd };
        } // else: no createdAt restriction -> return all uncollected

        // If q present, resolve matching users and regNumbers to narrow query
        let userIdsForQ = null;
        let regNumbersForQ = null;
        if (q) {
            // find users whose name matches q (case-insensitive substring)
            const users = await User.find({ name: { $regex: q, $options: "i" } }).select("_id regNumber").lean();
            userIdsForQ = users.map(u => u._id).filter(Boolean);
            regNumbersForQ = users.map(u => u.regNumber).filter(Boolean);

            // We'll also search meta.issuedToName via regex in the Order query.
            const orClauses = [];

            if (userIdsForQ.length) orClauses.push({ user: { $in: userIdsForQ } });
            if (regNumbersForQ.length) orClauses.push({ regNumber: { $in: regNumbersForQ } });
            orClauses.push({ "meta.issuedToName": { $regex: q, $options: "i" } });

            // combine
            if (orClauses.length) baseQuery.$or = orClauses;
        }

        // fetch orders; populate user name/regNumber for mapping
        const orders = await Order.find(baseQuery)
            .sort({ createdAt: 1 })
            .populate({ path: "user", select: "name regNumber" })
            .select("code status items total regNumber external meta expiresAt createdAt collectedAt user")
            .lean();

        // gather regNumbers that have no populated user so we can map names in one query
        const missingRegNums = new Set();
        for (const ord of orders) {
            if (!ord.user && ord.regNumber) missingRegNums.add(ord.regNumber);
        }
        const missingRegArray = Array.from(missingRegNums);
        let regNumberNameMap = {};
        if (missingRegArray.length) {
            const usersByReg = await User.find({ regNumber: { $in: missingRegArray } }).select("regNumber name").lean();
            regNumberNameMap = Object.fromEntries(usersByReg.map(u => [u.regNumber, u.name]));
        }

        // build safe list
        const safeList = [];
        for (const ord of orders) {
            // skip expired pickup codes
            if (ord.expiresAt && new Date() > new Date(ord.expiresAt)) continue;

            // external name resolution
            let issuedToName = ord.meta?.issuedToName || null;
            if (ord.external) {
                try {
                    const ext = await ExternalCode.findOne({ $or: [{ order: ord._id }, { code: ord.code }] }).lean();
                    if (ext && ext.issuedToName) issuedToName = ext.issuedToName;
                } catch (e) { /* ignore */ }
            }

            // student name preference: populated user.name -> lookup by regNumber -> meta issuedToName (external)
            let studentName = null;
            if (ord.user && ord.user.name) studentName = ord.user.name;
            else if (ord.regNumber && regNumberNameMap[ord.regNumber]) studentName = regNumberNameMap[ord.regNumber];
            else studentName = ord.external ? issuedToName : null;

            safeList.push({
                id: ord._id?.toString ? ord._id.toString() : ord._id,
                code: ord.code,
                status: ord.status,
                items: ord.items || [],
                total: ord.total,
                regNumber: ord.regNumber || null,
                external: !!ord.external,
                issuedToName,
                studentName,
                expiresAt: ord.expiresAt || null,
                createdAt: ord.createdAt,
                collectedAt: ord.collectedAt || null
            });
        }

        return NextResponse.json({ ok: true, date: dateParam || null, q: q || null, count: safeList.length, orders: safeList }, { status: 200 });
    } catch (err) {
        console.error("GET /api/canteen/process error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}

/**
 * POST
 * Accepts:
 *  - { orderId }  -> mark by id (preferred for the new UI)
 *  - or fallback to old behaviour: { code, regNumber }
 *
 * Will mark order.status = "collected", set collectedAt, collectedByRegNumber (if available),
 * and mark ExternalCode used when necessary. Writes an AuditLog.
 */
export async function POST(req) {
    try {
        await connectToDatabase();
        const session = await getSessionLike(req);
        if (!session || !session.user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

        const body = await req.json().catch(() => ({}));
        const { orderId, code, regNumber } = body || {};

        // prefer orderId path
        let order = null;
        if (orderId) {
            order = await Order.findById(orderId);
            if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
        } else {
            if (!code) return NextResponse.json({ ok: false, error: "Missing order code" }, { status: 400 });
            order = await Order.findOne({ code });
            if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
        }

        // expiry
        if (order.expiresAt && new Date() > new Date(order.expiresAt)) {
            return NextResponse.json({ ok: false, error: "Order pickup code expired" }, { status: 410 });
        }

        // only allow collecting when order is 'ready' or 'preparing'
        if (order.status !== "ready" && order.status !== "preparing") {
            return NextResponse.json({ ok: false, error: `Order cannot be collected in status: ${order.status}` }, { status: 409 });
        }

        // mark collected
        order.status = "collected";
        if (regNumber) order.collectedByRegNumber = regNumber;
        const actorId = session.user.id || session.user.sub || null;
        order.collectedAt = order.collectedAt || new Date();
        order.collectedByOperator = actorId;
        await order.save();

        // If external, mark ExternalCode used if present
        let issuedToName = null;
        if (order.external) {
            try {
                const ext = await ExternalCode.findOne({ $or: [{ order: order._id }, { code: order.code }] });
                if (ext) {
                    issuedToName = ext.issuedToName || null;
                    if (!ext.used) {
                        ext.used = true;
                        ext.usedAt = new Date();
                        ext.usedByRegNumber = regNumber || null;
                        await ext.save().catch((e) => console.warn("Failed to mark ExternalCode used:", e?.message || e));
                    } else {
                        issuedToName = issuedToName || ext.issuedToName || null;
                    }
                } else {
                    issuedToName = order.meta?.issuedToName || null;
                }
            } catch (e) {
                console.warn("ExternalCode handling error:", e?.message || e);
            }
        }

        // audit log (best-effort)
        try {
            await AuditLog.create({
                actor: actorId,
                action: "collect_order",
                collectionName: "orders",
                documentId: order._id,
                changes: { status: "collected", collectedByRegNumber: regNumber || null },
                meta: { fromIp: req.headers.get("x-forwarded-for") || null },
            });
        } catch (e) {
            console.warn("Failed to write audit log:", e?.message || e);
        }

        return NextResponse.json({
            ok: true,
            message: "Order marked collected",
            orderId: order._id,
            collectedAt: order.collectedAt,
            issuedToName,
        }, { status: 200 });
    } catch (err) {
        console.error("POST /api/canteen/process error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}
