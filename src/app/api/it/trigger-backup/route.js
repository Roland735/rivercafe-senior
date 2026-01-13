// app/api/it/trigger-backup/route.js
import { connectToDatabase, AuditLog, Setting } from '../../../../models/allModels.js';

/**
 * POST /api/it/trigger-backup
 * This endpoint queues/triggers a backup task.
 * Implementation varies per infra; here we write a Setting and an AuditLog entry.
 */
export async function POST() {
    try {
        await connectToDatabase();

        // Mark the request time as the "backup requested" moment
        const now = new Date();
        try {
            await Setting.findOneAndUpdate({ key: 'lastBackupRequestedAt' }, { $set: { value: now } }, { upsert: true });
        } catch (e) {
            console.warn('Could not write lastBackupRequestedAt setting:', e?.message || e);
        }

        // create audit log (best-effort)
        try {
            await AuditLog.create({
                actor: null,
                action: 'trigger_backup',
                collectionName: 'system',
                changes: { requestedAt: now },
                meta: { note: 'Triggered by IT UI' }
            });
        } catch (e) {
            console.warn('Audit create failed for backup trigger:', e?.message || e);
        }

        // TODO: If you have a backup script or job queue, trigger it here (e.g., spawn child_process or call your job/queue).
        // For now we return a friendly message and the system can pick up the Setting key to run the actual backup.

        return new Response(JSON.stringify({ ok: true, message: 'Backup queued (flag set). Implement actual backup trigger in server-side job processor.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
        console.error('trigger-backup error', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
