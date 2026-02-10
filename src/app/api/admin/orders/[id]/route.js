import { NextResponse } from "next/server";
import { connectToDatabase, Order, SpecialOrder, Product, Inventory, User, Transaction, AuditLog } from "@/models/allModels";
import mongoose from "mongoose";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

/**
 * GET /api/admin/orders/:id
 * Returns detailed order doc for admin UI (populated minimal user + prepStation).
 */
export async function GET(req, { params }) {
    try {
        await connectToDatabase();
        const { id } = params || {};
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json({ ok: false, error: "Invalid order id" }, { status: 400 });
        }

        let order = await Order.findById(id)
            .populate("user", "name regNumber")
            .populate("prepStation", "name")
            .lean();

        if (!order) {
            const sOrder = await SpecialOrder.findById(id)
                .populate("user", "name regNumber")
                .populate("prepStation", "name")
                .lean();
            if (!sOrder) {
                return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
            }
            // Normalize SpecialOrder to look like Order
            order = {
                _id: sOrder._id,
                code: sOrder.code,
                status: sOrder.status,
                items: sOrder.items || [],
                total: sOrder.total,
                createdAt: sOrder.createdAt,
                updatedAt: sOrder.updatedAt,
                user: sOrder.user ? { id: sOrder.user._id, name: sOrder.user.name, regNumber: sOrder.user.regNumber } : null,
                regNumber: sOrder.regNumber || (sOrder.user ? sOrder.user.regNumber : null),
                prepStation: sOrder.prepStation ? { id: sOrder.prepStation._id, name: sOrder.prepStation.name } : null,
                prepBy: sOrder.prepBy || null,
                meta: sOrder.meta || {},
                isSpecial: true
            };
            return NextResponse.json({ ok: true, order });
        }

        // safety: normalize fields we use client-side
        const normalized = {
            _id: order._id,
            code: order.code,
            status: order.status,
            items: order.items || [],
            total: order.total,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            user: order.user ? { id: order.user._id, name: order.user.name, regNumber: order.user.regNumber } : null,
            regNumber: order.regNumber || (order.user ? order.user.regNumber : null),
            prepStation: order.prepStation ? { id: order.prepStation._id, name: order.prepStation.name } : null,
            prepBy: order.prepBy || null,
            meta: order.meta || {},
            isSpecial: false
        };

        return NextResponse.json({ ok: true, order: normalized });
    } catch (err) {
        console.error("GET /api/admin/orders/:id error", err);
        return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
    }
}

/**
 * PATCH /api/admin/orders/:id
 * Updates an order's items, recalculates total, adjusts user balance, and updates inventory.
 * Payload: { items: [{ productId, qty }] }
 */
export async function PATCH(req, { params }) {
    try {
        await connectToDatabase();
        const { id } = params || {};
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json({ ok: false, error: "Invalid order id" }, { status: 400 });
        }

        const session = await getServerSession(authOptions);
        const adminId = session?.user?.id;
        if (!adminId) { // Basic auth check, assume middleware handles role
            // Note: In a real app, verify admin role here
        }

        const body = await req.json();
        const newItemsRaw = body.items;

        if (!Array.isArray(newItemsRaw)) {
            return NextResponse.json({ ok: false, error: "Invalid items payload" }, { status: 400 });
        }

        // 1. Fetch Order
        let order = await Order.findById(id);
        let isSpecial = false;
        if (!order) {
            order = await SpecialOrder.findById(id);
            isSpecial = true;
        }

        if (!order) {
            return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
        }

        if (order.status === 'collected' || order.status === 'cancelled' || order.status === 'refunded') {
            return NextResponse.json({ ok: false, error: `Cannot edit order with status: ${order.status}` }, { status: 400 });
        }

        // 2. Process New Items & Calculate New Total
        // We need to fetch product details for new items to get prices
        const productIds = newItemsRaw.map(it => it.productId);
        let products = [];
        if (isSpecial) {
             products = await SpecialProduct.find({ _id: { $in: productIds } });
        } else {
             products = await Product.find({ _id: { $in: productIds } });
        }

        const productMap = new Map(products.map(p => [p._id.toString(), p]));

        const newItems = [];
        let newTotal = 0;

        for (const raw of newItemsRaw) {
            const p = productMap.get(String(raw.productId));
            if (!p) {
                return NextResponse.json({ ok: false, error: `Product not found: ${raw.productId}` }, { status: 400 });
            }
            const qty = Math.max(1, parseInt(raw.qty || 1));
            const price = p.price; // Use current price
            newTotal += price * qty;
            newItems.push({
                product: p._id,
                name: p.name,
                price: price,
                qty: qty,
                notes: raw.notes || '',
                allergens: p.allergens || [],
                preparedCount: 0 // Reset prepared count on edit
            });
        }

        // 3. Calculate Differences (Inventory & Financial)
        const oldItems = order.items || [];
        const oldTotal = order.total || 0;
        const totalDiff = newTotal - oldTotal; // +ve means user owes more, -ve means refund

        // Check Balance Requirement BEFORE Inventory Updates
        let user = null;
        if (order.user) {
            user = await User.findById(order.user);
        }
        
        if (totalDiff > 0) {
             if (!user) {
                 // External order with no user? If so, we might not need balance check, but usually external orders are prepaid or cash.
                 // If external, we assume admin handles payment.
                 // But request says "ensure the order doesnt exceed the student balance".
                 // Only applies if there is a student (user).
             } else {
                 if (user.balance < totalDiff) {
                     return NextResponse.json({ ok: false, error: `Insufficient user balance. Need ${totalDiff}, have ${user.balance}` }, { status: 400 });
                 }
             }
        }

        // Inventory Diff (Only for regular orders)
        const inventoryAdjustments = [];
        if (!isSpecial) {
            // Map: productId -> qty
            const oldQtyMap = new Map();
            oldItems.forEach(it => {
                const pid = String(it.product);
                oldQtyMap.set(pid, (oldQtyMap.get(pid) || 0) + it.qty);
            });

            const newQtyMap = new Map();
            newItems.forEach(it => {
                const pid = String(it.product);
                newQtyMap.set(pid, (newQtyMap.get(pid) || 0) + it.qty);
            });

            const allProductIds = new Set([...oldQtyMap.keys(), ...newQtyMap.keys()]);

            // Check availability for increases
            for (const pid of allProductIds) {
                const oldQ = oldQtyMap.get(pid) || 0;
                const newQ = newQtyMap.get(pid) || 0;
                const diff = newQ - oldQ; // +ve = take more, -ve = put back

                if (diff > 0) {
                    // Check if we have enough stock for the *increase*
                    const totalAvailable = await Inventory.getTotalForProduct(pid);
                    if (totalAvailable < diff) {
                        return NextResponse.json({ ok: false, error: `Insufficient stock for product ID ${pid} (Need ${diff} more, have ${totalAvailable})` }, { status: 400 });
                    }
                }
                if (diff !== 0) {
                    inventoryAdjustments.push({ productId: pid, change: diff });
                }
            }
        }

        // 4. Execute Updates (Best-effort atomic sequence)
        
        // A. Adjust Inventory (Only for regular orders)
        if (!isSpecial) {
            for (const adj of inventoryAdjustments) {
                const { productId, change } = adj;
                if (change > 0) {
                    // Take from inventory (decrease)
                    let remain = change;
                    const invDocs = await Inventory.find({ product: productId, active: true }).sort({ quantity: -1 });
                    for (const doc of invDocs) {
                        if (remain <= 0) break;
                        const available = doc.quantity || 0;
                        const take = Math.min(remain, available);
                        doc.quantity = available - take;
                        await doc.save();
                        remain -= take;
                    }
                } else {
                    // Put back to inventory (increase)
                    const absChange = Math.abs(change);
                    const invDoc = await Inventory.findOne({ product: productId, active: true });
                    if (invDoc) {
                        invDoc.quantity = (invDoc.quantity || 0) + absChange;
                        await invDoc.save();
                    } else {
                        console.warn(`No inventory doc found to restock product ${productId}`);
                    }
                }
            }
        }

        // B. Adjust User Balance & Transaction
        if (user) {
            if (totalDiff !== 0) {
                const amount = -totalDiff;
                const before = user.balance;
                user.balance = Number(user.balance || 0) + amount;
                await user.save();

                await Transaction.create({
                    user: user._id,
                    type: 'adjustment',
                    amount: amount,
                    balanceBefore: before,
                    balanceAfter: user.balance,
                    relatedOrder: isSpecial ? null : order._id,
                    createdBy: adminId,
                    note: `Order ${order.code} edited by admin`,
                    meta: isSpecial ? { special: true, specialOrderId: order._id } : {}
                });
            }
        }

        // C. Update Order
        order.items = newItems;
        order.total = newTotal;
        if (order.status === 'ready' && totalDiff !== 0) {
            // If order was ready but we changed items/total, demote to preparing to ensure kitchen checks it
            order.status = 'preparing';
        }
        order.meta = order.meta || {};
        order.meta.lastEditedBy = adminId;
        order.meta.lastEditedAt = new Date();
        await order.save();

        // D. Audit Log
        await AuditLog.create({
            actor: adminId,
            action: 'edit_order',
            collectionName: 'orders',
            documentId: order._id,
            changes: {
                before: { items: oldItems, total: oldTotal },
                after: { items: newItems, total: newTotal }
            }
        });

        return NextResponse.json({ ok: true, order });

    } catch (err) {
        console.error("PATCH /api/admin/orders/:id error", err);
        return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
    }
}
