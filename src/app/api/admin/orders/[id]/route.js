// app/api/admin/orders/[id]/route.js
import { NextResponse } from "next/server";
import { connectToDatabase, Order, SpecialOrder } from "@/models/allModels";
import mongoose from "mongoose";

/**
 * GET /api/admin/orders/:id
 * Returns detailed order doc for admin UI (populated minimal user + prepStation).
 * Note: Add your session/role checks if needed.
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
            meta: order.meta || {}
        };

        return NextResponse.json({ ok: true, order: normalized });
    } catch (err) {
        console.error("GET /api/admin/orders/:id error", err);
        return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
    }
}
