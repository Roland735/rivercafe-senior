// app/api/admin/accounting/topup/route.js
import { NextResponse } from "next/server";
import { connectToDatabase, topUpUserAtomic } from "@/models/allModels.js";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/app/api/auth/[...nextauth]/route"; // per your request authOptions is in this file

/** Resolve session-like object (uses getToken like other routess) */
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

        // Read raw body text for robust logging & parsing
        let bodyText = "";
        try {
            bodyText = await req.text();
            console.log("Raw request body:", bodyText || "(empty)");
        } catch (e) {
            console.warn("Failed to read request body text:", e?.message || e);
        }

        let body = {};
        try {
            body = bodyText ? JSON.parse(bodyText) : {};
        } catch (e) {
            console.warn("Failed to parse JSON body:", e?.message || e);
            body = {};
        }

        const session = await getSessionLike(req);
        console.log(
            "session resolved?",
            !!session,
            session ? { userId: session.user?.id || session.user?.sub, role: session.user?.role } : null
        );

        if (!session || !session.user) {
            console.warn("Authentication failed: session or session.user missing");
            return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
        }

        const allowedRoles = ["admin", "it"];
        const userRole = (session.user.role || "").toLowerCase();
        if (!allowedRoles.includes(userRole)) {
            console.warn("Authorization failed: role not allowed:", userRole);
            return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }

        const { userIdOrReg, amount, note } = body || {};
        const amt = Number(amount || 0);

        console.log("Parsed input:", { userIdOrReg, amount: amt, note });

        if (!userIdOrReg) return NextResponse.json({ ok: false, error: "userIdOrReg required" }, { status: 400 });
        if (!amt || isNaN(amt) || amt <= 0) return NextResponse.json({ ok: false, error: "amount must be > 0" }, { status: 400 });

        try {
            const result = await topUpUserAtomic(
                session.user.id || session.user.sub || null,
                userIdOrReg,
                amt,
                note || ""
            );

            const user = result.user;
            const tx = result.tx;
            console.log("topUpUserAtomic success:", { userId: user._id?.toString?.(), txId: tx?._id || tx?.id });

            return NextResponse.json(
                {
                    ok: true,
                    user: {
                        id: user._id?.toString?.() || user._id,
                        name: user.name,
                        regNumber: user.regNumber,
                        balance: user.balance,
                    },
                    tx,
                },
                { status: 200 }
            );
        } catch (err) {
            console.error("topUpUserAtomic error:", err);
            return NextResponse.json({ ok: false, error: err.message || "Failed to top up user" }, { status: 500 });
        }
    } catch (err) {
        console.error("POST /api/admin/accounting/topup error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}
