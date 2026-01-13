// app/api/admin/accounting/reconcile/route.js
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase, Transaction, AuditLog } from "@/models/allModels.js";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

/** Resolve session-like object (uses getToken like other routes) */
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

export async function POST(req) {
    try {
        await connectToDatabase();

        const session = await getSessionLike(req);
        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
        }

        // Restrict to admin / it roles by default (adjust as needed)
        const allowedRoles = ["admin", "it"];
        if (!allowedRoles.includes((session.user.role || "").toLowerCase())) {
            return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const { transactionIds, note } = body || {};

        if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
            return NextResponse.json({ ok: false, error: "transactionIds (non-empty array) required" }, { status: 400 });
        }

        // Normalize requested -> string form for debugging
        const requestedStrings = transactionIds.map((t) =>
            (t && typeof t === "object" && t._id) ? String(t._id) : String(t)
        );

        // Convert to ObjectId only when valid (use `new` to construct)
        const validObjectIds = requestedStrings
            .filter((s) => mongoose.isValidObjectId(s))
            .map((s) => new mongoose.Types.ObjectId(s));

        const invalidIds = requestedStrings.filter((s) => !mongoose.isValidObjectId(s));

        if (validObjectIds.length === 0) {
            return NextResponse.json(
                { ok: false, error: "No valid transaction ids provided", invalidIds: invalidIds },
                { status: 400 }
            );
        }

        const now = new Date();
        const update = {
            $set: {
                "meta.reconciled": true,
                "meta.reconciledAt": now,
                "meta.reconciledBy": session.user.id || session.user.sub || null,
                "meta.reconcileNote": note || "",
            },
        };

        const result = await Transaction.updateMany({ _id: { $in: validObjectIds } }, update);

        // create an audit log entry summarizing the reconcile action
        try {
            await AuditLog.create({
                actor: session.user.id || session.user.sub || null,
                action: "reconcile_transactions",
                collectionName: "transactions",
                documentId: null,
                changes: {
                    requested: requestedStrings,
                    applied: validObjectIds.map(String),
                    invalid: invalidIds,
                    note,
                    modifiedCount: result.modifiedCount || 0,
                },
                meta: { performedAt: now },
            });
        } catch (e) {
            console.warn("Failed to create AuditLog for reconciliation:", e?.message || e);
        }

        return NextResponse.json(
            { ok: true, modifiedCount: result.modifiedCount || 0, invalidIds },
            { status: 200 }
        );
    } catch (err) {
        console.error("POST /api/admin/accounting/reconcile error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}
