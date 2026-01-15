import { NextResponse } from 'next/server';
import { connectToDatabase, SpecialProduct, SpecialOrderingWindow, SpecialOrder, User, Transaction, AuditLog } from '@/models/allModels.js';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

function getLocalTimeParts(timezone) {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'UTC',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
    });
    const parts = fmt.formatToParts(now);
    const hour = parts.find(p => p.type === 'hour')?.value || '00';
    const minute = parts.find(p => p.type === 'minute')?.value || '00';
    const weekday = parts.find(p => p.type === 'weekday')?.value || 'Sun';

    const weekdayMap = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
        'Sun.': 0, 'Mon.': 1, 'Tue.': 2, 'Wed.': 3, 'Thu.': 4, 'Fri.': 5, 'Sat.': 6
    };
    const dayNum = weekdayMap[weekday] ?? now.getDay();
    return { hhmm: `${hour}:${minute}`, day: dayNum };
}

function normalizeDaysOfWeek(days) {
    if (!Array.isArray(days)) return [];
    return days.map(d => {
        const n = Number(d);
        if (Number.isNaN(n)) return null;
        return n === 7 ? 0 : n;
    }).filter(d => d !== null);
}

async function getSessionLike(req) {
    try {
        const secret = authOptions?.secret || process.env.NEXTAUTH_SECRET;
        const cookieName =
            process.env.NODE_ENV === 'production'
                ? '__Secure-next-auth.session-token'
                : 'next-auth.session-token';

        const token = await getToken({
            req,
            secret,
            secureCookie: process.env.NODE_ENV === 'production',
            cookieName,
        }).catch(() => null);

        if (!token) return null;
        return { user: token.user || token };
    } catch (err) {
        return null;
    }
}

export async function POST(req) {
    try {
        await connectToDatabase();

        const session = await getSessionLike(req);
        const body = await req.json().catch(() => ({}));
        const items = Array.isArray(body.items) ? body.items : [];

        if (!items.length) {
            return NextResponse.json({ ok: false, error: 'No items in order' }, { status: 400 });
        }

        const userIdOrReg = session?.user?.id || session?.user?.regNumber || body?.regNumber || null;
        if (!userIdOrReg) {
            return NextResponse.json({ ok: false, error: 'Not authenticated (no user). Provide a session or regNumber.' }, { status: 401 });
        }

        const productIds = items.map(it => it.productId);
        const products = await SpecialProduct.find({ _id: { $in: productIds }, available: true }).lean();
        const productMap = new Map(products.map(p => [String(p._id), p]));

        const normalizedItems = [];
        const categories = new Set();
        for (const it of items) {
            const pid = String(it.productId);
            const product = productMap.get(pid);
            if (!product) {
                return NextResponse.json({ ok: false, error: `Special product not found or unavailable: ${pid}` }, { status: 400 });
            }
            const qty = Math.max(1, parseInt(it.qty || 1, 10));
            normalizedItems.push({ productId: pid, qty });
            categories.add(String(product.category || '').trim());
        }

        const categoryArr = Array.from(categories).filter(Boolean);
        if (categoryArr.length !== 1) {
            return NextResponse.json({ ok: false, error: 'Special orders must be placed for a single category at a time.' }, { status: 400 });
        }
        const category = categoryArr[0];

        const windows = await SpecialOrderingWindow.find({ active: true, category }).sort({ priority: -1, startTime: 1 }).lean();
        const anyActive = (windows || []).some(w => {
            const tz = (w.timezone && typeof w.timezone === 'string') ? w.timezone : 'UTC';
            const { hhmm, day } = getLocalTimeParts(tz);
            const days = normalizeDaysOfWeek(w.daysOfWeek || []);
            if (days.length && !days.includes(day)) return false;

            const start = w.startTime || null;
            const end = w.endTime || null;
            if (start && end) {
                if (start <= end) {
                    if (hhmm < start || hhmm > end) return false;
                } else {
                    if (!(hhmm >= start || hhmm <= end)) return false;
                }
            } else if (start) {
                if (hhmm < start) return false;
            } else if (end) {
                if (hhmm > end) return false;
            }
            return true;
        });

        if (!anyActive) {
            return NextResponse.json({ ok: false, error: 'Special ordering is currently closed for this category.' }, { status: 403 });
        }

        let user = null;
        if (/^[0-9a-fA-F]{24}$/.test(String(userIdOrReg))) {
            user = await User.findById(userIdOrReg);
        } else {
            user = await User.findOne({ regNumber: userIdOrReg });
        }
        if (!user) {
            return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
        }

        let total = 0;
        const orderItems = normalizedItems.map(it => {
            const p = productMap.get(it.productId);
            const qty = it.qty;
            const price = p.price;
            total += price * qty;
            return {
                product: p._id,
                name: p.name,
                price,
                qty,
                notes: it.notes || '',
                allergens: p.allergens || []
            };
        });

        const updatedUser = await User.findOneAndUpdate(
            { _id: user._id, balance: { $gte: total } },
            { $inc: { balance: -total } },
            { new: true }
        );

        if (!updatedUser) {
            return NextResponse.json({ ok: false, error: 'Insufficient balance' }, { status: 402 });
        }

        const code = SpecialOrder.generateCode('SP-');
        const orderDoc = await SpecialOrder.create({
            code,
            user: updatedUser._id,
            regNumber: updatedUser.regNumber || null,
            category,
            items: orderItems,
            total,
            status: 'placed',
            orderingWindow: windows?.[0]?._id || null,
            prepStation: null,
            meta: { special: true }
        });

        const before = updatedUser.balance + total;
        const after = updatedUser.balance;

        await Transaction.create({
            user: updatedUser._id,
            type: 'order',
            amount: -Math.abs(total),
            balanceBefore: before,
            balanceAfter: after,
            relatedOrder: null,
            createdBy: null,
            note: `Special order ${orderDoc.code}`,
            meta: { special: true, specialOrderId: orderDoc._id, category }
        });

        try {
            await AuditLog.create({
                actor: null,
                action: 'place_special_order',
                collectionName: 'specialorders',
                documentId: orderDoc._id,
                changes: { total, category, items: orderItems.map(i => ({ name: i.name, qty: i.qty, price: i.price })) }
            });
        } catch (e) {
        }

        return NextResponse.json({
            ok: true,
            order: {
                id: orderDoc._id?.toString ? orderDoc._id.toString() : orderDoc._id,
                code: orderDoc.code,
                total: orderDoc.total,
                category: orderDoc.category,
                items: orderDoc.items
            }
        }, { status: 201 });
    } catch (err) {
        console.error('POST /api/student/special-order error', err);
        const msg = err?.message || '';
        if (/Insufficient balance/i.test(msg)) {
            return NextResponse.json({ ok: false, error: 'Insufficient balance' }, { status: 402 });
        }
        return NextResponse.json({ ok: false, error: msg || 'Server error' }, { status: 500 });
    }
}

