// app/(it)/page.jsx
'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
    FiRefreshCw,
    FiUpload,
    FiKey,
    FiUser,
    FiDatabase,
    FiClock,
    FiCheckCircle,
    FiAlertCircle,
    FiDownload,
    FiClipboard,
    FiPlus,
} from 'react-icons/fi';

/**
 * IT Home Page (responsive) with "Add user" option (any role).
 *
 * Expected API endpoints used:
 *  GET  /api/it/overview
 *  GET  /api/it/recent-users
 *  POST /api/it/reset-password
 *  POST /api/it/upload-users
 *  POST /api/it/create-user
 *  POST /api/it/users/:id/deactivate
 *  POST /api/it/users/:id/activate
 */

function Modal({ open, title, onClose, children, footer }) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden
            />
            <div className="relative w-full max-w-2xl bg-slate-800 border border-slate-700 rounded-xl p-5 z-10 mx-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
                    <button
                        onClick={onClose}
                        className="p-2 rounded hover:bg-slate-700 text-slate-300"
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                <div className="space-y-4">{children}</div>
                {footer && <div className="mt-4">{footer}</div>}
            </div>
        </div>
    );
}

export default function ITHomePage() {
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState(null);
    const [health, setHealth] = useState(null);
    const [recentUsers, setRecentUsers] = useState([]);
    const [refreshKey, setRefreshKey] = useState(0);

    // search state
    const [search, setSearch] = useState('');

    // per-user action loading (activate/deactivate)
    const [actionLoadingId, setActionLoadingId] = useState(null);

    // Reset password modal state
    const [isResetOpen, setIsResetOpen] = useState(false);
    const [resetIdentifier, setResetIdentifier] = useState('');
    const [forceChange, setForceChange] = useState(true);
    const [resetResult, setResetResult] = useState(null);
    const [resetLoading, setResetLoading] = useState(false);
    const [copiedReset, setCopiedReset] = useState(false);

    // Upload users modal
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [uploadFile, setUploadFile] = useState(null);
    const [uploadResult, setUploadResult] = useState(null);
    const [uploading, setUploading] = useState(false);

    // Add single user modal (any role)
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [addName, setAddName] = useState('');
    const [addEmail, setAddEmail] = useState('');
    const [addRegNumber, setAddRegNumber] = useState('');
    const [addRole, setAddRole] = useState('student');
    const [addIsActive, setAddIsActive] = useState(true);
    const [addLoading, setAddLoading] = useState(false);
    const [addResult, setAddResult] = useState(null);
    const [copiedAdd, setCopiedAdd] = useState(false);

    useEffect(() => {
        loadOverview();
        loadRecentUsers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshKey]);

    async function loadOverview() {
        setLoading(true);
        try {
            const res = await fetch('/api/it/overview', { cache: 'no-store' });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error || 'Failed to load overview');
            setStats(body.stats || {});
            setHealth(body.health || {});
        } catch (err) {
            console.warn('Overview load failed, falling back to /api/admin/stats', err);
            try {
                const r2 = await fetch('/api/admin/stats', { cache: 'no-store' });
                const b2 = await r2.json();
                if (b2.ok) {
                    setStats(b2.stats || {});
                    setHealth(b2.health || {});
                } else {
                    setStats(null);
                    setHealth(null);
                }
            } catch (e) {
                setStats(null);
                setHealth(null);
            }
        } finally {
            setLoading(false);
        }
    }

    async function loadRecentUsers() {
        try {
            const res = await fetch('/api/it/recent-users?limit=50', { cache: 'no-store' });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error || 'Failed to load recent users');
            setRecentUsers(body.users || []);
        } catch (err) {
            console.warn('Failed to load recent users, trying /api/admin/users/recent', err);
            try {
                const r2 = await fetch('/api/admin/users/recent?limit=50', { cache: 'no-store' });
                const b2 = await r2.json();
                if (b2.ok) setRecentUsers(b2.users || []);
                else setRecentUsers([]);
            } catch (e) {
                setRecentUsers([]);
            }
        }
    }

    function humanDate(d) {
        try {
            return new Date(d).toLocaleString();
        } catch {
            return String(d);
        }
    }

    // ---------- Reset password flow ----------
    async function submitReset() {
        if (!resetIdentifier.trim()) return alert('Enter email or reg number');
        setResetLoading(true);
        setResetResult(null);
        setCopiedReset(false);
        try {
            const res = await fetch('/api/it/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailOrReg: resetIdentifier.trim(), forceChange })
            });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error || 'Reset failed');

            setResetResult({ success: true, tempPassword: body.tempPassword, message: body.message });

            // Try to copy automatically; if not allowed, still show the password.
            try {
                if (navigator?.clipboard && body.tempPassword) {
                    await navigator.clipboard.writeText(body.tempPassword);
                    setCopiedReset(true);
                }
            } catch (e) {
                setCopiedReset(false);
            }
        } catch (err) {
            setResetResult({ success: false, message: err.message || 'Reset failed' });
        } finally {
            setResetLoading(false);
        }
    }

    async function copyPasswordToClipboard(pwd, which = 'reset') {
        try {
            await navigator.clipboard.writeText(pwd);
            if (which === 'reset') {
                setCopiedReset(true);
                setTimeout(() => setCopiedReset(false), 2500);
            } else {
                setCopiedAdd(true);
                setTimeout(() => setCopiedAdd(false), 2500);
            }
        } catch (e) {
            alert('Copy failed. Please highlight and copy manually.');
        }
    }

    // ---------- Upload users flow (CSV/Excel) ----------
    async function submitUpload() {
        if (!uploadFile) return alert('Select a file to upload');
        setUploading(true);
        setUploadResult(null);
        try {
            const form = new FormData();
            form.append('file', uploadFile);
            const res = await fetch('/api/it/upload-users', {
                method: 'POST',
                body: form,
            });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error || 'Upload failed');
            setUploadResult({ success: true, result: body.result || body });
            setRefreshKey(k => k + 1);
        } catch (err) {
            setUploadResult({ success: false, message: err.message || 'Upload failed' });
        } finally {
            setUploading(false);
        }
    }

    // ---------- Add single user flow ----------
    async function submitAddUser() {
        if (!addName.trim()) return alert('Name is required');
        if (addRole === 'student' && !addRegNumber.trim()) return alert('RegNumber is required for students');

        setAddLoading(true);
        setAddResult(null);
        setCopiedAdd(false);

        try {
            const payload = {
                name: addName.trim(),
                email: addEmail.trim() || undefined,
                regNumber: addRole === 'student' ? addRegNumber.trim() : undefined,
                role: addRole,
                isActive: !!addIsActive
            };
            const res = await fetch('/api/it/create-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error || 'Create failed');

            setAddResult({ success: true, user: body.user || body, tempPassword: body.tempPassword || null });
            setRefreshKey(k => k + 1);

            // auto-copy password if available
            try {
                if (navigator?.clipboard && body.tempPassword) {
                    await navigator.clipboard.writeText(body.tempPassword);
                    setCopiedAdd(true);
                }
            } catch (e) {
                setCopiedAdd(false);
            }
        } catch (err) {
            setAddResult({ success: false, message: err.message || 'Create failed' });
        } finally {
            setAddLoading(false);
        }
    }

    // ---------- Quick action: deactivate user ----------
    async function deactivateUser(id) {
        if (!confirm('Deactivate this user?')) return;
        setActionLoadingId(id);
        try {
            const res = await fetch(`/api/it/users/${encodeURIComponent(id)}/deactivate`, { method: 'POST' });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error || 'Deactivate failed');
            alert(body.message || 'User deactivated');
            setRefreshKey(k => k + 1);
        } catch (err) {
            alert(err.message || 'Deactivate failed');
        } finally {
            setActionLoadingId(null);
        }
    }

    // ---------- Quick action: activate user ----------
    async function activateUser(id) {
        if (!confirm('Activate this user?')) return;
        setActionLoadingId(id);
        try {
            const res = await fetch(`/api/it/users/${encodeURIComponent(id)}/activate`, { method: 'POST' });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error || 'Activate failed');
            alert(body.message || 'User activated');
            setRefreshKey(k => k + 1);
        } catch (err) {
            alert(err.message || 'Activate failed');
        } finally {
            setActionLoadingId(null);
        }
    }

    // ---------- Download CSV template (client-side) ----------
    function downloadTemplate() {
        const header = ['name', 'email', 'role', 'regNumber'];
        const sample = ['Jane Doe', 'jane.doe@school.local', 'student', 'ST2025-002'];
        const rows = [header.join(','), sample.join(',')].join('\r\n');
        const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'user-upload-template.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    // ---------- filtered users ----------
    const filteredUsers = useMemo(() => {
        if (!search.trim()) return recentUsers;
        const q = search.toLowerCase();
        return recentUsers.filter(
            (u) =>
                (u.name && u.name.toLowerCase().includes(q)) ||
                (u.email && u.email.toLowerCase().includes(q)) ||
                (u.regNumber && u.regNumber.toLowerCase().includes(q))
        );
    }, [recentUsers, search]);

    return (
        <div className="p-4 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-100">IT Dashboard</h1>
                    <p className="text-sm text-slate-300">System health, user management, and quick IT tools.</p>
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                    <button
                        onClick={() => { setRefreshKey(k => k + 1); }}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded bg-slate-700 text-slate-200 text-sm"
                        title="Refresh"
                    >
                        <FiRefreshCw /> Refresh
                    </button>

                    <button
                        onClick={() => setIsResetOpen(true)}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded bg-amber-500 text-black text-sm"
                        title="Reset password"
                    >
                        <FiKey /> Reset password
                    </button>

                    <button
                        onClick={() => setIsUploadOpen(true)}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded bg-cyan-500 text-white text-sm"
                        title="Upload users"
                    >
                        <FiUpload /> Upload users
                    </button>

                    <button
                        onClick={() => setIsAddOpen(true)}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded bg-emerald-500 text-black text-sm"
                        title="Add user"
                    >
                        <FiPlus /> Add user
                    </button>
                </div>
            </div>

            {/* Overview cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-slate-400">Total users</div>
                            <div className="text-2xl font-semibold text-slate-100">{stats?.usersCount ?? '—'}</div>
                        </div>
                        <div className="text-slate-400"><FiUser size={28} /></div>
                    </div>
                </div>

                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-slate-400">Active orders</div>
                            <div className="text-2xl font-semibold text-slate-100">{stats?.activeOrders ?? '—'}</div>
                        </div>
                        <div className="text-slate-400"><FiClock size={28} /></div>
                    </div>
                </div>

                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-slate-400">Menu items</div>
                            <div className="text-2xl font-semibold text-slate-100">{stats?.productsCount ?? '—'}</div>
                        </div>
                        <div className="text-slate-400"><FiDatabase size={28} /></div>
                    </div>
                </div>

                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-slate-400">Prep stations / windows</div>
                            <div className="text-lg font-medium text-slate-100">
                                {stats?.prepStations ?? '—'} / {stats?.windows ?? '—'}
                            </div>
                        </div>
                        <div className="text-slate-400"><FiCheckCircle size={28} /></div>
                    </div>
                </div>
            </div>

            {/* Health & quick actions */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="col-span-2 bg-slate-800 border border-slate-700 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-slate-100 mb-2">System health</h3>
                    {health ? (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="bg-slate-700 p-3 rounded">
                                <div className="text-xs text-slate-400">DB Status</div>
                                <div className={`text-sm font-medium ${health.db === 'ok' ? 'text-emerald-300' : 'text-amber-400'}`}>{health.db ?? 'unknown'}</div>
                                <div className="text-xs text-slate-400 mt-1">Last ping: {humanDate(health.lastPing)}</div>
                            </div>

                            <div className="bg-slate-700 p-3 rounded">
                                <div className="text-xs text-slate-400">Uptime</div>
                                <div className="text-sm font-medium text-slate-100">{Math.floor((health.uptimeSec || 0) / 60)} min</div>
                                <div className="text-xs text-slate-400 mt-1">Started: {humanDate(health.startedAt)}</div>
                            </div>

                            <div className="bg-slate-700 p-3 rounded">
                                <div className="text-xs text-slate-400">Last backup</div>
                                <div className="text-sm font-medium text-slate-100">{health.lastBackup ? humanDate(health.lastBackup) : 'never'}</div>
                                <div className="text-xs text-slate-400 mt-1">Status: {health.backupStatus || '—'}</div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-sm text-slate-400">Health data not available.</div>
                    )}

                    <div className="mt-4 flex gap-2 flex-wrap">
                        <button
                            onClick={() => { setRefreshKey(k => k + 1); }}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded bg-slate-700 text-slate-200 text-sm"
                        >
                            <FiRefreshCw /> Refresh health
                        </button>
                    </div>
                </div>

                {/* Quick tools */}
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-slate-100 mb-2">Quick tools</h3>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-sm text-slate-300">Force password reset</div>
                                <div className="text-xs text-slate-400">Create a temporary password for a user</div>
                            </div>
                            <button onClick={() => setIsResetOpen(true)} className="px-3 py-1 rounded bg-amber-500 text-black inline-flex items-center gap-2 text-sm">
                                <FiKey /> Reset
                            </button>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-sm text-slate-300">Upload users (CSV/Excel)</div>
                                <div className="text-xs text-slate-400">Validated server-side, template-driven</div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setIsUploadOpen(true)} className="px-3 py-1 rounded bg-cyan-500 text-white inline-flex items-center gap-2 text-sm">
                                    <FiUpload /> Upload
                                </button>
                                <button onClick={downloadTemplate} className="px-3 py-1 rounded bg-slate-700 text-slate-200 inline-flex items-center gap-2 text-sm">
                                    <FiDownload /> Template
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-sm text-slate-300">Recent user activity</div>
                                <div className="text-xs text-slate-400">View latest signups</div>
                            </div>
                            <button onClick={() => setRefreshKey(k => k + 1)} className="px-3 py-1 rounded bg-slate-700 text-slate-200 inline-flex items-center gap-2 text-sm">
                                <FiRefreshCw /> Refresh
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Recent users */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-3">
                    <h3 className="text-lg font-semibold text-slate-100">Recent users</h3>
                    <input
                        type="text"
                        placeholder="Search users..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="px-3 py-2 rounded bg-slate-900 text-slate-100 text-sm w-full sm:w-64"
                    />
                </div>

                {filteredUsers.length === 0 ? (
                    <div className="text-sm text-slate-400">No users found.</div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filteredUsers.map((u) => (
                            <div key={u._id} className="bg-slate-700 p-3 rounded flex flex-col">
                                <div className="flex items-start justify-between">
                                    <div className="min-w-0">
                                        <div className="text-slate-100 font-medium truncate">{u.name || u.email || 'Unknown'}</div>
                                        <div className="text-xs text-slate-300 truncate">{u.email || u.regNumber || '—'}</div>
                                        <div className="text-xs text-slate-400 mt-2">
                                            Role: <span className="font-medium text-slate-100">{u.role}</span>
                                        </div>
                                        <div className="text-xs mt-1">
                                            {u.isActive ? (
                                                <span className="px-2 py-0.5 rounded bg-emerald-600 text-emerald-100 text-[11px]">Active</span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded bg-red-700 text-red-100 text-[11px]">Inactive</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="text-slate-400">
                                        <FiUser size={24} />
                                    </div>
                                </div>

                                <div className="mt-3 text-xs text-slate-400">Joined: {humanDate(u.createdAt)}</div>

                                <div className="mt-3 flex gap-2">
                                    <button
                                        onClick={() => { setResetIdentifier(u.email || u.regNumber || ''); setIsResetOpen(true); }}
                                        className="px-2 py-1 rounded bg-amber-500 text-black text-sm inline-flex items-center gap-2"
                                        disabled={actionLoadingId === u._id}
                                    >
                                        <FiKey /> Reset
                                    </button>

                                    {u.isActive ? (
                                        <button
                                            onClick={() => deactivateUser(u._id)}
                                            className="px-2 py-1 rounded bg-red-700 text-white text-sm inline-flex items-center gap-2"
                                            disabled={actionLoadingId === u._id}
                                        >
                                            <FiAlertCircle /> {actionLoadingId === u._id ? 'Working…' : 'Deactivate'}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => activateUser(u._id)}
                                            className="px-2 py-1 rounded bg-emerald-500 text-black text-sm inline-flex items-center gap-2"
                                            disabled={actionLoadingId === u._id}
                                        >
                                            <FiCheckCircle /> {actionLoadingId === u._id ? 'Working…' : 'Activate'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Reset password modal */}
            <Modal
                open={isResetOpen}
                title="Reset user password"
                onClose={() => { setIsResetOpen(false); setResetResult(null); setResetIdentifier(''); setForceChange(true); setCopiedReset(false); }}
                footer={
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => { setIsResetOpen(false); }} className="px-3 py-2 rounded bg-slate-700 text-slate-200">Cancel</button>
                        <button onClick={submitReset} disabled={resetLoading} className="px-3 py-2 rounded bg-amber-500 text-black">
                            {resetLoading ? 'Working…' : 'Reset password'}
                        </button>
                    </div>
                }
            >
                <div>
                    <label className="text-xs text-slate-400">Email or RegNumber</label>
                    <input className="w-full p-2 bg-slate-900 rounded text-slate-100 mt-1" value={resetIdentifier} onChange={(e) => setResetIdentifier(e.target.value)} placeholder="user@example.local or ST2025-001" />
                </div>

                <div className="flex items-center gap-3">
                    <input id="force-change" type="checkbox" checked={forceChange} onChange={(e) => setForceChange(e.target.checked)} />
                    <label htmlFor="force-change" className="text-sm text-slate-300">Force password change on next login</label>
                </div>

                {resetResult && (
                    <div className={`p-3 rounded ${resetResult.success ? 'bg-emerald-900' : 'bg-red-900'}`}>
                        {resetResult.success ? (
                            <>
                                <div className="text-sm text-emerald-200">Password reset successful.</div>

                                <div className="mt-2 text-xs text-slate-100">Temporary password (deliver securely):</div>
                                <div className="mt-2 flex gap-2">
                                    <input
                                        readOnly
                                        value={resetResult.tempPassword || ''}
                                        className="flex-1 p-2 bg-slate-900 rounded font-mono text-slate-100"
                                    />
                                    <button
                                        onClick={() => copyPasswordToClipboard(resetResult.tempPassword || '', 'reset')}
                                        className="px-3 py-2 rounded bg-slate-700 text-slate-200 inline-flex items-center gap-2"
                                        title="Copy password"
                                    >
                                        <FiClipboard /> {copiedReset ? 'Copied' : 'Copy'}
                                    </button>
                                </div>

                                {resetResult.message && <div className="mt-2 text-xs text-slate-300">{resetResult.message}</div>}
                                <div className="mt-2 text-xs text-amber-200">Note: password is shown once — copy & deliver to the user securely.</div>
                            </>
                        ) : (
                            <div className="text-sm text-red-200">{resetResult.message || 'Reset failed'}</div>
                        )}
                    </div>
                )}
            </Modal>

            {/* Upload users modal */}
            <Modal
                open={isUploadOpen}
                title="Upload users (CSV / Excel)"
                onClose={() => { setIsUploadOpen(false); setUploadFile(null); setUploadResult(null); }}
                footer={
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => { setIsUploadOpen(false); }} className="px-3 py-2 rounded bg-slate-700 text-slate-200">Cancel</button>
                        <button onClick={submitUpload} disabled={uploading} className="px-3 py-2 rounded bg-cyan-500 text-white">
                            {uploading ? 'Uploading…' : 'Upload file'}
                        </button>
                    </div>
                }
            >
                <div>
                    <div className="text-sm text-slate-300 mb-2">Choose a CSV or Excel file (use the provided template). Server will validate and return results.</div>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-3">
                        <input
                            type="file"
                            accept=".csv,.xls,.xlsx"
                            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                            className="text-sm text-slate-300"
                        />

                        <div className="flex gap-2">
                            <button onClick={downloadTemplate} className="px-3 py-1 rounded bg-slate-700 text-slate-200 inline-flex items-center gap-2 text-sm">
                                <FiDownload /> Download template
                            </button>
                            <button onClick={() => { /* show example result link, not implemented */ }} className="px-3 py-1 rounded bg-slate-700 text-slate-200 inline-flex items-center gap-2 text-sm">
                                Example CSV
                            </button>
                        </div>
                    </div>
                </div>

                {uploadResult && (
                    <div className={`p-3 rounded ${uploadResult.success ? 'bg-emerald-900' : 'bg-red-900'}`}>
                        {uploadResult.success ? (
                            <>
                                <div className="text-sm text-emerald-200">Upload successful.</div>
                                <pre className="mt-2 text-xs text-slate-100 max-h-40 overflow-auto">{JSON.stringify(uploadResult.result, null, 2)}</pre>
                            </>
                        ) : (
                            <div className="text-sm text-red-200">{uploadResult.message || 'Upload failed'}</div>
                        )}
                    </div>
                )}
            </Modal>

            {/* Add user modal (any role) */}
            <Modal
                open={isAddOpen}
                title="Add new user"
                onClose={() => {
                    setIsAddOpen(false);
                    setAddName('');
                    setAddEmail('');
                    setAddRegNumber('');
                    setAddRole('student');
                    setAddIsActive(true);
                    setAddResult(null);
                    setCopiedAdd(false);
                }}
                footer={
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => { setIsAddOpen(false); }} className="px-3 py-2 rounded bg-slate-700 text-slate-200">Cancel</button>
                        <button onClick={submitAddUser} disabled={addLoading} className="px-3 py-2 rounded bg-emerald-500 text-black">
                            {addLoading ? 'Creating…' : 'Create user'}
                        </button>
                    </div>
                }
            >
                <div className="grid grid-cols-1 gap-3">
                    <div>
                        <label className="text-xs text-slate-400">Full name</label>
                        <input value={addName} onChange={(e) => setAddName(e.target.value)} className="w-full p-2 bg-slate-900 rounded text-slate-100 mt-1" placeholder="Jane Doe" />
                    </div>

                    <div>
                        <label className="text-xs text-slate-400">Email (optional)</label>
                        <input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} className="w-full p-2 bg-slate-900 rounded text-slate-100 mt-1" placeholder="jane.doe@school.local" />
                    </div>

                    <div>
                        <label className="text-xs text-slate-400">Role</label>
                        <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className="w-full p-2 bg-slate-900 rounded text-slate-100 mt-1">
                            <option value="student">Student</option>
                            <option value="admin">Admin</option>
                            <option value="it">IT</option>
                            <option value="canteen">Canteen Operator</option>
                            <option value="external">External (cash)</option>
                        </select>
                        <div className="text-xs text-slate-500 mt-1">Choose role — password behavior depends on role.</div>
                    </div>

                    {addRole === 'student' && (
                        <div>
                            <label className="text-xs text-slate-400">RegNumber</label>
                            <input value={addRegNumber} onChange={(e) => setAddRegNumber(e.target.value)} className="w-full p-2 bg-slate-900 rounded text-slate-100 mt-1" placeholder="ST2025-003" />
                            <div className="text-xs text-slate-400 mt-1">For <span className="font-medium">student</span>, RegNumber is required and will be used as the temporary password.</div>
                        </div>
                    )}

                    {addRole !== 'student' && (
                        <div className="text-xs text-slate-400">
                            For non-student roles the system will generate a temporary password and show it after creation.
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <input id="add-active" type="checkbox" checked={addIsActive} onChange={(e) => setAddIsActive(e.target.checked)} />
                        <label htmlFor="add-active" className="text-sm text-slate-300">Activate user</label>
                    </div>
                </div>

                {addResult && (
                    <div className={`p-3 rounded ${addResult.success ? 'bg-emerald-900' : 'bg-red-900'}`}>
                        {addResult.success ? (
                            <>
                                <div className="text-sm text-emerald-200">User created successfully.</div>
                                <div className="mt-2 text-xs text-slate-100">Name: <span className="font-medium">{addResult.user?.name || addName}</span></div>
                                <div className="mt-1 text-xs text-slate-100">Role: <span className="font-mono">{addResult.user?.role || addRole}</span></div>
                                {addResult.user?.regNumber && <div className="mt-1 text-xs text-slate-100">RegNumber: <span className="font-mono">{addResult.user.regNumber}</span></div>}

                                <div className="mt-2 text-xs text-slate-100">Temporary password:</div>
                                <div className="mt-2 flex gap-2">
                                    <input readOnly value={addResult.tempPassword || ''} className="flex-1 p-2 bg-slate-900 rounded font-mono text-slate-100" />
                                    <button onClick={() => copyPasswordToClipboard(addResult.tempPassword || '', 'add')} className="px-3 py-2 rounded bg-slate-700 text-slate-200 inline-flex items-center gap-2">
                                        <FiClipboard /> {copiedAdd ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                                <div className="mt-2 text-xs text-slate-300">Copy and deliver this password to the user securely.</div>
                            </>
                        ) : (
                            <div className="text-sm text-red-200">{addResult.message || 'Create failed'}</div>
                        )}
                    </div>
                )}
            </Modal>
        </div>
    );
}
