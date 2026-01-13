// app/api/admin/accounting/withdraw/route.js
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase, User, Transaction, AuditLog } from "@/models/allModels.js";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

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
/**
 * POST body: { userIdOrReg, amount, note?, allowNegative? }
 * Creates a negative Transaction (type: 'adjustment') and updates user.balance atomically.
 * Uses transactions when available; falls back to atomic $inc when not.
 */
export async function POST(req) {
    try {
        await connectToDatabase();

        const session = await getSessionLike(req);
        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
        }

        const allowedRoles = ["admin", "it"];
        if (!allowedRoles.includes((session.user.role || "").toLowerCase())) {
            return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const { userIdOrReg, amount, note, allowNegative = false } = body || {};
        const amt = Number(amount || 0);
        if (!userIdOrReg) return NextResponse.json({ ok: false, error: "userIdOrReg required" }, { status: 400 });
        if (!amt || isNaN(amt) || amt <= 0) return NextResponse.json({ ok: false, error: "amount must be > 0" }, { status: 400 });

        // Try transactional approach first
        let sessionDb = null;
        try {
            sessionDb = await mongoose.startSession();
            sessionDb.startTransaction();

            // find user by id or reg within session
            let user = null;
            if (mongoose.Types.ObjectId.isValid(String(userIdOrReg))) {
                user = await User.findById(String(userIdOrReg)).session(sessionDb);
            }
            if (!user) {
                user = await User.findOne({ regNumber: userIdOrReg }).session(sessionDb);
            }
            if (!user) throw new Error("User not found");

            const before = Number(user.balance || 0);
            const after = before - amt;

            if (!allowNegative && after < 0) {
                throw new Error("Insufficient balance (set allowNegative to override)");
            }

            // update user balance
            user.balance = after;
            await user.save({ session: sessionDb });

            // create transaction record
            const txs = await Transaction.create([{
                user: user._id,
                type: 'adjustment',
                amount: -Math.abs(amt),
                balanceBefore: before,
                balanceAfter: after,
                relatedOrder: null,
                createdBy: session.user.id || session.user.sub || null,
                note: note || `Withdrawn by admin ${session.user.name || session.user.email}`
            }], { session: sessionDb });

            // audit log
            await AuditLog.create([{
                actor: session.user.id || session.user.sub || null,
                action: 'withdraw_user',
                collectionName: 'users',
                documentId: user._id,
                changes: { amount: -amt, before, after, note },
            }], { session: sessionDb });

            // commit
            await sessionDb.commitTransaction();
            sessionDb.endSession();

            return NextResponse.json({
                ok: true,
                user: { id: user._id?.toString?.(), name: user.name, regNumber: user.regNumber, balance: user.balance },
                tx: txs[0]
            }, { status: 200 });

        } catch (err) {
            // Clean up session if active
            if (sessionDb) {
                try {
                    await sessionDb.abortTransaction();
                    sessionDb.endSession();
                } catch (e) { /* ignore cleanup errors */ }
            }

            // Detect transaction-not-allowed (standalone mongod) and fallback
            const isTransactionNotSupported =
                err && (err.codeName === 'IllegalOperation' || /Transaction numbers are only allowed/i.test(String(err.message || '')));

            if (!isTransactionNotSupported) {
                // Not a transactions-capability error -> surface it
                console.error("Withdraw transactional error:", err);
                return NextResponse.json({ ok: false, error: err.message || "Failed to withdraw" }, { status: 500 });
            }

            // Fallback: non-transactional but use atomic $inc to minimize race conditions
            try {
                // find user fresh
                let user = null;
                if (mongoose.Types.ObjectId.isValid(String(userIdOrReg))) {
                    user = await User.findById(String(userIdOrReg));
                }
                if (!user) {
                    user = await User.findOne({ regNumber: userIdOrReg });
                }
                if (!user) throw new Error("User not found");

                const before = Number(user.balance || 0);
                const after = before - amt;

                if (!allowNegative && after < 0) {
                    return NextResponse.json({ ok: false, error: "Insufficient balance (set allowNegative to override)" }, { status: 400 });
                }

                // atomically decrement balance
                const updated = await User.findOneAndUpdate(
                    { _id: user._id },
                    { $inc: { balance: -Math.abs(amt) } },
                    { new: true }
                );

                // create transaction record (best-effort, not in a session)
                const txDoc = await Transaction.create({
                    user: updated._id,
                    type: 'adjustment',
                    amount: -Math.abs(amt),
                    balanceBefore: before,
                    balanceAfter: updated.balance,
                    relatedOrder: null,
                    createdBy: session.user.id || session.user.sub || null,
                    note: note || `Withdrawn by admin ${session.user.name || session.user.email}`
                });

                // audit log (best-effort)
                try {
                    await AuditLog.create({
                        actor: session.user.id || session.user.sub || null,
                        action: 'withdraw_user',
                        collectionName: 'users',
                        documentId: updated._id,
                        changes: { amount: -amt, before, after: updated.balance, note },
                    });
                } catch (e) {
                    console.warn("Audit log failed in withdraw fallback:", e?.message || e);
                }

                return NextResponse.json({
                    ok: true,
                    user: { id: updated._id?.toString?.(), name: updated.name, regNumber: updated.regNumber, balance: updated.balance },
                    tx: txDoc
                }, { status: 200 });

            } catch (fallbackErr) {
                console.error("Withdraw fallback error:", fallbackErr);
                return NextResponse.json({ ok: false, error: fallbackErr.message || "Withdraw failed (fallback)" }, { status: 500 });
            }
        }
    } catch (err) {
        console.error("POST /api/admin/accounting/withdraw error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}
