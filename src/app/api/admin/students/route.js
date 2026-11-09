import { NextResponse } from 'next/server';
import { connectToDatabase, User } from '@/models/allModels';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import bcrypt from 'bcrypt';
import { AuditLog } from '@/models/allModels';

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
        const sortBy = url.searchParams.get('sortBy') || 'name';
        const sortOrder = url.searchParams.get('sortOrder') === 'desc' ? -1 : 1;
        const statusFilter = url.searchParams.get('status'); // 'active', 'inactive', or undefined/all
        const balanceFilter = url.searchParams.get('balance'); // 'positive', 'negative', 'zero', or undefined/all

        const skip = (page - 1) * limit;

        const query = { role: 'student' };

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { regNumber: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        if (statusFilter === 'active') {
            query.isActive = true;
        } else if (statusFilter === 'inactive') {
            query.isActive = false;
        }

        if (balanceFilter === 'positive') {
            query.balance = { $gt: 0 };
        } else if (balanceFilter === 'negative') {
            query.balance = { $lt: 0 };
        } else if (balanceFilter === 'zero') {
            query.balance = 0;
        }

        let sort = {};
        if (sortBy === 'balance') {
            sort.balance = sortOrder;
        } else if (sortBy === 'createdAt') {
            sort.createdAt = sortOrder;
        } else if (sortBy === 'regNumber') {
            sort.regNumber = sortOrder;
        } else {
            sort.name = sortOrder;
        }

        const total = await User.countDocuments(query);
        const students = await User.find(query)
            .select('name regNumber email balance isActive createdAt')
            .sort(sort)
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

async function authorizeStudentManagement() {
    const session = await getServerSession(authOptions);
    return session && ['admin', 'it'].includes(session.user?.role || '') ? session : null;
}

export async function PATCH(req) {
    try {
        const session = await authorizeStudentManagement();
        if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        const { id, regNumber: inputRegNumber } = await req.json();
        const regNumber = String(inputRegNumber || '').trim();
        if (!id || !regNumber) return NextResponse.json({ ok: false, error: 'Student and R number are required' }, { status: 400 });

        await connectToDatabase();
        const student = await User.findOne({ _id: id, role: 'student' });
        if (!student) return NextResponse.json({ ok: false, error: 'Student not found' }, { status: 404 });
        const escapedRegNumber = regNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const conflict = await User.findOne({ regNumber: new RegExp(`^${escapedRegNumber}$`, 'i'), _id: { $ne: student._id } }).select('_id').lean();
        if (conflict) return NextResponse.json({ ok: false, error: 'That R number is already in use' }, { status: 409 });

        const previousRegNumber = student.regNumber;
        if (previousRegNumber !== regNumber) {
            student.regNumber = regNumber;
            student.passwordHash = await bcrypt.hash(regNumber, 10);
            student.requirePasswordReset = true;
            await student.save();
            try {
                await AuditLog.create({ actor: session.user.id || null, action: 'student_reg_number_updated', collectionName: 'users', documentId: student._id, changes: { regNumber: { from: previousRegNumber, to: regNumber } } });
            } catch (auditError) {
                console.warn('Student R number audit failed:', auditError?.message || auditError);
            }
        }
        return NextResponse.json({ ok: true, student: { _id: student._id, regNumber: student.regNumber } });
    } catch (err) {
        if (err?.code === 11000) return NextResponse.json({ ok: false, error: 'That R number is already in use' }, { status: 409 });
        console.error('PATCH /api/admin/students error', err);
        return NextResponse.json({ ok: false, error: 'Unable to update student' }, { status: 500 });
    }
}

export async function DELETE(req) {
    try {
        const session = await authorizeStudentManagement();
        if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        const { id } = await req.json();
        if (!id) return NextResponse.json({ ok: false, error: 'Student id is required' }, { status: 400 });

        await connectToDatabase();
        const student = await User.findOneAndDelete({ _id: id, role: 'student' }).lean();
        if (!student) return NextResponse.json({ ok: false, error: 'Student not found' }, { status: 404 });
        try {
            await AuditLog.create({ actor: session.user.id || null, action: 'student_deleted', collectionName: 'users', documentId: student._id, changes: { name: student.name, regNumber: student.regNumber } });
        } catch (auditError) {
            console.warn('Student deletion audit failed:', auditError?.message || auditError);
        }
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/admin/students error', err);
        return NextResponse.json({ ok: false, error: 'Unable to delete student' }, { status: 500 });
    }
}
