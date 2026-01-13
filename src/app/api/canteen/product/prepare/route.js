import { NextResponse } from "next/server";
import { connectToDatabase, Order } from "@/models/allModels.js";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

/**
 * Resolve a session-like object from request robustly.
 */
async function resolveSession(req) {
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

function escapeRegExp(s = "") {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function POST(req) {
    try {
        const session = await resolveSession(req);
        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
        }

        // Authorize roles
        const role = session.user?.role;
        if (role && !["canteen", "admin", "it"].includes(role)) {
            return NextResponse.json({ ok: false, error: "Forbidden (insufficient role)" }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const productName = (body.productName || "").trim();
        console.log(productName);

        const action = (body.action || "prepare").trim().toLowerCase();

        if (!productName) {
            return NextResponse.json({ ok: false, error: "Missing productName" }, { status: 400 });
        }
        if (!["prepare", "unprepare"].includes(action)) {
            return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
        }

        await connectToDatabase();

        // Helpers
        const computeTotalQty = (order) => {
            if (!order || !Array.isArray(order.items)) return 0;
            return order.items.reduce((s, it) => s + (Number(it.qty || 0)), 0);
        };

        // Find candidate orders containing the product (oldest-first for prepare, newest-first for unprepare)
        const regex = new RegExp(`^${escapeRegExp(productName)}$`, "i");

        console.log(regex);

        if (action === "prepare") {
            const candidateOrders = await Order.find({
                status: { $in: ["placed", "preparing"] },
                "items.name": { $regex: regex },
            })
                .sort({ createdAt: 1 })
                .limit(200)
                .lean();

            console.log(candidateOrders);

            for (const oRaw of candidateOrders) {
                // load the full document for update
                const orderDoc = await Order.findById(oRaw._id);
                if (!orderDoc) continue;

                const totalQty = computeTotalQty(orderDoc);
                // Ensure items array exists
                orderDoc.items = orderDoc.items || [];

                // find the matching item(s) and pick the first with available unprepared qty
                const itemIndex = orderDoc.items.findIndex(
                    (it) => String(it.name || "").toLowerCase() === productName.toLowerCase()
                );
                if (itemIndex === -1) continue;

                const item = orderDoc.items[itemIndex];
                const itemQty = Number(item.qty || 0);
                const itemPrepared = Math.max(0, Number(item.preparedCount || item.prepared || 0));

                if (itemPrepared >= itemQty) {
                    // this specific item already fully prepared; continue searching
                    continue;
                }

                // Also ensure overall prepared < totalQty (safety)
                const overallPrepared = Number(orderDoc.meta?.preparedCount || 0);
                if (overallPrepared >= totalQty) {
                    continue;
                }

                // increment item.preparedCount by 1 (init to 0 if absent)
                orderDoc.items[itemIndex].preparedCount = itemPrepared + 1;

                // recalc overall preparedCount as sum of item preparedCount
                const newOverallPrepared = orderDoc.items.reduce((s, it) => s + (Number(it.preparedCount || it.prepared || 0)), 0);
                orderDoc.meta = orderDoc.meta || {};
                orderDoc.meta.preparedCount = newOverallPrepared;

                // update status
                if (newOverallPrepared >= totalQty) {
                    orderDoc.status = "ready";
                } else if (newOverallPrepared > 0) {
                    orderDoc.status = "preparing";
                } else {
                    orderDoc.status = "placed";
                }

                await orderDoc.save();

                return NextResponse.json({
                    ok: true,
                    order: {
                        id: orderDoc._id.toString(),
                        status: orderDoc.status,
                        preparedCount: orderDoc.meta.preparedCount,
                        // return items minimal info so client can trust item-level prepared counts if it wants
                        items: orderDoc.items.map(it => ({ name: it.name, qty: it.qty, preparedCount: Number(it.preparedCount || it.prepared || 0) })),
                    },
                }, { status: 200 });
            }

            return NextResponse.json({ ok: false, error: "No matching order with unprepared units for this product" }, { status: 404 });
        }

        // UNPREPARE
        if (action === "unprepare") {
            // prefer most recent so we undo latest preparations
            const candidateOrders = await Order.find({
                status: { $in: ["ready", "preparing", "placed"] },
                "items.name": { $regex: regex },
                "meta.preparedCount": { $gt: 0 },
            })
                .sort({ createdAt: -1 })
                .limit(200)
                .lean();

            for (const oRaw of candidateOrders) {
                const orderDoc = await Order.findById(oRaw._id);
                if (!orderDoc) continue;

                orderDoc.items = orderDoc.items || [];

                // find the matching item
                const itemIndex = orderDoc.items.findIndex(
                    (it) => String(it.name || "").toLowerCase() === productName.toLowerCase()
                );
                if (itemIndex === -1) continue;

                const item = orderDoc.items[itemIndex];
                const itemPrepared = Math.max(0, Number(item.preparedCount || item.prepared || 0));
                if (itemPrepared <= 0) {
                    // nothing to unprepare for this item — try next order
                    continue;
                }

                // decrement
                orderDoc.items[itemIndex].preparedCount = Math.max(0, itemPrepared - 1);

                // recalc overall
                const newOverallPrepared = orderDoc.items.reduce((s, it) => s + (Number(it.preparedCount || it.prepared || 0)), 0);
                orderDoc.meta = orderDoc.meta || {};
                orderDoc.meta.preparedCount = newOverallPrepared;

                // adjust status
                const totalQty = computeTotalQty(orderDoc);
                if (newOverallPrepared >= totalQty) {
                    orderDoc.status = "ready";
                } else if (newOverallPrepared > 0) {
                    orderDoc.status = "preparing";
                } else {
                    orderDoc.status = "placed";
                }

                await orderDoc.save();

                return NextResponse.json({
                    ok: true,
                    order: {
                        id: orderDoc._id.toString(),
                        status: orderDoc.status,
                        preparedCount: orderDoc.meta.preparedCount,
                        items: orderDoc.items.map(it => ({ name: it.name, qty: it.qty, preparedCount: Number(it.preparedCount || it.prepared || 0) })),
                    },
                }, { status: 200 });
            }

            return NextResponse.json({ ok: false, error: "No prepared units to unprepare for this product" }, { status: 404 });
        }

        // should not reach here
        return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
    } catch (err) {
        console.error("/api/canteen/product/prepare error", err);
        return NextResponse.json({ ok: false, error: err?.message || "Server error" }, { status: 500 });
    }
}
