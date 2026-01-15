import { NextResponse } from "next/server";
import { connectToDatabase, SpecialProduct } from "@/models/allModels.js";

export async function GET() {
    try {
        await connectToDatabase();
        const products = await SpecialProduct.find({ available: true })
            .select("name category price prepTimeMinutes imageUrl allergens notes metadata")
            .sort({ category: 1, name: 1 })
            .lean();

        return NextResponse.json({ ok: true, products }, { status: 200 });
    } catch (err) {
        console.error("GET /api/student/special-menu error", err);
        return NextResponse.json({ ok: false, error: err.message || "Server error" }, { status: 500 });
    }
}

