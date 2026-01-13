// app/reset-password/page.jsx
'use client';

import React, { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { FiEye, FiEyeOff, FiLock, FiCheckCircle } from 'react-icons/fi';

export default function ResetMyPasswordPage() {
    const { data: session, status } = useSession();
    const loadingSession = status === 'loading';

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);

    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null); // { type: 'success'|'error', text }

    // quick password rules (client-side)
    function validateNewPassword(p) {
        if (!p || p.length < 8) return 'Password should be at least 8 characters';
        // add extra client-side checks as you like (numbers, symbols, etc)
        return null;
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setMessage(null);

        const ruleErr = validateNewPassword(newPassword);
        if (ruleErr) {
            setMessage({ type: 'error', text: ruleErr });
            return;
        }
        if (newPassword !== confirm) {
            setMessage({ type: 'error', text: 'New password and confirmation do not match' });
            return;
        }

        // If user isn't logged in, prompt signin
        if (!session?.user?.id) {
            setMessage({ type: 'error', text: 'You must be signed in to change your password' });
            return;
        }

        setBusy(true);
        try {
            const res = await fetch('/api/user/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ currentPassword: currentPassword.trim(), newPassword: newPassword.trim() })
            });

            const body = await res.json();
            if (!res.ok) {
                setMessage({ type: 'error', text: body?.error || (body?.message ? body.message : 'Failed to change password') });
            } else {
                // success
                setMessage({ type: 'success', text: body.message || 'Password changed successfully' });
                setCurrentPassword('');
                setNewPassword('');
                setConfirm('');
                // Optionally sign the user in again or refresh session — next-auth stores JWT with user info.
                // If you want to re-sync session data:
                // await signIn(undefined, { redirect: false });
            }
        } catch (err) {
            setMessage({ type: 'error', text: String(err?.message || err) });
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900">
            <div className="w-full max-w-xl bg-slate-800 border border-slate-700 rounded-2xl p-6">
                <h1 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
                    <FiLock /> Reset your password
                </h1>
                <p className="text-sm text-slate-300 mt-1">Change your account password. For accounts created via SSO, you&apos;ll set a local password (if allowed).</p>

                <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                    <div>
                        <label className="text-xs text-slate-400 mb-1 block">Current password</label>
                        <div className="relative">
                            <input
                                type={showCurrent ? 'text' : 'password'}
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                placeholder="Current password (leave blank if none)"
                                className="w-full p-3 bg-slate-900 rounded text-slate-100"
                                autoComplete="current-password"
                                disabled={busy || loadingSession}
                            />
                            <button
                                type="button"
                                onClick={() => setShowCurrent(s => !s)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-300"
                                aria-label="Toggle show current password"
                            >
                                {showCurrent ? <FiEyeOff /> : <FiEye />}
                            </button>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">If your account was created with an external provider you may not have a current password — leave blank to set one if allowed.</div>
                    </div>

                    <div>
                        <label className="text-xs text-slate-400 mb-1 block">New password</label>
                        <div className="relative">
                            <input
                                type={showNew ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="At least 8 characters"
                                className="w-full p-3 bg-slate-900 rounded text-slate-100"
                                autoComplete="new-password"
                                disabled={busy || loadingSession}
                            />
                            <button
                                type="button"
                                onClick={() => setShowNew(s => !s)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-300"
                                aria-label="Toggle show new password"
                            >
                                {showNew ? <FiEyeOff /> : <FiEye />}
                            </button>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">Use a strong password you don&apos;t use elsewhere.</div>
                    </div>

                    <div>
                        <label className="text-xs text-slate-400 mb-1 block">Confirm new password</label>
                        <input
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            placeholder="Confirm new password"
                            className="w-full p-3 bg-slate-900 rounded text-slate-100"
                            autoComplete="new-password"
                            disabled={busy || loadingSession}
                        />
                    </div>

                    {message && (
                        <div className={`p-3 rounded ${message.type === 'success' ? 'bg-emerald-900 text-emerald-200' : 'bg-red-900 text-red-200'}`}>
                            {message.type === 'success' ? <div className="flex items-center gap-2"><FiCheckCircle /> {message.text}</div> : <div>{message.text}</div>}
                        </div>
                    )}

                    <div className="flex justify-between items-center gap-3">
                        <button
                            type="submit"
                            className="px-4 py-2 rounded bg-emerald-500 text-black font-medium disabled:opacity-60"
                            disabled={busy || loadingSession}
                        >
                            {busy ? 'Updating…' : 'Change password'}
                        </button>
                        <button
                            type="button"
                            className="text-xs text-slate-400 hover:underline"
                            onClick={() => signIn()}
                        >
                            Re-enter credentials / sign in
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
