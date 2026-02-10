import { NextResponse } from 'next/server';
import { connectToDatabase, User } from '@/models/allModels';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET(req) {
    try {
        const session = await getServerSession(authOptions);
        const role = session?.user?.role || '';
        
        if (!session || !['admin', 'accounting', 'it'].includes(role)) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        }

        await connectToDatabase();
        const url = new URL(req.url);
        const search = url.searchParams.get('search') || '';
        const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '20', 10));
        const page = parseInt(url.searchParams.get('page') || '1', 10);
        const skip = (page - 1) * limit;

        const query = { role: 'student' };
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { regNumber: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const total = await User.countDocuments(query);
        const students = await User.find(query)
            .select('name regNumber email balance isActive createdAt')
            .sort({ name: 1 })
            .skip(skip)
            .limit(limit)
            .lean();

        return NextResponse.json({ 
            ok: true, 
            students: students.map(s => ({
                _id: s._id,
                name: s.name,
                regNumber: s.regNumber,
                email: s.email,
                balance: s.balance,
                isActive: s.isActive,
                createdAt: s.createdAt
            })), 
            total, 
            page, 
            totalPages: Math.ceil(total / limit) 
        });
    } catch (err) {
        console.error('GET /api/admin/students error', err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
