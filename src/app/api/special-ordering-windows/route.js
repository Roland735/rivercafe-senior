import { NextResponse } from 'next/server';
import { connectToDatabase, SpecialOrderingWindow, Setting } from '@/models/allModels';

export async function GET() {
    try {
        await connectToDatabase();
        const windows = await SpecialOrderingWindow.find({}).sort({ priority: -1, startTime: 1 }).lean();

        const keys = [
            'specialOrders.enabled',
            'specialOrders.bannerText',
            'specialOrders.bannerNote',
        ];
        const settingDocs = await Setting.find({ key: { $in: keys } }).lean();
        const settingMap = new Map(settingDocs.map(d => [d.key, d.value]));

        const enabledRaw = settingMap.get('specialOrders.enabled');
        const enabled =
            typeof enabledRaw === 'boolean'
                ? enabledRaw
                : typeof enabledRaw === 'string'
                    ? enabledRaw.trim().toLowerCase() !== 'false'
                    : enabledRaw === null || enabledRaw === undefined
                        ? true
                        : Boolean(enabledRaw);

        const bannerTextRaw = settingMap.get('specialOrders.bannerText');
        const bannerNoteRaw = settingMap.get('specialOrders.bannerNote');

        const specialOrders = {
            enabled,
            bannerText:
                bannerTextRaw === null || bannerTextRaw === undefined
                    ? 'Try SPECIAL ORDERS today — collect during LUNCHTIME ONLY.'
                    : String(bannerTextRaw),
            bannerNote:
                bannerNoteRaw === null || bannerNoteRaw === undefined
                    ? 'Special orders can only be collected during lunchtime.'
                    : String(bannerNoteRaw),
        };

        return NextResponse.json({ ok: true, windows, specialOrders });
    } catch (err) {
        console.error('GET /api/special-ordering-windows error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
