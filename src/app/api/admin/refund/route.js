// src/app/api/admin/refund/route.js
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectToDatabase, User, Transaction, AuditLog, Order, Inventory } from '../../../../models/allModels.js';

/**
 * POST /api/admin/refund
 * Body: { adminId, userIdOrReg, amount, note?, relatedOrderId? }
 *
 * Behavior additions:
 * - If relatedOrderId resolves to an Order and that order contains inventory meta
 *   (order.meta.inventoryChanges), the route will restore inventory quantities by
 *   incrementing the Inventory documents that were previously decremented.
 * - It sets order.meta.inventoryRestored = true after successful restore to avoid double-restores.
 * - Works transactionally when MongoDB replica-set is available; falls back to best-effort updates otherwise.
 */
export async function POST(req) {
    try {
        const body = await req.json();
        const { adminId = null, userIdOrReg, amount, note = '', relatedOrderId = null } = body;

        if (!userIdOrReg) {
            return NextResponse.json({ ok: false, error: 'userIdOrReg is required' }, { status: 400 });
        }
        const numericAmount = Number(amount);
        if (!numericAmount || isNaN(numericAmount) || numericAmount <= 0) {
            return NextResponse.json({ ok: false, error: 'Amount must be a positive number' }, { status: 400 });
        }

        await connectToDatabase();

        // attempt transactional path
        let session = null;
        try {
            session = await mongoose.startSession();
            session.startTransaction();

            // resolve user
            let user = null;
            if (mongoose.Types.ObjectId.isValid(String(userIdOrReg))) {
                user = await User.findById(String(userIdOrReg)).session(session);
            } else {
                user = await User.findOne({ regNumber: userIdOrReg }).session(session);
            }
            if (!user) throw new Error('User not found');

            // resolve related order (ObjectId or code)
            let relatedOrderDoc = null;
            if (relatedOrderId) {
                if (mongoose.Types.ObjectId.isValid(String(relatedOrderId))) {
                    relatedOrderDoc = await Order.findById(String(relatedOrderId)).session(session);
                }
                if (!relatedOrderDoc) {
                    relatedOrderDoc = await Order.findOne({ code: String(relatedOrderId) }).session(session);
                }
            }

            // If we have an order and it hasn't had inventory restored yet, attempt to restore
            const restoredInventoryEntries = [];
            if (relatedOrderDoc) {
                // only attempt if not already restored
                const alreadyRestored = !!(relatedOrderDoc.meta && relatedOrderDoc.meta.inventoryRestored);
                if (!alreadyRestored) {
                    // Prefer to use inventoryChanges metadata (recorded at order time)
                    const invChanges = relatedOrderDoc.meta?.inventoryChanges;
                    if (Array.isArray(invChanges) && invChanges.length > 0) {
                        for (const ch of invChanges) {
                            try {
                                if (!ch.inventoryId || !ch.qtyTaken) continue;
                                // increment the inventory doc back by qtyTaken
                                const updatedInv = await Inventory.findOneAndUpdate(
                                    { _id: ch.inventoryId, active: true },
                                    { $inc: { quantity: Number(ch.qtyTaken) } },
                                    { new: true, session }
                                );
                                restoredInventoryEntries.push({
                                    inventoryId: ch.inventoryId,
                                    product: ch.product,
                                    qtyRestored: Number(ch.qtyTaken),
                                    ok: !!updatedInv
                                });
                            } catch (e) {
                                // propagate up to abort transaction (we are in transactional path)
                                throw new Error(`Failed to restore inventory ${String(ch.inventoryId)}: ${e?.message || e}`);
                            }
                        }
                    } else {
                        // No explicit inventoryChanges metadata — attempt a conservative best-effort restore:
                        // For each order item increment the largest active inventory doc for that product by item.qty
                        for (const it of (relatedOrderDoc.items || [])) {
                            const needed = Number(it.qty || 0);
                            if (!needed) continue;
                            // find a single inventory doc to increment (prefer largest) — this is a heuristic
                            const doc = await Inventory.findOne({ product: it.product, active: true }).sort({ quantity: -1 }).session(session);
                            if (!doc) {
                                throw new Error(`No inventory document found to restore product ${String(it.product)}`);
                            }
                            const updatedInv = await Inventory.findOneAndUpdate(
                                { _id: doc._id, active: true },
                                { $inc: { quantity: needed } },
                                { new: true, session }
                            );
                            restoredInventoryEntries.push({
                                inventoryId: doc._id,
                                product: it.product,
                                qtyRestored: needed,
                                ok: !!updatedInv
                            });
                        }
                    }

                    // mark order as refunded-related inventory restored
                    relatedOrderDoc.meta = relatedOrderDoc.meta || {};
                    relatedOrderDoc.meta.inventoryRestored = true;
                    // optionally update order status to 'refunded' (only if you want)
                    relatedOrderDoc.status = relatedOrderDoc.status === 'cancelled' ? relatedOrderDoc.status : 'refunded';
                    await relatedOrderDoc.save({ session });
                }
            }

            // perform balance update on user
            const before = Number(user.balance || 0);
            const after = before + numericAmount;
            user.balance = after;
            await user.save({ session });

            // create transaction record (attach order._id if we have it)
            const txPayload = {
                user: user._id,
                type: 'refund',
                amount: numericAmount,
                balanceBefore: before,
                balanceAfter: after,
                relatedOrder: relatedOrderDoc ? relatedOrderDoc._id : null,
                createdBy: adminId || null,
                note: note || `Refund - ${relatedOrderDoc ? `Order ${String(relatedOrderDoc._id)}` : 'manual refund'}`
            };
            const txArr = await Transaction.create([txPayload], { session });

            // audit log: include original provided relatedOrderId (string) and inventory restore details
            const auditChanges = { amount: numericAmount, before, after, note };
            if (relatedOrderDoc) auditChanges.relatedOrder = relatedOrderDoc._id;
            else if (relatedOrderId) auditChanges.relatedOrderProvided = String(relatedOrderId);
            if (restoredInventoryEntries.length) auditChanges.inventoryRestored = restoredInventoryEntries;

            await AuditLog.create([{
                actor: adminId || null,
                action: 'refund_user',
                collectionName: 'users',
                documentId: user._id,
                changes: auditChanges
            }], { session });

            await session.commitTransaction();
            session.endSession();

            return NextResponse.json({ ok: true, user: user.toObject(), tx: txArr[0], inventoryRestored: restoredInventoryEntries });
        } catch (err) {
            // abort transaction if started
            if (session) {
                try {
                    await session.abortTransaction();
                    session.endSession();
                } catch (e) { /* ignore */ }
            }

            // detect "transactions not supported" error
            const isTransactionNotSupported =
                err && (
                    err.codeName === 'IllegalOperation' ||
                    /Transaction numbers are only allowed/i.test(String(err.message || '')) ||
                    /not a replica set member/i.test(String(err.message || ''))
                );

            if (!isTransactionNotSupported) {
                console.error('Refund (transactional) error:', err);
                throw err;
            }

            // FALLBACK: non-transactional, best-effort path (mirror above but without session)
            try {
                // find user fresh
                let user = null;
                if (mongoose.Types.ObjectId.isValid(String(userIdOrReg))) {
                    user = await User.findById(String(userIdOrReg));
                } else {
                    user = await User.findOne({ regNumber: userIdOrReg });
                }
                if (!user) throw new Error('User not found');

                // resolve related order best-effort
                let relatedOrderDoc = null;
                if (relatedOrderId) {
                    if (mongoose.Types.ObjectId.isValid(String(relatedOrderId))) {
                        relatedOrderDoc = await Order.findById(String(relatedOrderId));
                    }
                    if (!relatedOrderDoc) {
                        relatedOrderDoc = await Order.findOne({ code: String(relatedOrderId) });
                    }
                }

                const restoredInventoryEntries = [];
                if (relatedOrderDoc) {
                    const alreadyRestored = !!(relatedOrderDoc.meta && relatedOrderDoc.meta.inventoryRestored);
                    if (!alreadyRestored) {
                        const invChanges = relatedOrderDoc.meta?.inventoryChanges;
                        if (Array.isArray(invChanges) && invChanges.length > 0) {
                            for (const ch of invChanges) {
                                try {
                                    if (!ch.inventoryId || !ch.qtyTaken) continue;
                                    // best-effort atomic increment on inventory doc
                                    const updatedInv = await Inventory.findOneAndUpdate(
                                        { _id: ch.inventoryId, active: true },
                                        { $inc: { quantity: Number(ch.qtyTaken) } },
                                        { new: true }
                                    );
                                    restoredInventoryEntries.push({
                                        inventoryId: ch.inventoryId,
                                        product: ch.product,
                                        qtyRestored: Number(ch.qtyTaken),
                                        ok: !!updatedInv
                                    });
                                } catch (e) {
                                    // best-effort: continue to next
                                    console.warn('Inventory restore partial failure (fallback):', e?.message || e);
                                }
                            }
                        } else {
                            // fallback heuristic: increment top inventory docs per item
                            for (const it of (relatedOrderDoc.items || [])) {
                                const needed = Number(it.qty || 0);
                                if (!needed) continue;
                                const doc = await Inventory.findOne({ product: it.product, active: true }).sort({ quantity: -1 });
                                if (!doc) {
                                    console.warn(`No inventory document found to restore product ${String(it.product)} (fallback)`);
                                    continue;
                                }
                                const updatedInv = await Inventory.findOneAndUpdate(
                                    { _id: doc._id, active: true },
                                    { $inc: { quantity: needed } },
                                    { new: true }
                                );
                                restoredInventoryEntries.push({
                                    inventoryId: doc._id,
                                    product: it.product,
                                    qtyRestored: needed,
                                    ok: !!updatedInv
                                });
                            }
                        }

                        // mark order meta as restored (best-effort)
                        try {
                            relatedOrderDoc.meta = relatedOrderDoc.meta || {};
                            relatedOrderDoc.meta.inventoryRestored = true;
                            relatedOrderDoc.status = relatedOrderDoc.status === 'cancelled' ? relatedOrderDoc.status : 'refunded';
                            await relatedOrderDoc.save();
                        } catch (e) {
                            console.warn('Failed to mark order inventoryRestored (fallback):', e?.message || e);
                        }
                    }
                }

                // update user balance (atomic $inc)
                const before = Number(user.balance || 0);
                const updatedUser = await User.findOneAndUpdate(
                    { _id: user._id },
                    { $inc: { balance: numericAmount } },
                    { new: true }
                );

                const txDoc = await Transaction.create({
                    user: updatedUser._id,
                    type: 'refund',
                    amount: numericAmount,
                    balanceBefore: before,
                    balanceAfter: Number(updatedUser.balance),
                    relatedOrder: relatedOrderDoc ? relatedOrderDoc._id : null,
                    createdBy: adminId || null,
                    note: note || `Refund (fallback) - ${relatedOrderDoc ? `Order ${String(relatedOrderDoc._id)}` : 'manual refund'}`
                });

                // Best-effort audit log
                const auditChanges = { amount: numericAmount, before, after: Number(updatedUser.balance), note, fallback: true };
                if (relatedOrderDoc) auditChanges.relatedOrder = relatedOrderDoc._id;
                else if (relatedOrderId) auditChanges.relatedOrderProvided = String(relatedOrderId);
                if (restoredInventoryEntries.length) auditChanges.inventoryRestored = restoredInventoryEntries;

                try {
                    await AuditLog.create({
                        actor: adminId || null,
                        action: 'refund_user',
                        collectionName: 'users',
                        documentId: updatedUser._id,
                        changes: auditChanges
                    });
                } catch (e) {
                    console.warn('AuditLog creation failed in refund fallback:', e?.message || e);
                }

                return NextResponse.json({ ok: true, user: updatedUser.toObject(), tx: txDoc, inventoryRestored: restoredInventoryEntries });
            } catch (fallbackErr) {
                console.error('Refund fallback error:', fallbackErr);
                throw fallbackErr || err;
            }
        }
    } catch (err) {
        console.error('POST /api/admin/refund error', err);
        return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
    }
}
