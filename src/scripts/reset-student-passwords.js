(async () => {
    const dotenvModule = await import('dotenv');
    const dotenv = dotenvModule.default || dotenvModule;
    dotenv.config({ path: '.env.local' });

    const verifyOnly = String(process.env.VERIFY || '').trim() === '1';

    const confirm = String(process.env.CONFIRM || '').trim().toUpperCase();
    if (!verifyOnly && confirm !== 'YES') {
        console.error('Refusing to run. Set CONFIRM=YES to proceed.');
        process.exit(1);
    }

    const models = await import('../models/allModels.js');
    const { connectToDatabase, User, AuditLog } = models.default || models;
    const bcryptModule = await import('bcrypt');
    const bcrypt = bcryptModule.default || bcryptModule;

    await connectToDatabase();

    const saltRounds = 10;
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
