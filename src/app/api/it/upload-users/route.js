// app/api/it/upload-users/route.js
import { connectToDatabase, User, AuditLog } from '../../../../models/allModels.js';
import bcrypt from 'bcrypt';

/**
 * POST /api/it/upload-users
 * multipart/form-data with file field 'file'
 * Accepts simple CSV with header row. Required columns in header: name,email,role,regNumber
 * For student rows: regNumber is required and will be used as the temporary password (plain regNumber returned).
 * For non-student rows: a random temp password is generated.
 *
 * Response: { ok, result: { createdCount, skipped, errors, created:[{_id,email,regNumber,tempPassword}] } }
 */
export const runtime = 'nodejs';

export async function POST(req) {
    try {
        await connectToDatabase();

        // parse multipart/form-data using formData() (App Router)
        const form = await req.formData();
        const file = form.get('file');
        if (!file) {
            return new Response(JSON.stringify({ ok: false, error: 'No file uploaded. Field name must be "file".' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // read file text
        const buffer = await file.arrayBuffer();
        const txt = new TextDecoder('utf-8').decode(buffer);

        // basic CSV parsing (header, comma separated). Trim blank lines.
        const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length < 1) {
            return new Response(JSON.stringify({ ok: false, error: 'File appears empty.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const header = lines[0].split(',').map(h => h.trim().toLowerCase());
        const rows = lines.slice(1);

        // Ensure header contains the important columns. regNumber is required for student rows,
        // but we require the header to include it so template-driven uploads always include the column.
        const requiredHeader = ['name', 'email', 'role', 'regnumber'];
        for (const col of requiredHeader) {
            if (!header.includes(col)) {
                return new Response(JSON.stringify({ ok: false, error: `Missing required column in header: ${col}. Template must include this column.` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
        }

        const created = [];
        const skipped = [];
        const errors = [];

        const saltRounds = 10;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const cols = row.split(',').map(c => c.trim());
            const obj = {};
            for (let j = 0; j < header.length; j++) {
                obj[header[j]] = cols[j] !== undefined ? cols[j] : '';
            }

            const rowNum = i + 2; // account for header

            // basic per-row validation
            if (!obj.name || !obj.role) {
                skipped.push({ row: rowNum, reason: 'missing required fields (name or role)', data: obj });
                continue;
            }

            const role = String(obj.role || '').toLowerCase();

            // For students: regNumber is required and will be used as the temporary password.
            const regNum = (obj.regnumber || obj.regNumber || '').trim();
            if (role === 'student' && !regNum) {
                skipped.push({ row: rowNum, reason: 'student requires regNumber (used as temp password)', data: obj });
                continue;
            }

            // check existing user by email or regNumber
            const exists = await User.findOne({
                $or: [
                    obj.email ? { email: obj.email } : null,
                    regNum ? { regNumber: regNum } : null
                ].filter(Boolean)
            });

            if (exists) {
                skipped.push({ row: rowNum, reason: 'already exists (email or regNumber)', email: obj.email, regNumber: regNum });
                continue;
            }

            try {
                // Determine temporary plain password:
                // - Students: use regNumber as the temp password (per request).
                // - Others: generate random temp password.
                let rawPass;
                if (role === 'student') {
                    rawPass = regNum;
                } else {
                    rawPass = (Math.random().toString(36).slice(-8) + 'A1'); // basic complexity
                }

                const hash = await bcrypt.hash(rawPass, saltRounds);

                const doc = {
                    name: obj.name,
                    email: obj.email || undefined,
                    regNumber: regNum || undefined,
                    role: role || 'student',
                    passwordHash: hash,
                    isActive: true,
                    metadata: { importedBy: 'it-upload', importRow: rowNum }
                };

                const createdDoc = await User.create(doc);

                created.push({ _id: createdDoc._id.toString(), email: createdDoc.email, regNumber: createdDoc.regNumber, tempPassword: rawPass });

                // audit (best-effort)
                try {
                    await AuditLog.create({
                        actor: null,
                        action: 'it_create_user',
                        collectionName: 'users',
                        documentId: createdDoc._id,
                        changes: { imported: true, role: role },
                        meta: { importRow: rowNum }
                    });
                } catch (e) {
                    // ignore audit failures
                }
            } catch (e) {
                errors.push({ row: rowNum, error: e.message || String(e) });
            }
        }

        const result = { createdCount: created.length, skipped, errors, created };
        return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
        console.error('upload-users error', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
