// app/(admin)/menu/page.jsx
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    FiPlus,
    FiEdit,
    FiTrash2,
    FiUpload,
    FiSearch,
    FiX,
    FiDollarSign,
    FiClock,
    FiTag,
    FiAlertTriangle,
    FiImage,
    FiCheck,
    FiChevronDown,
    FiFilter
} from 'react-icons/fi';

function emptyProduct() {
    return {
        name: '',
        sku: '',
        category: '',
        price: 0,
        available: true,
        prepTimeMinutes: 5,
        imageUrl: '',
        tags: [],
        allergens: [],
        notes: ''
    };
}

function normalizeProductForm(p) {
    const base = emptyProduct();
    const merged = { ...base, ...(p || {}) };
    return {
        ...merged,
        name: merged.name ?? '',
        sku: merged.sku ?? '',
        category: merged.category ?? '',
        price: Number(merged.price || 0),
        available: typeof merged.available === 'boolean' ? merged.available : true,
        prepTimeMinutes: Number(merged.prepTimeMinutes || 0) || 5,
        imageUrl: merged.imageUrl ?? '',
        tags: Array.isArray(merged.tags) ? merged.tags : [],
        allergens: Array.isArray(merged.allergens) ? merged.allergens : [],
        notes: merged.notes ?? ''
    };
}

function buildProductPayload(form) {
    const f = normalizeProductForm(form);
    const sku = String(f.sku || '').trim();
    return {
        name: String(f.name || '').trim(),
        sku: sku ? sku : null,
        category: String(f.category || '').trim(),
        price: Number(f.price || 0),
        available: !!f.available,
        prepTimeMinutes: Number(f.prepTimeMinutes || 0) || 5,
        imageUrl: String(f.imageUrl || '').trim(),
        tags: Array.isArray(f.tags) ? f.tags : [],
        allergens: Array.isArray(f.allergens) ? f.allergens : [],
        notes: String(f.notes || '')
    };
}

export default function AdminMenuPage() {
    const [menuType, setMenuType] = useState('ordinary');
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [editing, setEditing] = useState(null);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState(emptyProduct());
    const [search, setSearch] = useState('');
    const [importText, setImportText] = useState('');
    const [importReport, setImportReport] = useState(null);
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [availabilityFilter, setAvailabilityFilter] = useState('all');
    const [allCategories, setAllCategories] = useState([]);
    const apiBase = menuType === 'special' ? '/api/admin/special-products' : '/api/admin/products';

    async function loadList() {
        setLoading(true);
        setError(null);
        try {
            const q = search ? `?search=${encodeURIComponent(search)}` : '';
            const res = await fetch(`${apiBase}${q}`, { cache: 'no-store' });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error || 'Failed to load');
            setProducts(body.products || []);
        } catch (err) {
            console.error(err);
            setError(err.message || 'Failed to load');
        } finally {
            setLoading(false);
        }
    }

    async function loadCategories() {
        try {
            const [ordRes, spRes] = await Promise.all([
                fetch('/api/admin/products', { cache: 'no-store' }),
                fetch('/api/admin/special-products', { cache: 'no-store' })
            ]);

            const [ordBody, spBody] = await Promise.all([ordRes.json(), spRes.json()]);
            const ordCats = ordBody?.ok ? (ordBody.products || []).map(p => p.category).filter(Boolean) : [];
            const spCats = spBody?.ok ? (spBody.products || []).map(p => p.category).filter(Boolean) : [];

            const unique = [...new Set([...ordCats, ...spCats])];
            setAllCategories(unique);
        } catch (e) {
        }
    }

    useEffect(() => { loadList(); }, [search, menuType]);
    useEffect(() => { loadCategories(); }, []);
    useEffect(() => {
        const uniqueCategories = [...new Set((products || []).map(p => p.category).filter(Boolean))];
        setCategories(uniqueCategories);
    }, [products]);

    function openCreate() {
        setForm(emptyProduct());
        setCreating(true);
        setEditing(null);
    }

    function openEdit(p) {
        setForm(normalizeProductForm(p));
        setEditing(p);
        setCreating(false);
    }

    function setField(k, v) {
        setForm(prev => ({ ...prev, [k]: v }));
    }

    async function saveCreate() {
        setLoading(true);
        try {
            const payload = buildProductPayload(form);
            const res = await fetch(apiBase, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error || 'Create failed');
            setCreating(false);
            await loadList();
        } catch (err) {
            alert(err.message || 'Create failed');
        } finally {
            setLoading(false);
        }
    }

    async function saveEdit() {
        if (!editing) return;
        setLoading(true);
        try {
            const payload = buildProductPayload(form);
            const res = await fetch(`${apiBase}/${editing._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error || 'Update failed');
            setEditing(null);
            await loadList();
        } catch (err) {
            alert(err.message || 'Update failed');
        } finally {
            setLoading(false);
        }
    }

    async function deleteProduct(p) {
        if (!confirm(`Delete "${p.name}"?`)) return;
        setLoading(true);
        try {
            const res = await fetch(`${apiBase}/${p._id}`, { method: 'DELETE' });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error || 'Delete failed');
            await loadList();
        } catch (err) {
            alert(err.message || 'Delete failed');
        } finally {
            setLoading(false);
        }
    }

    async function doImport() {
        if (!importText.trim()) return alert('Paste CSV or JSON into the import box.');
        setLoading(true);
        setImportReport(null);
        try {
            // Try to detect JSON vs CSV
            const isJson = importText.trim().startsWith('{') || importText.trim().startsWith('[');
            const headers = isJson ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'text/plain' };
            const body = isJson ? JSON.stringify({ products: JSON.parse(importText) }) : importText;
            const res = await fetch('/api/admin/products/import', { method: 'POST', headers, body });
            const r = await res.json();
            if (!r.ok) throw new Error(r.error || 'Import failed');
            setImportReport(r);
            setImportText('');
            await loadList();
        } catch (err) {
            alert(err.message || 'Import failed');
        } finally {
            setLoading(false);
        }
    }

    // Filter products based on selected category and availability
    const filteredProducts = products.filter(product => {
        const categoryMatch = selectedCategory === 'all' || product.category === selectedCategory;
        const availabilityMatch =
            availabilityFilter === 'all' ||
            (availabilityFilter === 'available' && product.available) ||
            (availabilityFilter === 'unavailable' && !product.available);

        return categoryMatch && availabilityMatch;
    });

    const categoryOptions = [...new Set([...(allCategories || []), form.category].filter(Boolean))];

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-100">Menu Management</h1>
                    <p className="text-sm text-slate-300 mt-1">Create and manage canteen menu items</p>
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full lg:w-auto">
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button
                            onClick={() => setMenuType('ordinary')}
                            className={`px-4 py-2 rounded-lg border transition-colors duration-200 w-full sm:w-auto ${menuType === 'ordinary'
                                ? 'bg-red-600 border-red-500 text-white'
                                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700/50'
                                }`}
                        >
                            Ordinary
                        </button>
                        <button
                            onClick={() => setMenuType('special')}
                            className={`px-4 py-2 rounded-lg border transition-colors duration-200 w-full sm:w-auto ${menuType === 'special'
                                ? 'bg-red-600 border-red-500 text-white'
                                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700/50'
                                }`}
                        >
                            Special
                        </button>
                    </div>
                    <div className="relative w-full sm:w-64">
                        <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                            placeholder="Search products..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {search && (
                            <button
                                onClick={() => setSearch('')}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-200"
                            >
                                <FiX size={18} />
                            </button>
                        )}
                    </div>
                    <button
                        onClick={openCreate}
                        className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 w-full sm:w-auto justify-center"
                    >
                        <FiPlus size={18} /> New Product
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-4">
                <div className="relative">
                    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2">
                        <FiFilter size={16} className="text-slate-400" />
                        <select
                            value={selectedCategory}
                            onChange={e => setSelectedCategory(e.target.value)}
                            className="bg-transparent text-slate-100 outline-none appearance-none pr-6"
                        >
                            <option value="all">All Categories</option>
                            {categories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                        <FiChevronDown size={16} className="text-slate-400 absolute right-3 pointer-events-none" />
                    </div>
                </div>

                <div className="relative">
                    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2">
                        <FiCheck size={16} className="text-slate-400" />
                        <select
                            value={availabilityFilter}
                            onChange={e => setAvailabilityFilter(e.target.value)}
                            className="bg-transparent text-slate-100 outline-none appearance-none pr-6"
                        >
                            <option value="all">All Status</option>
                            <option value="available">Available</option>
                            <option value="unavailable">Unavailable</option>
                        </select>
                        <FiChevronDown size={16} className="text-slate-400 absolute right-3 pointer-events-none" />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Products List */}
                <div className="col-span-2 bg-slate-800 border border-slate-700 rounded-xl p-4 md:p-6">
                    <div className="mb-6 flex items-center justify-between">
                        <h2 className="font-semibold text-slate-100 text-lg">Products {loading && '(loading...)'}</h2>
                        <div className="text-sm text-slate-300">
                            {filteredProducts.length} of {products.length} items
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-200 text-sm mb-4">
                            Error: {error}
                        </div>
                    )}

                    <div className="space-y-3">
                        {filteredProducts.map(p => (
                            <div key={p._id} className="flex items-center justify-between bg-slate-900/50 p-4 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors duration-200">
                                <div className="flex items-center gap-4">
                                    {p.imageUrl ? (
                                        <div className="w-16 h-16 rounded-md overflow-hidden bg-slate-700">
                                            <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                                        </div>
                                    ) : (
                                        <div className="w-16 h-16 rounded-md bg-slate-700 flex items-center justify-center">
                                            <FiImage className="text-slate-400" size={24} />
                                        </div>
                                    )}
                                    <div>
                                        <div className="text-slate-100 font-medium flex items-center gap-2">
                                            {p.name}
                                            {!p.available && (
                                                <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded-full">
                                                    Unavailable
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-sm text-slate-400 mt-1 flex items-center gap-3 flex-wrap">
                                            <span className="flex items-center gap-1">
                                                <FiTag size={14} /> {p.category || 'Uncategorized'}
                                            </span>
                                            {p.sku && (
                                                <span className="flex items-center gap-1">
                                                    SKU: {p.sku}
                                                </span>
                                            )}
                                            <span className="flex items-center gap-1">
                                                <FiClock size={14} /> {p.prepTimeMinutes} min
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="text-slate-100 font-semibold text-right">
                                        {Intl.NumberFormat('en-ZW', { style: 'currency', currency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || 'USD' }).format(p.price || 0)}
                                    </div>
                                    <button
                                        onClick={() => openEdit(p)}
                                        className="p-2 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-700/50 transition-colors duration-200"
                                        title="Edit"
                                    >
                                        <FiEdit size={18} />
                                    </button>
                                    <button
                                        onClick={() => deleteProduct(p)}
                                        className="p-2 rounded-md text-slate-300 hover:text-red-400 hover:bg-slate-700/50 transition-colors duration-200"
                                        title="Delete"
                                    >
                                        <FiTrash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {!filteredProducts.length && !loading && (
                            <div className="text-center py-10 text-slate-400">
                                No products found. {products.length > 0 ? 'Try adjusting your filters.' : 'Create your first product!'}
                            </div>
                        )}
                    </div>
                </div>

                {/* Bulk Import Section */}
                {/* <aside className="bg-slate-800 border border-slate-700 rounded-xl p-4 md:p-6">
                    <h3 className="font-semibold text-slate-100 mb-4 text-lg">Bulk Import</h3>
                    <p className="text-sm text-slate-300 mb-4">
                        Import multiple products at once using CSV or JSON format.
                    </p>

                    <div className="mb-4 p-3 bg-slate-900/50 rounded-lg">
                        <h4 className="text-sm font-medium text-slate-200 mb-2 flex items-center gap-2">
                            <FiAlertTriangle size={16} /> CSV Format
                        </h4>
                        <code className="text-xs text-slate-400 block">
                            name,sku,category,price,available,prepTimeMinutes,imageUrl,tags
                        </code>
                    </div>

                    <textarea
                        className="w-full h-40 p-3 bg-slate-900 border border-slate-700 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                        value={importText}
                        onChange={e => setImportText(e.target.value)}
                        placeholder="Paste CSV or JSON here..."
                    />

                    <div className="flex gap-2 mt-4">
                        <button
                            onClick={doImport}
                            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-slate-900 px-4 py-2 rounded-lg transition-colors duration-200 flex-1 justify-center"
                            disabled={loading}
                        >
                            <FiUpload size={18} /> Import
                        </button>
                        <button
                            onClick={() => { setImportText(''); setImportReport(null); }}
                            className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-700/50 transition-colors duration-200"
                        >
                            Clear
                        </button>
                    </div>

                    {importReport && (
                        <div className="mt-4 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                            <h4 className="text-sm font-medium text-slate-200 mb-2">Import Results</h4>
                            <div className="text-sm text-slate-300 space-y-1">
                                <div className="flex justify-between">
                                    <span>Successful:</span>
                                    <span className="text-green-400">{importReport.created}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Failed:</span>
                                    <span className="text-red-400">{importReport.failed?.length || 0}</span>
                                </div>
                                {importReport.failed?.length > 0 && (
                                    <details className="mt-2">
                                        <summary className="cursor-pointer text-amber-300 text-sm">View failures</summary>
                                        <pre className="text-xs mt-2 bg-slate-800 p-2 rounded overflow-auto max-h-40">
                                            {JSON.stringify(importReport.failed, null, 2)}
                                        </pre>
                                    </details>
                                )}
                            </div>
                        </div>
                    )}
                </aside> */}
            </div>

            {/* Create / Edit Modal */}
            {(creating || editing) && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-6">
                            <h4 className="font-semibold text-slate-100 text-lg">
                                {creating
                                    ? `Create New ${menuType === 'special' ? 'Special ' : ''}Product`
                                    : `Edit: ${editing?.name}`}
                            </h4>
                            <button
                                onClick={() => { setCreating(false); setEditing(null); setForm(emptyProduct()); }}
                                className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-700/50 transition-colors duration-200"
                            >
                                <FiX size={24} />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">Product Name *</label>
                                <input
                                    value={form.name}
                                    onChange={e => setField('name', e.target.value)}
                                    placeholder="e.g., Beef Burger"
                                    className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">SKU</label>
                                <input
                                    value={form.sku || ''}
                                    onChange={e => setField('sku', e.target.value)}
                                    placeholder="Product code"
                                    className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">
                                    Category{menuType === 'special' ? ' *' : ''}
                                </label>
                                <select
                                    value={form.category}
                                    onChange={e => setField('category', e.target.value)}
                                    className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                                >
                                    <option value="">
                                        {menuType === 'special' ? 'Select category (required)' : 'Select category'}
                                    </option>
                                    {categoryOptions.map((cat) => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">Price *</label>
                                <div className="relative">
                                    <FiDollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        type="number"
                                        value={form.price}
                                        onChange={e => setField('price', Number(e.target.value))}
                                        placeholder="0.00"
                                        className="w-full pl-10 pr-3 py-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">Image URL</label>
                                <div className="relative">
                                    <FiImage className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        value={form.imageUrl}
                                        onChange={e => setField('imageUrl', e.target.value)}
                                        placeholder="https://example.com/image.jpg"
                                        className="w-full pl-10 pr-3 py-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">Preparation Time (minutes)</label>
                                <div className="relative">
                                    <FiClock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        value={form.prepTimeMinutes}
                                        onChange={e => setField('prepTimeMinutes', Number(e.target.value))}
                                        placeholder="5"
                                        className="w-full pl-10 pr-3 py-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">Tags (separate with |)</label>
                                <input
                                    value={(form.tags || []).join('|')}
                                    onChange={e => setField('tags', String(e.target.value).split('|').map(s => s.trim()).filter(Boolean))}
                                    placeholder="vegetarian|spicy|popular"
                                    className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">Allergens (separate with |)</label>
                                <input
                                    value={(form.allergens || []).join('|')}
                                    onChange={e => setField('allergens', String(e.target.value).split('|').map(s => s.trim()).filter(Boolean))}
                                    placeholder="nuts|dairy|gluten"
                                    className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                            </div>

                            <div className="space-y-2 md:col-span-2">
                                <label className="text-sm text-slate-300">Description / Notes</label>
                                <textarea
                                    value={form.notes}
                                    onChange={e => setField('notes', e.target.value)}
                                    className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500 h-24"
                                    placeholder="Product description and any special notes..."
                                />
                            </div>

                            <div className="flex items-center gap-2 md:col-span-2">
                                <input
                                    type="checkbox"
                                    id="available"
                                    checked={form.available}
                                    onChange={e => setField('available', e.target.checked)}
                                    className="w-4 h-4 text-red-500 bg-slate-800 border-slate-700 rounded focus:ring-red-500 focus:ring-offset-slate-800"
                                />
                                <label htmlFor="available" className="text-sm text-slate-300">
                                    Product is available for ordering
                                </label>
                            </div>
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => { setCreating(false); setEditing(null); setForm(emptyProduct()); }}
                                className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-700/50 transition-colors duration-200"
                            >
                                Cancel
                            </button>
                            {creating ? (
                                <button
                                    onClick={saveCreate}
                                    className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-white transition-colors duration-200"
                                    disabled={loading}
                                >
                                    {loading ? 'Creating...' : 'Create Product'}
                                </button>
                            ) : (
                                <button
                                    onClick={saveEdit}
                                    className="bg-amber-500 hover:bg-amber-600 px-4 py-2 rounded-lg text-slate-900 transition-colors duration-200"
                                    disabled={loading}
                                >
                                    {loading ? 'Saving...' : 'Save Changes'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
