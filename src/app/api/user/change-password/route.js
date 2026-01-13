// app/api/user/change-password/route.js
export const runtime = 'nodejs';

import { connectToDatabase, User, AuditLog } from '@/models/allModels';
import bcrypt from 'bcrypt';
import { getServerSession } from 'next-auth/next';
// Adjust this path if your NextAuth file with `authOptions` is elsewhere
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function POST(req) {
    try {
        // parse body
        const { currentPassword = '', newPassword = '' } = await req.json();

        if (!newPassword || String(newPassword).trim().length < 8) {
            return new Response(JSON.stringify({ ok: false, error: 'New password must be at least 8 characters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // get session
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return new Response(JSON.stringify({ ok: false, error: 'Not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }

        await connectToDatabase();

        const userId = session.user.id || session.user?.sub || session.user?.id;
        const user = await User.findById(userId);
        if (!user) {
            return new Response(JSON.stringify({ ok: false, error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // If user has a passwordHash, require currentPassword
        if (user.passwordHash) {
            if (!currentPassword || currentPassword.length === 0) {
                return new Response(JSON.stringify({ ok: false, error: 'Current password required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
            const match = await bcrypt.compare(String(currentPassword), user.passwordHash);
            if (!match) {
                return new Response(JSON.stringify({ ok: false, error: 'Current password is incorrect' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
        } else {
            // user had no local password (SSO). Optionally you may want to allow or disallow setting a password here.
            // We'll allow setting a new password if currentPassword is blank
        }

        const saltRounds = 12;
        const newHash = await bcrypt.hash(String(newPassword), saltRounds);

        user.passwordHash = newHash;
        user.requirePasswordReset = false; // clear flag if an
        await user.save();

        // best-effort audit log
        try {
            await AuditLog.create({
                actor: user._id,
                action: 'user_change_password',
                collectionName: 'users',
                documentId: user._id,
                changes: { via: 'self', note: 'User changed own password' }
            });
        } catch (e) {
            console.warn('AuditLog create failed (change-password):', e?.message || e);

        }

        return new Response(JSON.stringify({ ok: true, message: 'Password updated' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
        console.error('change-password error', err);
        return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
