// app/api/it/reset-password/route.js
import { connectToDatabase, User, AuditLog } from '../../../../models/allModels.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

/**
 * POST /api/it/reset-password
 * Body JSON: { emailOrReg, forceChange: boolean }
 *
 * Returns: { ok, tempPassword, message }
 */
export async function POST(req) {
    try {
        const body = await req.json();
        const identifier = (body.emailOrReg || '').trim();
        const forceChange = !!body.forceChange;

        if (!identifier) {
            return new Response(JSON.stringify({ ok: false, error: 'emailOrReg required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        await connectToDatabase();

        // find by email or regNumber (case-insensitive for regNumber)
        const user = await User.findOne({ $or: [{ email: identifier }, { regNumber: identifier }] });
        if (!user) {
            return new Response(JSON.stringify({ ok: false, error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // generate a friendly temporary password
        const raw = crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
        const tempPassword = raw || `tmp-${Date.now().toString(36).slice(-6)}`;

        const saltRounds = 10;
        const hash = await bcrypt.hash(tempPassword, saltRounds);

        user.passwordHash = hash;
        user.requirePasswordReset = !!forceChange;
        await user.save();

        // audit log (best-effort)
        try {
            await AuditLog.create({
                actor: null,
                action: 'reset_password',
                collectionName: 'users',
                documentId: user._id,
                changes: { method: 'it_reset', forceChange },
                meta: { note: 'IT-triggered password reset' }
            });
        } catch (e) {
            console.warn('AuditLog failed:', e?.message || e);
        }

        // return temp password (IT should communicate securely)
        return new Response(JSON.stringify({ ok: true, tempPassword, message: 'Temporary password created — deliver securely to user.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
        console.error('reset-password error', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
