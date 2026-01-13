// app/api/student/transactions/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, Transaction, User } from '@/models/allModels';
import { getToken } from 'next-auth/jwt';

async function getServerToken(req) {
    const headersObj = {};
    for (const [k, v] of req.headers) headersObj[k] = v;
    return await getToken({ req: { headers: headersObj }, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(req) {
    try {
        await connectToDatabase();

        const token = await getServerToken(req);
        let userIdOrReg = token?.user?.id || token?.user?.regNumber || null;

        const url = new URL(req.url);
        // dev fallback: accept ?user=... or ?regNumber=...
        if (!userIdOrReg) {
            const q = url.searchParams.get('user') || url.searchParams.get('regNumber');
            if (!q) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
            userIdOrReg = q;
        }

        // resolve to ObjectId if needed
        let userId = userIdOrReg;
        const isObj = /^[0-9a-fA-F]{24}$/.test(String(userIdOrReg));
        if (!isObj) {
            const user = await User.findOne({ regNumber: userIdOrReg }).lean();
            if (!user) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
            userId = user._id;
        }

        const docs = await Transaction.find({ user: userId }).sort({ createdAt: -1 }).limit(200).lean();
        return NextResponse.json({ ok: true, transactions: docs });
    } catch (err) {
        console.error('GET /api/student/transactions error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
