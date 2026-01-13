// app/api/student/order/route.js
import { NextResponse } from 'next/server';
import {
    connectToDatabase,
    Product,
    OrderingWindow,
    placeOrderAtomic,
    User,
    Order,
    Transaction,
    AuditLog
} from '@/models/allModels.js';
import { getServerSession } from 'next-auth/next';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

/**
 * Try to obtain a session-like object for route handlers.
 * Preferred: getToken({ req }) to read JWT/cookie.
 * Fallback: getServerSession(req, undefined, authOptions) for environments where getToken can't read cookies.
 */
async function getSessionLike(req) {
    try {
        const secret = authOptions?.secret || process.env.NEXTAUTH_SECRET;
        console.debug('getSessionLike: NEXTAUTH_SECRET present?', !!secret);

        try {
            console.debug('getSessionLike: request method/url:', req.method, req.url || '(no url)');
            console.debug('getSessionLike: cookie header present?', !!req.headers?.get?.('cookie'));
            console.debug('getSessionLike: authorization header present?', !!req.headers?.get?.('authorization'));
        } catch (hdrErr) {
            console.warn('getSessionLike: could not read request headers:', hdrErr?.message || hdrErr);
        }

        const cookieName =
            process.env.NODE_ENV === 'production'
                ? '__Secure-next-auth.session-token'
                : 'next-auth.session-token';

        try {
            const token = await getToken({
                req,
                secret,
                secureCookie: process.env.NODE_ENV === 'production',
                cookieName,
            });

            if (token) {
                console.debug('getToken -> token found. token.user present?', !!token.user);
                return { user: token.user || token };
            }
            console.debug('getToken -> no token returned');
        } catch (e) {
            console.warn('getToken threw:', e?.message || e);
        }

        // Fallback to getServerSession (may work in some hosting setups)
        try {
            const session = await getServerSession(req, undefined, authOptions);
            if (session) {
                console.debug('getServerSession fallback -> session found');
                return session;
            }
            console.debug('getServerSession fallback -> no session');
        } catch (gsErr) {
            console.warn('getServerSession fallback threw:', gsErr?.message || gsErr);
        }
    } catch (err) {
        console.warn('getSessionLike unexpected error:', err?.message || err);
    }
    return null;
}

/**
 * Return local time parts { hhmm: 'HH:MM', day: 0..6 } for a given IANA timezone.
 * Uses Intl.DateTimeFormat.formatToParts to reliably get hour/minute and weekday in that tz.
 */
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

    // map short weekday names returned in English to numeric JS getDay values (0 = Sun .. 6 = Sat)
    const weekdayMap = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
        'Sun.': 0, 'Mon.': 1, 'Tue.': 2, 'Wed.': 3, 'Thu.': 4, 'Fri.': 5, 'Sat.': 6
    };
    const dayNum = weekdayMap[weekday] ?? now.getDay();

    return { hhmm: `${hour}:${minute}`, day: dayNum };
}

/**
 * Normalize stored days array into JS day numbers 0..6.
 * Accepts arrays where Sunday might be stored as 7 (map 7 -> 0).
 */
function normalizeDaysOfWeek(days) {
    if (!Array.isArray(days)) return [];
    return days.map(d => {
        const n = Number(d);
        if (Number.isNaN(n)) return null;
        return n === 7 ? 0 : n; // map 7 -> 0 (Sunday) if necessary
    }).filter(d => d !== null);
}

export async function POST(req) {
    try {
        await connectToDatabase();

        try {
            console.debug('[/api/student/order] cookie header present?', !!(typeof req?.headers?.get === 'function' && req.headers.get('cookie')));
        } catch (e) { /* ignore */ }

        const session = await getSessionLike(req);
        const url = new URL(req.url);
        const devReg = url.searchParams.get('regNumber') || null;

        const body = await req.json().catch(() => ({}));
        const items = Array.isArray(body.items) ? body.items : [];
        const prepStationId = body.prepStationId || null;

        if (!items.length) {
            return NextResponse.json({ ok: false, error: 'No items in order' }, { status: 400 });
        }

        let userIdOrReg = session?.user?.id || session?.user?.regNumber || body?.regNumber || null;
        if (!userIdOrReg && devReg) userIdOrReg = devReg;

        if (!userIdOrReg) {
            console.warn('[/api/student/order] No session found and no regNumber provided. Cookie present?', !!(typeof req?.headers?.get === 'function' && req.headers.get('cookie')));
            return NextResponse.json({ ok: false, error: 'Not authenticated (no user). Provide a session or regNumber.' }, { status: 401 });
        }

        // --- ordering window check (timezone-aware & supports overnight windows) ---
        const windows = await OrderingWindow.find({ active: true }).lean();

        const nowUtc = new Date();
        const anyActive = (windows || []).some(w => {
            const tz = (w.timezone && typeof w.timezone === 'string') ? w.timezone : 'UTC';
            const { hhmm, day } = getLocalTimeParts(tz);

            const days = normalizeDaysOfWeek(w.daysOfWeek || []);
            // debug per-window
            console.debug(`[ordering window check] window="${w.name}" tz=${tz} local=${hhmm} day=${day} start=${w.startTime} end=${w.endTime} days=${JSON.stringify(days)}`);

            if (days.length && !days.includes(day)) {
                return false;
            }

            const start = w.startTime || null;
            const end = w.endTime || null;

            if (start && end) {
                // normal case: start <= end (same-day)
                if (start <= end) {
                    if (hhmm < start || hhmm > end) return false;
                } else {
                    // overnight window, e.g., start=22:00 end=06:00 -> active if hhmm >= start OR hhmm <= end
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
            console.warn('[/api/student/order] Ordering closed: no active ordering window (checked at UTC', nowUtc.toISOString(), ')');
            return NextResponse.json({ ok: false, error: 'Ordering is currently closed (no active ordering window).' }, { status: 403 });
        }

        // --- validate products ---
        const productIds = items.map(it => it.productId);
        const products = await Product.find({ _id: { $in: productIds }, available: true }).lean();
        const productMap = new Map(products.map(p => [String(p._id), p]));

        const normalizedItems = [];
        for (const it of items) {
            const pid = String(it.productId);
            const product = productMap.get(pid);
            if (!product) {
                return NextResponse.json({ ok: false, error: `Product not found or unavailable: ${pid}` }, { status: 400 });
            }
            const qty = Math.max(1, parseInt(it.qty || 1, 10));
            normalizedItems.push({ productId: pid, qty });
        }

        const orderPayload = {
            items: normalizedItems,
            prepStationId: prepStationId || null,
            orderingWindowId: null,
            external: false,
            issuedByAdminId: null
        };

        // 1) Try the transactional helper (preferred)
        try {
            const result = await placeOrderAtomic(userIdOrReg, orderPayload, { trustBalanceCheck: true });
            if (!result || !result.ok) {
                return NextResponse.json({ ok: false, error: 'Failed to place order' }, { status: 500 });
            }

            const returnedOrder = result.order;
            return NextResponse.json({
                ok: true,
                order: {
                    id: returnedOrder._id?.toString ? returnedOrder._id.toString() : returnedOrder._id,
                    code: returnedOrder.code,
                    total: returnedOrder.total,
                    items: returnedOrder.items
                }
            }, { status: 201 });
        } catch (err) {
            const msg = err?.message || '';
            const illegalOperation = err && (err.codeName === 'IllegalOperation' || /Transaction numbers are only allowed/i.test(msg));
            if (!illegalOperation) {
                console.error('placeOrderAtomic error (non-transactional):', err);
                if (/Insufficient balance/i.test(msg)) {
                    return NextResponse.json({ ok: false, error: 'Insufficient balance' }, { status: 402 });
                }
                return NextResponse.json({ ok: false, error: msg || 'Server error' }, { status: 500 });
            }

            // --- FALLBACK: non-transactional flow implemented in the route (best-effort) ---
            console.warn('placeOrderAtomic failed due to lack of transactions. Using non-transactional fallback.');

            // load user (non-transactional)
            let user = null;
            if (/^[0-9a-fA-F]{24}$/.test(String(userIdOrReg))) {
                user = await User.findById(userIdOrReg);
            } else {
                user = await User.findOne({ regNumber: userIdOrReg });
            }
            if (!user) {
                return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
            }

            // compute products & total (we already loaded products above, reuse)
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

            // atomic-ish decrement of balance: findOneAndUpdate with condition balance >= total
            const updatedUser = await User.findOneAndUpdate(
                { _id: user._id, balance: { $gte: total } },
                { $inc: { balance: -total } },
                { new: true }
            );

            if (!updatedUser) {
                return NextResponse.json({ ok: false, error: 'Insufficient balance' }, { status: 402 });
            }

            // create order, tx, audit (non-transactionally)
            let orderDoc = null;
            try {
                const code = Order.generateCode('RC-');
                orderDoc = await Order.create({
                    code,
                    user: updatedUser._id,
                    regNumber: updatedUser.regNumber || null,
                    items: orderItems,
                    total,
                    status: 'placed',
                    orderingWindow: null,
                    prepStation: prepStationId || null,
                    external: false,
                    meta: { issuedByAdminId: null }
                });

                const before = updatedUser.balance + total;
                const after = updatedUser.balance;

                const tx = await Transaction.create({
                    user: updatedUser._id,
                    type: 'order',
                    amount: -Math.abs(total),
                    balanceBefore: before,
                    balanceAfter: after,
                    relatedOrder: orderDoc._id,
                    createdBy: null,
                    note: `Order ${orderDoc.code}`
                });

                await AuditLog.create({
                    actor: null,
                    action: 'place_order',
                    collectionName: 'orders',
                    documentId: orderDoc._id,
                    changes: { total, items: orderItems.map(i => ({ name: i.name, qty: i.qty, price: i.price })) }
                });

                return NextResponse.json({
                    ok: true,
                    order: {
                        id: orderDoc._id?.toString ? orderDoc._id.toString() : orderDoc._id,
                        code: orderDoc.code,
                        total: orderDoc.total,
                        items: orderDoc.items
                    }
                }, { status: 201 });
            } catch (createErr) {
                console.error('Fallback order creation failed, attempting rollback of balance:', createErr);
                // try to rollback user balance
                try {
                    await User.findByIdAndUpdate(user._id, { $inc: { balance: total } });
                    console.warn('Rollback succeeded: user balance restored.');
                } catch (rbErr) {
                    console.error('Rollback failed — manual reconciliation required', rbErr);
                }
                const ceMsg = createErr?.message || 'Failed to create order in fallback path';
                return NextResponse.json({ ok: false, error: ceMsg }, { status: 500 });
            }
        }
    } catch (err) {
        console.error('POST /api/student/order error (final):', err);
        const msg = err?.message || 'Server error';
        if (/Insufficient balance/i.test(msg)) {
            return NextResponse.json({ ok: false, error: 'Insufficient balance' }, { status: 402 });
        }
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
}
