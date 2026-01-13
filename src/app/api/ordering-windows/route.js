// app/api/ordering-windows/route.js
import { connectToDatabase, OrderingWindow } from '@/models/allModels';
import { NextResponse } from 'next/server';

export async function GET(req) {
    try {
        await connectToDatabase();
        // Return active ordering windows (client will check if a window is currently active)
        const windows = await OrderingWindow.find({}).sort({ priority: -1, startTime: 1 }).lean();
        return NextResponse.json({ ok: true, windows });
    } catch (err) {
        console.error('GET /api/ordering-windows error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
