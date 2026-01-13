// app/api/it/create-user/route.js
export const runtime = 'nodejs';

import { connectToDatabase, User, AuditLog } from '../../../../models/allModels.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const SALT_ROUNDS = 10;

/**
 * POST /api/it/create-user
 * Body JSON:
 * {
 *   name: string (required),
 *   email?: string,
 *   regNumber?: string,   // required for student
 *   role?: 'student'|'admin'|'it'|'canteen'|'external',
 *   isActive?: boolean
 * }
 *
 * Response:
 * { ok: true, user: {...}, tempPassword: '...' }
 */
export async function POST(req) {
    try {
        await connectToDatabase();

        const body = await req.json().catch(() => null);
        if (!body) {
            return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const { name, email, regNumber, role = 'student', isActive = true } = body;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return new Response(JSON.stringify({ ok: false, error: 'Name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const roleStr = String(role || 'student').toLowerCase();

        // For students, regNumber is required and will be used as the temporary password
        if (roleStr === 'student') {
            if (!regNumber || !String(regNumber).trim()) {
                return new Response(JSON.stringify({ ok: false, error: 'regNumber is required for student accounts' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
        }

        // Check for existing user by email or regNumber
        const queryOr = [];
        if (email) queryOr.push({ email });
        if (regNumber) queryOr.push({ regNumber });
        if (queryOr.length) {
            const existing = await User.findOne({ $or: queryOr });
            if (existing) {
                const reason = existing.email === email ? 'email' : (existing.regNumber === regNumber ? 'regNumber' : 'exists');
                return new Response(JSON.stringify({ ok: false, error: `User already exists (conflict on ${reason})` }), { status: 409, headers: { 'Content-Type': 'application/json' } });
            }
        }

        // Determine temporary password
        let tempPassword;
        if (roleStr === 'student') {
            tempPassword = String(regNumber).trim();
        } else {
            // more robust random password: 10 chars, include letters+digits
            tempPassword = crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || (Math.random().toString(36).slice(-10));
        }

        const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

        // Build user doc
        const userDoc = {
            name: name.trim(),
            email: email ? String(email).trim() : undefined,
            role: roleStr,
            isActive: !!isActive,
            passwordHash,
            metadata: { createdBy: 'it-create-user' }
        };

        if (roleStr === 'student') {
            userDoc.regNumber = String(regNumber).trim();
            // require password change on next login is reasonable for students
            userDoc.requirePasswordReset = true;
        } else {
            userDoc.requirePasswordReset = true; // also force temp password change for admins/it/canteen
        }

        // Create the user
        const created = await User.create(userDoc);

        // Best-effort audit log
        try {
            await AuditLog.create({
                actor: null,
                action: 'it_create_user',
                collectionName: 'users',
                documentId: created._id,
                changes: { role: roleStr, email: created.email, regNumber: created.regNumber },
                meta: { via: 'api/it/create-user' }
            });
        } catch (e) {
            console.warn('AuditLog creation failed for create-user:', e?.message || e);
        }

        // sanitize returned user object
        const safeUser = {
            _id: created._id.toString(),
            name: created.name,
            email: created.email || null,
            role: created.role,
            regNumber: created.regNumber || null,
            isActive: created.isActive,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt
        };

        return new Response(JSON.stringify({ ok: true, user: safeUser, tempPassword }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
        console.error('create-user error', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
