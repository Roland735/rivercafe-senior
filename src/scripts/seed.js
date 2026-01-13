// scripts/seed-auto-prepare.js
// Run: node -r dotenv/config scripts/seed-auto-prepare.js
// This script marks items from Tuck Shop / IceCream categories as prepared.
// It will only set order.status = 'ready' when ALL items in the order are from those categories.

(async () => {
    try {
        const models = await import('../models/allModels.js');
        const {
            connectToDatabase,
            Product,
            Order,
            User
        } = models.default || models;

        await connectToDatabase();
        console.log('Connected to DB');

        // Category matching regex (tolerant of small variations like "IceCream", "Ice Cream", "tuck-shop")
        const categoryRegex = /(tuck[\s-]*shop|ice[\s-]*cream)/i;

        // Find products whose category matches the regex
        const matchingProducts = await Product.find({ category: { $exists: true, $ne: null, $type: 'string' } }).lean();
        const autoPrepProducts = matchingProducts.filter(p => categoryRegex.test(String(p.category || '').trim()));

        if (autoPrepProducts.length === 0) {
            console.log('No products found in Tuck Shop / IceCream categories. Nothing to do.');
            process.exit(0);
        }

        const productIdSet = new Set(autoPrepProducts.map(p => String(p._id)));
        console.log(`Found ${autoPrepProducts.length} auto-prepare product(s). Example names: ${autoPrepProducts.slice(0, 5).map(p => p.name).join(', ')}`);

        // Find a prepBy user to attribute prepared actions (prefer canteen role, fall back to admin)
        const prepByUser = await User.findOne({ role: 'canteen' }) || await User.findOne({ role: 'admin' });
        if (prepByUser) {
            console.log(`Will attribute prepared actions to user: ${prepByUser.email || prepByUser._id}`);
        } else {
            console.log('No canteen/admin user found to set as prepBy. prepBy will be left unchanged.');
        }

        // Query orders that contain any of these products and are not cancelled/refunded
        const ordersCursor = Order.find({
            'items.product': { $in: Array.from(productIdSet) },
            status: { $nin: ['cancelled', 'refunded'] }
        }).cursor();

        let ordersProcessed = 0;
        let ordersUpdated = 0;
        let totalItemsPrepared = 0;

        for (let order = await ordersCursor.next(); order != null; order = await ordersCursor.next()) {
            ordersProcessed++;

            let changed = false;
            const autoPreparedItems = [];

            // Build a quick map of productId -> product doc for category lookup
            // We'll reuse the earlier product docs; if a product wasn't included (rare), fetch it
            // But simplest: for each item check if its product id is in productIdSet
            for (const item of order.items) {
                if (!item || !item.product) continue;
                const prodIdStr = String(item.product);
                if (productIdSet.has(prodIdStr)) {
                    const prevPrepared = Number(item.preparedCount || 0);
                    const qty = Number(item.qty || 0);
                    if (prevPrepared < qty) {
                        item.preparedCount = qty;
                        changed = true;
                        totalItemsPrepared++;
                    }
                    autoPreparedItems.push({ product: item.product, name: item.name, qty: item.qty });
                }
            }

            if (!changed && (!Array.isArray(autoPreparedItems) || autoPreparedItems.length === 0)) {
                // nothing to do for this order
                continue;
            }

            // Determine if ALL items in the order are auto-preparable (i.e., category matches)
            // We'll check each item.product against our productIdSet.
            const allItemsAuto = order.items.length > 0 && order.items.every(it => {
                if (!it || !it.product) return false;
                return productIdSet.has(String(it.product));
            });

            // Only change order status to 'ready' if ALL items are auto-prepared
            if (allItemsAuto) {
                if (order.status !== 'ready') {
                    order.status = 'ready';
                    changed = true;
                }
                if (prepByUser) {
                    order.prepBy = prepByUser._id;
                    changed = true;
                }
            } else {
                // Do not change order.status if some items are non-auto-prepared.
                // We still may want to leave prepBy unchanged in partial-case.
            }

            // record traceable meta
            order.meta = order.meta || {};
            order.meta.autoPrepared = autoPreparedItems;

            if (changed) {
                try {
                    await order.save();
                    ordersUpdated++;
                    console.log(`Updated order ${order._id} — autoPreparedItems: ${autoPreparedItems.length} — allAuto=${allItemsAuto} — status now=${order.status}`);
                } catch (e) {
                    console.error(`Failed to save order ${order._id}:`, e?.message || e);
                }
            }
        }

        console.log('--- Summary ---');
        console.log(`Orders scanned: ${ordersProcessed}`);
        console.log(`Orders updated: ${ordersUpdated}`);
        console.log(`Total order items prepared: ${totalItemsPrepared}`);
        console.log('Done.');
        process.exit(0);
    } catch (err) {
        console.error('Seed (auto-prepare) error:', err);
        process.exit(1);
    }
})();
