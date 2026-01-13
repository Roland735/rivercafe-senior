// app/api/it/recent-users/route.js
import { connectToDatabase, User } from '../../../../models/allModels.js';

/**
 * GET /api/it/recent-users?limit=12
 */
export async function GET(req) {
    try {
        await connectToDatabase();
        const url = new URL(req.url);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 12)));

        const users = await User.find({})
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('name email regNumber role isActive createdAt')
            .lean();

        return new Response(JSON.stringify({ ok: true, users }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
        console.error('recent-users error', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
