/**
 * Single-file Mongoose models for River’Café
 * - Includes: connection helper, all schemas + models, and helpful methods
 * - Use: import { connectToDatabase, User, Product, Order, Transaction, ExternalCode, AuditLog, OrderingWindow, PrepStation, Setting, Notification, Inventory } from './models/allModels';
 *
 * NOTE: For transactions (atomic writes) you must use a MongoDB replica set (Atlas supports this).
 */

import mongoose from 'mongoose';
import crypto from 'crypto';

/* ---------------------------
   DB connection helper (cached)
   --------------------------- */
const MONGODB_URI = process.env.MONGODB_URI || process.env.NEXT_PUBLIC_MONGODB_URI;
if (!MONGODB_URI) {
    throw new Error('Missing MONGODB_URI environment variable');
}

let cached = global.mongoose;
if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

export async function connectToDatabase() {
    if (cached.conn) return cached.conn;
    if (!cached.promise) {
        const opts = {
            // recommended options
            bufferCommands: false,
            // useUnifiedTopology and useNewUrlParser no longer needed in newer drivers but harmless
        };
        cached.promise = mongoose.connect(String(MONGODB_URI).trim(), opts).then((mongooseInstance) => mongooseInstance);
    }
    cached.conn = await cached.promise;
    return cached.conn;
}

/* ---------------------------
   Utilities
   --------------------------- */
function generateAlphanumericCode(prefix = '', length = 4) {
    // time-safe random alphanumeric uppercase
    const bytes = crypto.randomBytes(Math.ceil(length * 0.6));
    const token = bytes.toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, length).toUpperCase();
    return `${prefix}${token}`;
}

/* ---------------------------
   User
   --------------------------- */
const UserSchema = new mongoose.Schema({
    regNumber: { type: String, unique: true, sparse: true, index: true }, // students have this
    name: { type: String, required: true, trim: true, index: true },
    email: { type: String, sparse: true, index: true },
    phone: { type: String, sparse: true },
    passwordHash: { type: String }, // optional if using NextAuth or SSO
    role: {
        type: String,
        enum: ['student', 'admin', 'canteen', 'it', 'inventory', 'external'],
        default: 'student',
        index: true
    },
    balance: { type: Number, default: 0 }, // use smallest currency unit or decimals consistently
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], // quick order
    metadata: { type: mongoose.Schema.Types.Mixed }, // class, year, notes, etc.
    provider: String, // auth provider
    providerId: String,
    isActive: { type: Boolean, default: true },
    requirePasswordReset: { type: Boolean, default: false }
}, { timestamps: true });

/* Instance method: adjust balance (positive or negative) - returns the saved doc */
UserSchema.methods.adjustBalance = async function (amount, { session = null } = {}) {
    // amount positive = credit, negative = debit (but business logic should guard negative balances if disallowed)
    this.balance = Number((this.balance || 0) + Number(amount));
    return this.save({ session });
};

/* Static helper: find by reg number (case-insensitive) */
UserSchema.statics.findByReg = function (regNumber) {
    if (!regNumber) return null;
    return this.findOne({ regNumber: new RegExp(`^${regNumber}$`, 'i') });
};

/* ---------------------------
   Product (Menu item)
   --------------------------- */
const AvailabilityPeriodSchema = new mongoose.Schema({
    dayOfWeek: { type: Number, min: 0, max: 6, required: false }, // 0 = Sunday
    startTime: String, // "07:30"
    endTime: String,   // "10:30"
}, { _id: false });

const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true, index: true },
    sku: { type: String, sparse: true, index: true },
    category: { type: String, index: true },
    price: { type: Number, required: true },
    available: { type: Boolean, default: true, index: true },
    availablePeriods: [AvailabilityPeriodSchema], // optional fine-grained availability
    prepTimeMinutes: { type: Number, default: 5 },
    prepStation: { type: mongoose.Schema.Types.ObjectId, ref: 'PrepStation' },
    imageUrl: String,
    tags: [String],
    allergens: [String],
    notes: String,
    metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

ProductSchema.index({ name: 1, category: 1 });

/* 
  NOTE: we'll override this method *after* we define the Inventory schema so the implementation
  can check the Inventory model. Keep this placeholder in case older code expects a sync method,
  but the final implementation below will be async and preferred.
*/
ProductSchema.methods.isAvailableAt = function (date = new Date()) {
    // original behaviour (kept for compatibility) - this will be replaced with an async version later
    if (!this.available) return false;
    if (!this.availablePeriods || this.availablePeriods.length === 0) return true;
    const day = date.getDay(); // 0..6
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    // basic check against any available period for the day
    return this.availablePeriods.some(p => (p.dayOfWeek === undefined || p.dayOfWeek === day) &&
        (!p.startTime || p.startTime <= hhmm) &&
        (!p.endTime || p.endTime >= hhmm)
    );
};

/* ---------------------------
   PrepStation
   --------------------------- */
const PrepStationSchema = new mongoose.Schema({
    name: { type: String, required: true, index: true },
    description: String,
    location: String,
    active: { type: Boolean, default: true },
    metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

/* ---------------------------
   OrderingWindow
   --------------------------- */
const OrderingWindowSchema = new mongoose.Schema({
    name: { type: String, required: true },
    daysOfWeek: [{ type: Number, min: 0, max: 6 }], // 0..6
    startTime: { type: String, required: true }, // "07:30"
    endTime: { type: String, required: true },   // "10:00"
    active: { type: Boolean, default: true },
    allowedProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], // optional restriction
    priority: { type: Number, default: 0 },
    timezone: { type: String, default: 'Africa/Harare' },
    description: String,
}, { timestamps: true });

OrderingWindowSchema.methods.includes = function (date = new Date()) {
    if (!this.active) return false;
    const day = date.getDay();
    if (this.daysOfWeek && this.daysOfWeek.length && !this.daysOfWeek.includes(day)) return false;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return this.startTime <= hhmm && hhmm <= this.endTime;
};

/* ---------------------------
   Order
   --------------------------- */
const OrderItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    price: Number,
    qty: { type: Number, default: 1 },
    notes: String,
    allergens: [String],
    preparedCount: { type: Number, default: 0 },
}, { _id: false });

const OrderSchema = new mongoose.Schema({
    code: { type: String, index: true }, // single-use pickup code
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null for external
    regNumber: { type: String, sparse: true, index: true },
    items: [OrderItemSchema],
    total: { type: Number, required: true },
    status: { type: String, enum: ['placed', 'preparing', 'ready', 'collected', 'cancelled', 'refunded'], default: 'placed', index: true },
    orderingWindow: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderingWindow' },
    prepStation: { type: mongoose.Schema.Types.ObjectId, ref: 'PrepStation' },
    prepBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // operator who prepared
    collectedByRegNumber: String,
    external: { type: Boolean, default: false },
    expiresAt: Date, // optional expiry for pickup codes
    remarks: String,
    meta: mongoose.Schema.Types.Mixed
}, { timestamps: true });

OrderSchema.index({ createdAt: -1, status: 1 });

/* Static: generate a unique-ish order code with optional prefix */
/* Static: generate a short 4-character order code (prefix optional) */
OrderSchema.statics.generateCode = function (prefix = 'RC-') {
    // produce a short, time-safe random alphanumeric uppercase token of length 4
    const tail = generateAlphanumericCode('', 4);
    return `${prefix}${tail}`;
};


/* Instance: mark as collected */
OrderSchema.methods.markCollected = async function ({ collectedByRegNumber = null, session = null } = {}) {
    this.status = 'collected';
    if (collectedByRegNumber) this.collectedByRegNumber = collectedByRegNumber;
    return this.save({ session });
};

/* ---------------------------
   Transaction (Ledger)  <- UPDATED (Option B)
   - user is now optional so we can record external/cash transactions without a linked user
   - balanceBefore/balanceAfter are optional (external cash txs may not have them)
   --------------------------- */
const TransactionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: false, default: null }, // optional now
    type: { type: String, enum: ['topup', 'order', 'refund', 'adjustment', 'reconciliation', 'external'], required: true, index: true },
    amount: { type: Number, required: true }, // positive = credit, negative = debit
    balanceBefore: { type: Number, required: false },
    balanceAfter: { type: Number, required: false },
    relatedOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // admin/operator
    note: String,
    meta: mongoose.Schema.Types.Mixed
}, { timestamps: true });

TransactionSchema.index({ user: 1, createdAt: -1 });

/* ---------------------------
   ExternalCode
   --------------------------- */
const ExternalCodeSchema = new mongoose.Schema({
    code: { type: String, required: true, index: true },
    value: { type: Number }, // optional fixed value or limit
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    issuedToName: String,
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    expiresAt: Date,
    used: { type: Boolean, default: false, index: true },
    usedAt: Date,
    usedByRegNumber: String,
    meta: mongoose.Schema.Types.Mixed
}, { timestamps: true });

ExternalCodeSchema.statics.createOne = async function ({ prefix = 'EX-', value = null, order = null, issuedBy = null, expiresInMinutes = 60, meta = {} } = {}) {
    const code = `${prefix}${generateAlphanumericCode('', 8)}`;
    const expiresAt = expiresInMinutes ? new Date(Date.now() + expiresInMinutes * 60 * 1000) : null;
    const doc = await this.create({ code, value, order, issuedBy, expiresAt, meta });
    return doc;
};

ExternalCodeSchema.methods.markUsed = async function ({ usedByRegNumber = null, session = null } = {}) {
    if (this.used) throw new Error('Code already used');
    this.used = true;
    this.usedAt = new Date();
    if (usedByRegNumber) this.usedByRegNumber = usedByRegNumber;
    return this.save({ session });
};

/* ---------------------------
   AuditLog
   --------------------------- */
const AuditLogSchema = new mongoose.Schema({
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    action: { type: String, required: true }, // e.g. "topup_user", "menu_update"
    collectionName: String,
    documentId: mongoose.Schema.Types.ObjectId,
    changes: mongoose.Schema.Types.Mixed,
    ip: String,
    userAgent: String,
    meta: mongoose.Schema.Types.Mixed
}, { timestamps: true });

AuditLogSchema.index({ actor: 1, createdAt: -1 });

/* ---------------------------
   Setting (key-value)
   --------------------------- */
const SettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed,
    description: String,
    editable: { type: Boolean, default: true }
}, { timestamps: true });

/* ---------------------------
   Notification (optional)
   --------------------------- */
const NotificationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null },
    type: { type: String, enum: ['order', 'topup', 'system', 'reminder'], required: true },
    channel: { type: String, enum: ['in-app', 'email', 'sms'], default: 'in-app' },
    title: String,
    body: String,
    sent: { type: Boolean, default: false },
    sentAt: Date,
    meta: mongoose.Schema.Types.Mixed
}, { timestamps: true });

/* ---------------------------
   Inventory (new)
   - stores available quantities for products (supports locations, thresholds)
   --------------------------- */
const InventorySchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    quantity: { type: Number, default: 0 }, // available quantity at this inventory location
    location: String, // optional, e.g. "Main Kitchen", "Fridge A"
    active: { type: Boolean, default: true },
    lowStockThreshold: { type: Number, default: 0 },
    metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

/* Convenience static: get total available quantity for a product */
InventorySchema.statics.getTotalForProduct = async function (productId) {
    const docs = await this.find({ product: productId, active: true }).select('quantity').lean();
    return docs.reduce((s, d) => s + (Number(d.quantity || 0)), 0);
};

/* ---------------------------
   Now override ProductSchema.methods.isAvailableAt to consider inventory
   - This method is async: returns Promise<boolean>
   - Behaviour:
 *   1. If product.available === false -> not available
 *   2. Evaluate time-window availability (availablePeriods). If none defined -> timeOk = true
 *   3. If there are inventory documents for this product, require total quantity > 0 to be available.
 *      If there are no inventory docs, fall back to time-window only (legacy behaviour).
   --------------------------- */

ProductSchema.methods.isAvailableAt = async function (date = new Date()) {
    // 1) availability flag
    if (!this.available) return false;

    // 2) time-window check
    let timeOk = true;
    if (this.availablePeriods && this.availablePeriods.length > 0) {
        timeOk = false;
        const day = date.getDay(); // 0..6
        const pad = (n) => (n < 10 ? '0' + n : '' + n);
        const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
        for (const p of this.availablePeriods) {
            const dayMatches = (p.dayOfWeek === undefined) || (p.dayOfWeek === day);
            const startOk = !p.startTime || p.startTime <= hhmm;
            const endOk = !p.endTime || p.endTime >= hhmm;
            if (dayMatches && startOk && endOk) {
                timeOk = true;
                break;
            }
        }
    }

    if (!timeOk) return false;

    // 3) inventory check: if inventory docs exist for this product, require totalQuantity > 0
    //    otherwise (no inventory docs) fall back to timeOk result (which is true here).
    try {
        const Inventory = mongoose.models.Inventory || mongoose.model('Inventory', InventorySchema);
        const total = await Inventory.getTotalForProduct(this._id);
        // if there are inventories (we consider inventory present when total variable exists or when at least one doc exists)
        // getTotalForProduct returns 0 if no docs or all zero; we need to distinguish no-docs vs sum==0.
        // To detect existence of docs, query count.
        const count = await Inventory.countDocuments({ product: this._id, active: true });
        if (count > 0) {
            return total > 0;
        }
        // no inventory records found -> fallback to timeOk (already true)
        return true;
    } catch (e) {
        // If inventory check fails for any reason, fall back to timeOk (avoid blocking service)
        console.warn('Inventory availability check failed:', e?.message || e);
        return true;
    }
};

const SpecialProductSchema = new mongoose.Schema({
    name: { type: String, required: true, index: true },
    sku: { type: String, sparse: true, index: true },
    category: { type: String, index: true, required: true },
    price: { type: Number, required: true },
    available: { type: Boolean, default: true, index: true },
    availablePeriods: [AvailabilityPeriodSchema],
    prepTimeMinutes: { type: Number, default: 5 },
    prepStation: { type: mongoose.Schema.Types.ObjectId, ref: 'PrepStation' },
    imageUrl: String,
    tags: [String],
    allergens: [String],
    notes: String,
    metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

SpecialProductSchema.index({ name: 1, category: 1 });

const SpecialOrderingWindowSchema = new mongoose.Schema({
    category: { type: String, required: true, index: true },
    name: { type: String, required: true },
    daysOfWeek: [{ type: Number, min: 0, max: 6 }],
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    active: { type: Boolean, default: true },
    priority: { type: Number, default: 0 },
    timezone: { type: String, default: 'Africa/Harare' },
    description: String
}, { timestamps: true });

SpecialOrderingWindowSchema.index({ category: 1, priority: -1, startTime: 1 });

const SpecialOrderItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecialProduct' },
    name: String,
    price: Number,
    qty: { type: Number, default: 1 },
    notes: String,
    allergens: [String],
    preparedCount: { type: Number, default: 0 },
}, { _id: false });

const SpecialOrderSchema = new mongoose.Schema({
    code: { type: String, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    regNumber: { type: String, sparse: true, index: true },
    category: { type: String, index: true },
    items: [SpecialOrderItemSchema],
    total: { type: Number, required: true },
    status: { type: String, enum: ['placed', 'preparing', 'ready', 'collected', 'cancelled', 'refunded'], default: 'placed', index: true },
    orderingWindow: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecialOrderingWindow' },
    prepStation: { type: mongoose.Schema.Types.ObjectId, ref: 'PrepStation' },
    prepBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    collectedByRegNumber: String,
    expiresAt: Date,
    remarks: String,
    meta: mongoose.Schema.Types.Mixed
}, { timestamps: true });

SpecialOrderSchema.index({ createdAt: -1, status: 1, category: 1 });

SpecialOrderSchema.statics.generateCode = function (prefix = 'SP-') {
    const tail = generateAlphanumericCode('', 4);
    return `${prefix}${tail}`;
};

/* ---------------------------
   Model exports (single-file)
   --------------------------- */
export const User = mongoose.models.User || mongoose.model('User', UserSchema);
export const Product = mongoose.models.Product || mongoose.model('Product', ProductSchema);
export const SpecialProduct = mongoose.models.SpecialProduct || mongoose.model('SpecialProduct', SpecialProductSchema);
export const PrepStation = mongoose.models.PrepStation || mongoose.model('PrepStation', PrepStationSchema);
export const OrderingWindow = mongoose.models.OrderingWindow || mongoose.model('OrderingWindow', OrderingWindowSchema);
export const SpecialOrderingWindow = mongoose.models.SpecialOrderingWindow || mongoose.model('SpecialOrderingWindow', SpecialOrderingWindowSchema);
export const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);
export const SpecialOrder = mongoose.models.SpecialOrder || mongoose.model('SpecialOrder', SpecialOrderSchema);
export const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', TransactionSchema);
export const ExternalCode = mongoose.models.ExternalCode || mongoose.model('ExternalCode', ExternalCodeSchema);
export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
export const Setting = mongoose.models.Setting || mongoose.model('Setting', SettingSchema);
export const Notification = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
export const Inventory = mongoose.models.Inventory || mongoose.model('Inventory', InventorySchema);

/* ---------------------------
   Convenience: atomic top-up and place-order helpers
   --------------------------- */
/**
 * topUpUserAtomic(adminId, userIdOrReg, amount, note)
 * - credits user balance and writes a Transaction and AuditLog in a MongoDB session
 */
export async function topUpUserAtomic(adminId, userIdOrReg, amount, note = '') {
    if (!amount || amount <= 0) throw new Error('Amount must be positive');
    await connectToDatabase();

    // Try transactional path first (works on replica set / Atlas)
    let session = null;
    try {
        session = await mongoose.startSession();
        session.startTransaction();

        let user = null;
        if (mongoose.Types.ObjectId.isValid(String(userIdOrReg))) {
            user = await User.findById(String(userIdOrReg)).session(session);
        } else {
            user = await User.findOne({ regNumber: userIdOrReg }).session(session);
        }
        if (!user) throw new Error('User not found');

        const before = Number(user.balance || 0);
        const after = before + amount;
        user.balance = after;
        await user.save({ session });

        const txArr = await Transaction.create([{
            user: user._id,
            type: 'topup',
            amount: amount,
            balanceBefore: before,
            balanceAfter: after,
            createdBy: adminId,
            note
        }], { session });

        await AuditLog.create([{
            actor: adminId,
            action: 'topup_user',
            collectionName: 'users',
            documentId: user._id,
            changes: { amount, before, after, note }
        }], { session });

        await session.commitTransaction();
        session.endSession();

        return { ok: true, user, tx: txArr[0] };
    } catch (err) {
        // clean up session if started
        if (session) {
            try {
                await session.abortTransaction();
                session.endSession();
            } catch (e) { /* ignore */ }
        }

        // Detect standalone mongod which doesn't support transactions
        const isTransactionNotSupported =
            err && (err.codeName === 'IllegalOperation' || /Transaction numbers are only allowed/i.test(String(err.message || '')));

        if (!isTransactionNotSupported) {
            // not the "no transactions" error — rethrow for caller to handle
            throw err;
        }

        // Fallback: non-transactional path using atomic $inc for balance update
        try {
            // find user fresh
            let user = null;
            if (mongoose.Types.ObjectId.isValid(String(userIdOrReg))) {
                user = await User.findById(String(userIdOrReg));
            }
            if (!user) {
                user = await User.findOne({ regNumber: userIdOrReg });
            }
            if (!user) throw new Error('User not found');

            const before = Number(user.balance || 0);

            // Atomically increment balance to reduce race windows
            const updated = await User.findOneAndUpdate(
                { _id: user._id },
                { $inc: { balance: amount } },
                { new: true }
            );

            // Create transaction record (best-effort, no session)
            const txDoc = await Transaction.create({
                user: updated._id,
                type: 'topup',
                amount: amount,
                balanceBefore: before,
                balanceAfter: updated.balance,
                createdBy: adminId,
                note
            });

            // Audit log (best-effort)
            try {
                await AuditLog.create({
                    actor: adminId,
                    action: 'topup_user',
                    collectionName: 'users',
                    documentId: updated._id,
                    changes: { amount, before, after: updated.balance, note }
                });
            } catch (e) {
                console.warn('AuditLog creation failed in topUpUserAtomic fallback:', e?.message || e);
            }

            return { ok: true, user: updated, tx: txDoc };
        } catch (fallbackErr) {
            // If fallback fails, surface the fallback error
            throw fallbackErr || err;
        }
    }
}


/**
 * placeOrderAtomic(userIdOrReg, orderPayload)
 * - Creates Order, deducts balance, writes Transaction and AuditLog atomically.
 * - orderPayload: { items: [{ productId, qty, notes }], prepStationId, orderingWindowId, external: boolean, issuedByAdminId? }
 *
 * NOTE: Updated to record external orders in the transactions collection with user: null
 *       AND deduct inventory quantities for ordered items.
 */
export async function placeOrderAtomic(userIdOrReg, orderPayload = {}, { trustBalanceCheck = true } = {}) {
    await connectToDatabase();

    // helper: transactional inventory deduction (inside session)
    async function deductInventoryTransactional(orderItems, session) {
        // use Inventory model exported above
        const InventoryModel = Inventory;
        const inventoryChanges = []; // for audit: { inventoryId, product, before, after, qtyTaken }
        for (const it of orderItems) {
            const needed = Number(it.qty || 0);
            if (!needed) continue;
            // load active inventory docs for this product, prefer larger quantities first (so we deplete larger bins first)
            const invDocs = await InventoryModel.find({ product: it.product, active: true }).session(session).sort({ quantity: -1 });
            const total = invDocs.reduce((s, d) => s + (Number(d.quantity || 0)), 0);
            if (total < needed) {
                throw new Error(`Insufficient stock for product ${it.name || String(it.product)}`);
            }
            let remain = needed;
            for (const doc of invDocs) {
                if (remain <= 0) break;
                const take = Math.min(remain, Number(doc.quantity || 0));
                const before = Number(doc.quantity || 0);
                doc.quantity = before - take;
                await doc.save({ session });
                inventoryChanges.push({ inventoryId: doc._id, product: it.product, before, after: doc.quantity, qtyTaken: take });
                remain -= take;
            }
            if (remain > 0) {
                // shouldn't happen because we pre-checked total, but guard just in case
                throw new Error(`Could not fully deduct inventory for product ${it.name || String(it.product)}`);
            }
        }
        return inventoryChanges;
    }

    // helper: non-transactional deduction (fallback)
    async function deductInventoryNonTransactional(orderItems) {
        const InventoryModel = Inventory;
        const inventoryChanges = [];
        for (const it of orderItems) {
            const needed = Number(it.qty || 0);
            if (!needed) continue;
            // check total first
            const total = await InventoryModel.getTotalForProduct(it.product);
            if (total < needed) {
                throw new Error(`Insufficient stock for product ${it.name || String(it.product)}`);
            }
            let remain = needed;
            // loop, finding a doc with quantity > 0 (prefer larger)
            while (remain > 0) {
                const doc = await InventoryModel.findOne({ product: it.product, active: true, quantity: { $gt: 0 } }).sort({ quantity: -1 });
                if (!doc) {
                    throw new Error(`Insufficient stock for product ${it.name || String(it.product)}`);
                }
                const take = Math.min(remain, Number(doc.quantity || 0));
                // attempt atomic decrement on that doc
                const updated = await InventoryModel.findOneAndUpdate(
                    { _id: doc._id, quantity: { $gte: take } },
                    { $inc: { quantity: -take } },
                    { new: true }
                );
                if (!updated) {
                    // concurrent change -> retry loop to find another doc / updated quantities
                    continue;
                }
                inventoryChanges.push({ inventoryId: updated._id, product: it.product, before: Number(doc.quantity || 0), after: Number(updated.quantity || 0), qtyTaken: take });
                remain -= take;
            }
        }
        return inventoryChanges;
    }

    // helper to decide whether a product category should auto-prepare
    const autoPrepCategories = new Set(['tuck shop', 'icecream']);
    function isAutoPrepareCategory(category) {
        if (!category) return false;
        return autoPrepCategories.has(String(category).trim().toLowerCase());
    }

    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const { items = [], prepStationId = null, orderingWindowId = null, external = false, issuedByAdminId = null } = orderPayload;

        // find user if provided (external orders may pass null)
        let user = null;
        if (!external) {
            if (mongoose.Types.ObjectId.isValid(userIdOrReg)) {
                user = await User.findById(userIdOrReg).session(session);
            } else {
                user = await User.findOne({ regNumber: userIdOrReg }).session(session);
            }
            if (!user) throw new Error('User not found for non-external order');
        }

        // load products and compute total
        const productIds = items.map(it => it.productId);
        const products = await Product.find({ _id: { $in: productIds } }).session(session);
        // map products
        const productMap = new Map(products.map(p => [p._id.toString(), p]));

        let total = 0;
        const orderItems = items.map(it => {
            const p = productMap.get(it.productId);
            if (!p) throw new Error(`Product not found: ${it.productId}`);
            const qty = Math.max(1, Number(it.qty || 1));
            const price = p.price;
            total += price * qty;
            return {
                product: p._id,
                name: p.name,
                price,
                qty,
                notes: it.notes || '',
                allergens: p.allergens || [],
                // preparedCount left to default 0; we'll set it after creation if needed
            };
        });

        // balance check
        if (!external && trustBalanceCheck) {
            if (user.balance < total) throw new Error('Insufficient balance');
        }

        // create order
        const code = Order.generateCode('RC-');
        const orderDocArr = await Order.create([{
            code,
            user: user ? user._id : null,
            regNumber: user ? user.regNumber : null,
            items: orderItems,
            total,
            status: 'placed',
            orderingWindow: orderingWindowId,
            prepStation: prepStationId,
            external: !!external,
            meta: { issuedByAdminId }
        }], { session });

        const orderDoc = orderDocArr[0];

        // DEDUCT INVENTORY (transactional)
        const inventoryChanges = await deductInventoryTransactional(orderItems, session);

        // attach inventoryChanges to order meta for traceability
        if (!orderDoc.meta) orderDoc.meta = {};
        orderDoc.meta.inventoryChanges = inventoryChanges;

        // --- UPDATED: auto-prepare logic (transactional) ---
        // Mark individual items prepared if their product category is auto-prepare.
        // Only mark the whole order 'ready' if ALL items in the order are auto-preparable.
        const autoPreparedItems = [];
        if (orderDoc.items && orderDoc.items.length) {
            for (const sub of orderDoc.items) {
                const prod = productMap.get(String(sub.product));
                const category = prod?.category;
                if (isAutoPrepareCategory(category)) {
                    // mark prepared for this item only
                    sub.preparedCount = Number(sub.qty || 0);
                    autoPreparedItems.push({ product: sub.product, name: sub.name, qty: sub.qty });
                }
            }

            // If every item in the order was auto-prepared, set order status to 'ready' and optionally prepBy
            const allAutoPrepared = orderDoc.items.every(sub => {
                // consider prepared if preparedCount >= qty and the product category is auto-prepare
                const prod = productMap.get(String(sub.product));
                const category = prod?.category;
                if (!isAutoPrepareCategory(category)) return false;
                return Number(sub.preparedCount || 0) >= Number(sub.qty || 0);
            });

            if (allAutoPrepared && orderDoc.items.length > 0) {
                orderDoc.status = 'ready';
                if (issuedByAdminId) {
                    orderDoc.prepBy = issuedByAdminId;
                }
            }
        }

        if (autoPreparedItems.length) {
            orderDoc.meta.autoPrepared = autoPreparedItems;
        }

        // save updates to order (meta + prepared counts + status if changed)
        await orderDoc.save({ session });

        // deduct balance & create transaction
        let txDoc = null;
        if (!external) {
            const before = user.balance || 0;
            const after = before - total;
            user.balance = after;
            await user.save({ session });

            const txs = await Transaction.create([{
                user: user._id,
                type: 'order',
                amount: -Math.abs(total),
                balanceBefore: before,
                balanceAfter: after,
                relatedOrder: orderDoc._id,
                createdBy: issuedByAdminId || null,
                note: `Order ${code}`
            }], { session });
            txDoc = txs[0];
        } else {
            // External order: create a transaction record without a linked user
            const txs = await Transaction.create([{
                user: null, // explicitly null
                type: 'external',
                amount: Number(total), // cash-in
                // balanceBefore/After omitted for external entries; set if you have a cash ledger
                relatedOrder: orderDoc._id,
                createdBy: issuedByAdminId || null,
                note: `External sale - Order ${code}`
            }], { session });
            txDoc = txs[0];
        }

        // audit
        await AuditLog.create([{
            actor: issuedByAdminId || (user ? user._id : null),
            action: 'place_order',
            collectionName: 'orders',
            documentId: orderDoc._id,
            changes: { total, items: orderItems.map(i => ({ name: i.name, qty: i.qty, price: i.price })) },
            meta: { external: !!external, inventoryChanges, autoPrepared: orderDoc.meta?.autoPrepared || [] }
        }], { session });

        await session.commitTransaction();
        session.endSession();

        return { ok: true, order: orderDoc, tx: txDoc };
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        // Detect "no transactions" / standalone mongod errors
        const isTransactionNotSupported =
            err && (
                err.codeName === 'IllegalOperation' ||
                /Transaction numbers are only allowed/i.test(String(err.message || '')) ||
                /not a replica set member/i.test(String(err.message || ''))
            );

        if (!isTransactionNotSupported) {
            // not the "no transactions" error — rethrow for caller to handle
            throw err;
        }

        // --- FALLBACK: non-transactional path (standalone mongod) ---
        try {
            const { items = [], prepStationId = null, orderingWindowId = null, external = false, issuedByAdminId = null } = orderPayload;

            // find user if provided (external orders may pass null)
            let user = null;
            if (!external) {
                if (mongoose.Types.ObjectId.isValid(String(userIdOrReg))) {
                    user = await User.findById(String(userIdOrReg));
                } else {
                    user = await User.findOne({ regNumber: userIdOrReg });
                }
                if (!user) throw new Error('User not found for non-external order');
            }

            // load products and compute total
            const productIds = items.map(it => it.productId);
            const products = await Product.find({ _id: { $in: productIds } });
            const productMap = new Map(products.map(p => [p._id.toString(), p]));

            let total = 0;
            const orderItems = items.map(it => {
                const p = productMap.get(it.productId);
                if (!p) throw new Error(`Product not found: ${it.productId}`);
                const qty = Math.max(1, Number(it.qty || 1));
                const price = Number(p.price || 0);
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

            // balance check
            if (!external && trustBalanceCheck) {
                if ((user.balance || 0) < total) throw new Error('Insufficient balance');
            }

            // create order (non-transactional)
            const code = Order.generateCode('RC-');
            const orderDoc = await Order.create({
                code,
                user: user ? user._id : null,
                regNumber: user ? user.regNumber : null,
                items: orderItems,
                total,
                status: 'placed',
                orderingWindow: orderingWindowId,
                prepStation: prepStationId,
                external: !!external,
                meta: { issuedByAdminId }
            });

            // DEDUCT INVENTORY (non-transactional; best-effort atomic updates)
            let inventoryChanges = [];
            try {
                inventoryChanges = await (async () => {
                    // ensure Inventory model used
                    return await deductInventoryNonTransactional(orderItems);
                })();
                // attach changes to order for traceability
                try {
                    orderDoc.meta = orderDoc.meta || {};
                    orderDoc.meta.inventoryChanges = inventoryChanges;

                    // --- UPDATED: auto-prepare logic for fallback path ---
                    // Mark individual items prepared if their product category is auto-prepare.
                    // Only mark the whole order 'ready' if ALL items in the order are auto-preparable.
                    const autoPreparedItems = [];
                    if (orderDoc.items && orderDoc.items.length) {
                        for (const sub of orderDoc.items) {
                            const prod = productMap.get(String(sub.product));
                            const category = prod?.category;
                            if (isAutoPrepareCategory(category)) {
                                sub.preparedCount = Number(sub.qty || 0);
                                autoPreparedItems.push({ product: sub.product, name: sub.name, qty: sub.qty });
                            }
                        }

                        const allAutoPrepared = orderDoc.items.every(sub => {
                            const prod = productMap.get(String(sub.product));
                            const category = prod?.category;
                            if (!isAutoPrepareCategory(category)) return false;
                            return Number(sub.preparedCount || 0) >= Number(sub.qty || 0);
                        });

                        if (allAutoPrepared && orderDoc.items.length > 0) {
                            orderDoc.status = 'ready';
                            if (issuedByAdminId) {
                                orderDoc.prepBy = issuedByAdminId;
                            }
                        }

                        if (autoPreparedItems.length) {
                            orderDoc.meta.autoPrepared = autoPreparedItems;
                        }
                    }

                    await orderDoc.save();
                } catch (e) {
                    // non-critical: we already deducted inventory; but best-effort attach meta
                    console.warn('Failed to attach inventory meta to order (fallback):', e?.message || e);
                }
            } catch (deductErr) {
                // If inventory deduction fails after order created, try to remove the created order to avoid inconsistent state
                try {
                    await Order.deleteOne({ _id: orderDoc._id });
                } catch (cleanupErr) {
                    console.warn('Failed to cleanup order after inventory deduction failure:', cleanupErr?.message || cleanupErr);
                }
                throw deductErr;
            }

            let txDoc = null;
            if (!external) {
                // Attempt atomic balance decrement using $inc to reduce race windows
                const before = Number(user.balance || 0);
                const updated = await User.findOneAndUpdate(
                    { _id: user._id },
                    { $inc: { balance: -Math.abs(total) } },
                    { new: true }
                );

                // Create transaction record (best-effort)
                txDoc = await Transaction.create({
                    user: user._id,
                    type: 'order',
                    amount: -Math.abs(total),
                    balanceBefore: before,
                    balanceAfter: updated.balance,
                    relatedOrder: orderDoc._id,
                    createdBy: issuedByAdminId || null,
                    note: `Order ${code} (fallback)`
                });

                // Best-effort audit log
                try {
                    await AuditLog.create({
                        actor: issuedByAdminId || user._id,
                        action: 'place_order',
                        collectionName: 'orders',
                        documentId: orderDoc._id,
                        changes: { total, items: orderItems.map(i => ({ name: i.name, qty: i.qty, price: i.price })) },
                        meta: { fallback: true, inventoryChanges, autoPrepared: orderDoc.meta?.autoPrepared || [] }
                    });
                } catch (e) {
                    console.warn('AuditLog creation failed in placeOrderAtomic fallback:', e?.message || e);
                }
            } else {
                // external -> create transaction without linked user (best-effort)
                txDoc = await Transaction.create({
                    user: null,
                    type: 'external',
                    amount: Number(total),
                    // no balanceBefore/After for external cash entries
                    relatedOrder: orderDoc._id,
                    createdBy: issuedByAdminId || null,
                    note: `External sale - Order ${code} (fallback)`
                });

                // external -> still write an audit log
                try {
                    await AuditLog.create({
                        actor: issuedByAdminId || null,
                        action: 'place_order',
                        collectionName: 'orders',
                        documentId: orderDoc._id,
                        changes: { total, items: orderItems.map(i => ({ name: i.name, qty: i.qty, price: i.price })) },
                        meta: { external: true, fallback: true, inventoryChanges, autoPrepared: orderDoc.meta?.autoPrepared || [] }
                    });
                } catch (e) {
                    console.warn('AuditLog creation failed in placeOrderAtomic fallback (external):', e?.message || e);
                }
            }

            return { ok: true, order: orderDoc, tx: txDoc };
        } catch (fallbackErr) {
            // If fallback fails, surface the fallback error
            throw fallbackErr || err;
        }
    }
}

/* ---------------------------
   Default export (optional)
   --------------------------- */
const Models = {
    connectToDatabase,
    User,
    Product,
    SpecialProduct,
    PrepStation,
    OrderingWindow,
    SpecialOrderingWindow,
    Order,
    SpecialOrder,
    Transaction,
    ExternalCode,
    AuditLog,
    Setting,
    Notification,
    Inventory,
    topUpUserAtomic,
    placeOrderAtomic
};

export default Models;
