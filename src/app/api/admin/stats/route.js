// app/api/admin/stats/route.js
import { NextResponse } from 'next/server';
import { connectToDatabase, Order, Transaction, User, ExternalCode } from '../../../../models/allModels.js';

const LOW_BALANCE_THRESHOLD = Number(process.env.LOW_BALANCE_THRESHOLD) || 50;

async function computeStats() {
    await connectToDatabase();

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // Today's revenue (sum of order transaction amounts). Orders are stored as negative amounts.
    const revenueAgg = await Transaction.aggregate([
        { $match: { type: 'order', createdAt: { $gte: startOfDay, $lte: endOfDay } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const todaysRevenueValue = (revenueAgg && revenueAgg[0] && typeof revenueAgg[0].total === 'number')
        ? Math.abs(revenueAgg[0].total)
        : 0;

    // Active orders (placed / preparing / ready)
    const activeOrders = await Order.countDocuments({ status: { $in: ['placed', 'preparing', 'ready'] } });

    // Low balance alerts (students below threshold)
    const lowBalanceAlerts = await User.countDocuments({ role: 'student', balance: { $lt: LOW_BALANCE_THRESHOLD } });

    // Pending external codes (unused and not expired)
    const now = new Date();
    const pendingExternalCodes = await ExternalCode.countDocuments({
        used: false,
        $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: now } }
        ]
    });

    return { todaysRevenueValue, activeOrders, lowBalanceAlerts, pendingExternalCodes };
}

export async function GET() {
    try {
        const stats = await computeStats();
        return NextResponse.json({ ok: true, stats }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('Failed to compute admin stats:', err);
        return NextResponse.json({ ok: false, error: err.message || 'Unknown error' }, { status: 500 });
    }
}
