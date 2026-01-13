// app/api/admin/external-codes-all/route.js
// Admin-only: return recent ExternalCode documents (populated with order and issuedBy)
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
// adjust this path if your NextAuth route file is elsewhere
import { authOptions } from "../../auth/[...nextauth]/route";
import { connectToDatabase, ExternalCode } from "../../../../models/allModels.js";

export async function GET(req) {
    try {
        // admin session check
        const session = await getServerSession(authOptions);
        if (!session || !session.user || session.user.role !== "admin") {
            return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        await connectToDatabase();

        const url = new URL(req.url);
        const limitRaw = Number(url.searchParams.get("limit") || 50);
        const limit = Math.min(500, Math.max(1, isNaN(limitRaw) ? 50 : limitRaw));

        const q = {};
        const usedParam = url.searchParams.get("used");
        if (usedParam === "true") q.used = true;
        if (usedParam === "false") q.used = false;

        const issuedBy = url.searchParams.get("issuedBy");
        if (issuedBy) q.issuedBy = issuedBy;

        // Populate order (now includes code) and issuedBy (name/regNumber)
        const codes = await ExternalCode.find(q)
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate("issuedBy", "name regNumber")
            .populate("order", "code total items status createdAt") // 👈 include code here
            .lean();


        // Return full code objects so client has everything
        return NextResponse.json({ ok: true, externalCodes: codes }, { status: 200 });
    } catch (err) {
        console.error("external-codes-all GET error:", err?.message || err);
        return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
    }
}
