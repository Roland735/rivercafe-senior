// app/api/it/overview/route.js
import { connectToDatabase, User, Product, PrepStation, OrderingWindow, Order, Setting } from '../../../../models/allModels.js';

export async function GET() {
    try {
        await connectToDatabase();

        // counts
        const [usersCount, productsCount, prepStations, windows, activeOrders] = await Promise.all([
            User.countDocuments({}),
            Product.countDocuments({}),
            PrepStation.countDocuments({}),
            OrderingWindow.countDocuments({}),
            Order.countDocuments({ status: { $in: ['placed', 'preparing', 'ready'] } })
        ]);

        // attempt to read lastBackup from settings if present
        let lastBackup = null;
        try {
            const s = await Setting.findOne({ key: 'lastBackup' }).lean();
            if (s && s.value) lastBackup = s.value;
        } catch (e) {
            // ignore
        }

        const health = {
            db: 'ok',
            uptimeSec: Math.floor(process.uptime()),
            lastPing: new Date(),
            lastBackup: lastBackup || null,
            backupStatus: lastBackup ? 'ok' : 'unknown'
        };

        return new Response(JSON.stringify({
            ok: true,
            stats: { usersCount, activeOrders, productsCount, prepStations, windows },
            health
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
        console.error('IT overview error', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
