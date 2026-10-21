export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { AuditLog, connectToDatabase, Inventory, StockAdjustment } from "@/models/allModels";

async function inventoryUser(req) {
  const token = await getToken({
    req,
    secret: authOptions?.secret || process.env.NEXTAUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
    cookieName: process.env.NODE_ENV === "production" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
  }).catch(() => null);
  const user = token?.user || token;
  return String(user?.role || "").toLowerCase() === "inventory" ? user : null;
}

export async function GET(req) {
  try {
    const user = await inventoryUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Inventory access required" }, { status: 403 });
    await connectToDatabase();
    const adjustments = await StockAdjustment.find({})
      .sort({ occurredAt: -1, createdAt: -1 })
      .limit(500)
      .populate("product", "name sku")
      .populate("inventory", "location")
      .populate("recordedBy", "name email")
      .lean();
    return NextResponse.json({ ok: true, adjustments });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const user = await inventoryUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Inventory access required" }, { status: 403 });
    const body = await req.json();
    const quantity = Number(body.quantity);
    const reasons = ["expired", "damaged", "spoiled", "missing", "other"];
    if (!body.inventoryId || !Number.isFinite(quantity) || quantity <= 0 || !reasons.includes(body.reason)) {
      return NextResponse.json({ ok: false, error: "Inventory row, positive quantity, and valid reason are required" }, { status: 400 });
    }
    await connectToDatabase();
    const before = await Inventory.findById(body.inventoryId).lean();
    if (!before) return NextResponse.json({ ok: false, error: "Inventory row not found" }, { status: 404 });
    const updated = await Inventory.findOneAndUpdate(
      { _id: body.inventoryId, active: true, quantity: { $gte: quantity } },
      { $inc: { quantity: -quantity }, $set: { "metadata.lastStockChangeAt": new Date() } },
      { new: true }
    );
    if (!updated) return NextResponse.json({ ok: false, error: "Not enough stock at this location" }, { status: 409 });
    let adjustment;
    try {
      adjustment = await StockAdjustment.create({
        inventory: updated._id,
        product: updated.product,
        quantity,
        reason: body.reason,
        note: String(body.note || "").trim(),
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        recordedBy: user.id || user.sub,
        stockBefore: Number(before.quantity),
        stockAfter: Number(updated.quantity),
      });
    } catch (error) {
      await Inventory.updateOne({ _id: updated._id }, { $inc: { quantity } }).catch(() => null);
      throw error;
    }
    await AuditLog.create({
      actor: user.id || user.sub,
      action: "stock_adjustment",
      collectionName: "stockadjustments",
      documentId: adjustment._id,
      changes: { reason: adjustment.reason, quantity, stockBefore: before.quantity, stockAfter: updated.quantity },
      meta: { inventoryId: updated._id, productId: updated.product, note: adjustment.note },
    }).catch(() => null);
    const populated = await StockAdjustment.findById(adjustment._id)
      .populate("product", "name sku").populate("inventory", "location").populate("recordedBy", "name email").lean();
    return NextResponse.json({ ok: true, adjustment: populated }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
