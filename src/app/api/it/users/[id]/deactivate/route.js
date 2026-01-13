// app/api/it/users/[id]/deactivate/route.js
export const runtime = 'nodejs';

import { connectToDatabase, User, AuditLog } from '@/models/allModels';

/**
 * POST /api/it/users/:id/deactivate
 */
export async function POST(req, { params }) {
    try {
        await connectToDatabase();

        const { id } = params;
        if (!id) {
            return new Response(JSON.stringify({ ok: false, error: 'User id required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const user = await User.findById(id);
        if (!user) {
            return new Response(JSON.stringify({ ok: false, error: 'User not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // already inactive?
        if (user.isActive === false) {
            return new Response(JSON.stringify({ ok: true, user: { _id: user._id, isActive: user.isActive }, message: 'User already inactive' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        user.isActive = false;
        await user.save();

        // Best-effort audit log
        try {
            await AuditLog.create({
                actor: null, // fill with IT user id if session available
                action: 'deactivate_user',
                collectionName: 'users',
                documentId: user._id,
                changes: { isActive: false },
                meta: { via: 'api/it/users/[id]/deactivate' }
            });
        } catch (e) {
            console.warn('AuditLog creation failed (deactivate):', e?.message || e);
        }

        return new Response(JSON.stringify({ ok: true, user: { _id: user._id, isActive: user.isActive } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Deactivate user error:', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
