// app/api/it/recent-users/route.js
import { connectToDatabase, User } from '../../../../models/allModels.js';

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * GET /api/it/recent-users?limit=12&search=jane
 */
export async function GET(req) {
    try {
        await connectToDatabase();
        const url = new URL(req.url);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 12)));
        const search = (url.searchParams.get('search') || '').trim();

        const query = {};
        if (search) {
            const safeSearch = escapeRegex(search);
            query.$or = [
                { name: { $regex: safeSearch, $options: 'i' } },
                { email: { $regex: safeSearch, $options: 'i' } },
                { regNumber: { $regex: safeSearch, $options: 'i' } },
                { role: { $regex: safeSearch, $options: 'i' } }
            ];
        }

        const users = await User.find(query)
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
