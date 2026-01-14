(async () => {
    const dotenvModule = await import('dotenv');
    const dotenv = dotenvModule.default || dotenvModule;
    dotenv.config({ path: '.env.local' });

    const verifyOnly = String(process.env.VERIFY || '').trim() === '1';
    const verifyEmail = String(process.env.VERIFY_EMAIL || '').trim();
    const verifyPassword = String(process.env.VERIFY_PASSWORD || '');
    const resetEmail = String(process.env.RESET_EMAIL || '').trim();
    const resetPassword = String(process.env.RESET_PASSWORD || '');
    const createEmail = String(process.env.CREATE_EMAIL || '').trim();
    const createPassword = String(process.env.CREATE_PASSWORD || '');
    const createName = String(process.env.CREATE_NAME || '').trim();

    const confirm = String(process.env.CONFIRM || '').trim().toUpperCase();
    const isVerifyMode = verifyOnly || (verifyEmail && verifyPassword);
    if (!isVerifyMode && confirm !== 'YES') {
        console.error('Refusing to run. Set CONFIRM=YES to proceed.');
        process.exit(1);
    }

    const models = await import('../models/allModels.js');
    const { connectToDatabase, User, AuditLog } = models.default || models;
    const bcryptModule = await import('bcrypt');
    const bcrypt = bcryptModule.default || bcryptModule;

    await connectToDatabase();

    const saltRounds = 10;
    if (verifyEmail && verifyPassword) {
        const user = await User.findOne({ email: verifyEmail }).select({ email: 1, passwordHash: 1 }).lean();
        if (!user) {
            console.error(JSON.stringify({ ok: false, error: 'User not found', email: verifyEmail }));
            process.exit(1);
        }

        const match = await bcrypt.compare(String(verifyPassword), String(user.passwordHash || ''));
        console.log(JSON.stringify({ ok: true, email: verifyEmail, passwordMatches: match }));
        process.exit(0);
    }

    if (verifyOnly) {
        const sample = await User.findOne({
            role: 'student',
            regNumber: { $exists: true, $ne: null, $type: 'string' }
        }).select({ regNumber: 1, passwordHash: 1 }).lean();

        const reg = sample?.regNumber ? String(sample.regNumber).trim() : '';
        const match = reg ? await bcrypt.compare(reg, String(sample?.passwordHash || '')) : false;
        console.log(JSON.stringify({ ok: true, sampleRegNumber: sample?.regNumber || null, passwordMatchesRegNumber: match }));
        process.exit(0);
    }

    if (resetEmail && resetPassword) {
        const user = await User.findOne({ email: resetEmail });
        if (!user) {
            console.error(JSON.stringify({ ok: false, error: 'User not found', email: resetEmail }));
            process.exit(1);
        }

        user.passwordHash = await bcrypt.hash(String(resetPassword), saltRounds);
        user.requirePasswordReset = false;
        await user.save();

        try {
            await AuditLog.create({
                actor: null,
                action: 'reset_password_to_value',
                collectionName: 'users',
                documentId: user._id,
                changes: { via: 'script', email: resetEmail }
            });
        } catch (e) {
        }

        console.log(JSON.stringify({ ok: true, email: resetEmail, id: String(user._id) }));
        process.exit(0);
    }

    if (createEmail && createPassword) {
        const existing = await User.findOne({ email: createEmail }).select({ _id: 1, email: 1, role: 1 }).lean();
        if (existing) {
            console.error(JSON.stringify({ ok: false, error: 'User already exists', email: createEmail, id: String(existing._id), role: existing.role || null }));
            process.exit(1);
        }

        const passwordHash = await bcrypt.hash(String(createPassword), saltRounds);
        const created = await User.create({
            name: createName || createEmail,
            email: createEmail,
            role: 'inventory',
            passwordHash,
            isActive: true,
            requirePasswordReset: false,
            metadata: { createdBy: 'script' }
        });

        try {
            await AuditLog.create({
                actor: null,
                action: 'create_inventory_user',
                collectionName: 'users',
                documentId: created._id,
                changes: { email: createEmail, role: 'inventory' }
            });
        } catch (e) {
        }

        console.log(JSON.stringify({ ok: true, email: createEmail, id: String(created._id), role: created.role }));
        process.exit(0);
    }

    const cursor = User.find({
        role: 'student',
        regNumber: { $exists: true, $ne: null, $type: 'string' }
    }).select({ _id: 1, regNumber: 1 }).lean().cursor();

    let scanned = 0;
    let updated = 0;
    let skipped = 0;

    const batchSize = 200;
    const ops = [];

    const flush = async () => {
        if (ops.length === 0) return;
        await User.bulkWrite(ops.splice(0, ops.length), { ordered: false });
    };

    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
        scanned++;
        const reg = String(doc.regNumber || '').trim();
        if (!reg) {
            skipped++;
            continue;
        }

        const hash = await bcrypt.hash(reg, saltRounds);
        ops.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: { passwordHash: hash, requirePasswordReset: true, updatedAt: new Date() } }
            }
        });
        updated++;

        if (ops.length >= batchSize) {
            await flush();
        }
    }

    await flush();

    try {
        await AuditLog.create({
            actor: null,
            action: 'reset_student_passwords_to_regnumber',
            collectionName: 'users',
            changes: { scanned, updated, skipped, requirePasswordReset: true }
        });
    } catch (e) {
    }

    console.log(JSON.stringify({ ok: true, scanned, updated, skipped }));
    process.exit(0);
})().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
});
