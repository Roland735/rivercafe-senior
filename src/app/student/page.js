// app/(student)/page.jsx
'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

function fmtCurrency(n) {
    try {
        return new Intl.NumberFormat('en-ZW', {
            style: 'currency',
            currency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || 'USD'
        }).format(n);
    } catch (e) {
        return `${n}`;
    }
}

export default function StudentHome() {
    const [profile, setProfile] = useState(null);
    const [windowInfo, setWindowInfo] = useState([]);
    const [loading, setLoading] = useState(true);

    // dev login UI state
    const [showDevLogin, setShowDevLogin] = useState(false);
    const [devRegInput, setDevRegInput] = useState(() => {
        try { return localStorage.getItem('rivercafe_dev_reg') || ''; } catch (e) { return ''; }
    });
    const [devMessage, setDevMessage] = useState('');

    async function fetchOrderingWindows() {
        try {
            const windowRes = await fetch('/api/ordering-windows', { cache: 'no-store' });
            const wBody = await windowRes.json();
            if (!wBody.ok) throw new Error(wBody.error || 'Failed to load windows');
            setWindowInfo(wBody.windows || []);
        } catch (err) {
            console.error('Failed to load ordering windows', err);
            setWindowInfo([]);
        }
    }

    async function tryFetchMeWithReg(reg) {
        // helper to fetch /api/student/me?regNumber=...
        const encoded = encodeURIComponent(reg);
        const res = await fetch(`/api/student/me?regNumber=${encoded}`, { cache: 'no-store', credentials: 'same-origin' });
        const body = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
        return { status: res.status, body };
    }

    async function load() {
        setLoading(true);
        setDevMessage('');
        try {
            // 1) normal attempt (session token). include credentials explicitly to ensure cookies are sent.
            let meRes = await fetch('/api/student/me', { cache: 'no-store', credentials: 'same-origin' });

            // 2) if unauthenticated (401) try automatic dev reg from env
            if (meRes.status === 401) {
                const envReg = process.env.NEXT_PUBLIC_DEV_USER_REG;
                const locallySaved = (() => {
                    try { return localStorage.getItem('rivercafe_dev_reg'); } catch (e) { return null; }
                })();

                if (envReg) {
                    // retry with env-provided reg (dev convenience)
                    const { status, body } = await tryFetchMeWithReg(envReg);
                    if (status === 200 && body.ok) {
                        setProfile(body.profile);
                    } else {
                        // show dev login if retry failed
                        setShowDevLogin(true);
                        setDevMessage('Dev env fallback used, but the regNumber returned no user. Try another reg.');
                    }
                } else if (locallySaved) {
                    // retry with locally stored reg
                    const { status, body } = await tryFetchMeWithReg(locallySaved);
                    if (status === 200 && body.ok) {
                        setProfile(body.profile);
                    } else {
                        // stored reg invalid -> prompt user
                        setShowDevLogin(true);
                        setDevMessage('Saved dev reg did not match any user — enter a different reg below.');
                    }
                } else {
                    // no env, no saved reg -> show dev login UI
                    setShowDevLogin(true);
                }
            } else if (meRes.ok) {
                // parse response when status is 2xx
                const meBody = await meRes.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
                if (!meBody.ok) throw new Error(meBody.error || 'Failed to load profile');
                setProfile(meBody.profile);
            } else {
                // non-401 non-2xx case: surface message and optionally show dev login
                const errBody = await meRes.json().catch(() => ({ ok: false, error: `Server returned ${meRes.status}` }));
                console.warn('Unexpected response from /api/student/me', meRes.status, errBody);
                // show dev login UI in dev environment, otherwise leave profile null
                if (process.env.NODE_ENV !== 'production') {
                    setShowDevLogin(true);
                    setDevMessage(errBody.error || `Unexpected response (${meRes.status})`);
                }
            }

            // load windows in parallel (we don't block on profile)
            fetchOrderingWindows();
        } catch (err) {
            console.error('StudentHome.load error', err);
            // If the normal flow failed for other reasons, still try windows
            await fetchOrderingWindows();
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    const now = new Date();
    function isWindowActive(w) {
        try {
            if (!w.active) return false;
            const day = now.getDay();
            if (w.daysOfWeek && w.daysOfWeek.length && !w.daysOfWeek.includes(day)) return false;
            const pad = (n) => (n < 10 ? '0' + n : '' + n);
            const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
            return (!w.startTime || w.startTime <= hhmm) && (!w.endTime || hhmm <= w.endTime);
        } catch (e) {
            return false;
        }
    }

    const activeWindows = windowInfo.filter(isWindowActive);

    // dev-login submit handler
    async function handleDevLoginSubmit(e) {
        e.preventDefault();
        const reg = devRegInput?.trim();
        if (!reg) {
            setDevMessage('Please enter a registration number to continue in dev mode.');
            return;
        }

        setDevMessage('Trying reg...'); // quick UI feedback
        try {
            const { status, body } = await tryFetchMeWithReg(reg);
            if (status === 200 && body.ok) {
                // success: store and set profile
                try { localStorage.setItem('rivercafe_dev_reg', reg); } catch (err) { /* ignore */ }
                setProfile(body.profile);
                setShowDevLogin(false);
                setDevMessage('Signed in using dev reg (stored in localStorage).');
                // fetch windows as well
                fetchOrderingWindows();
            } else if (status === 404 || (body && body.error)) {
                setDevMessage(body?.error || 'User not found for this reg.');
            } else {
                setDevMessage('Unexpected response when trying reg. See console for details.');
                console.warn('Dev login unexpected response', status, body);
            }
        } catch (err) {
            console.error('Dev login failed', err);
            setDevMessage('Network or server error while trying reg.');
        }
    }

    return (
        <section className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Welcome{profile ? `, ${profile.name}` : ''}</h1>
                    <p className="text-sm text-slate-300">Your balance and quick actions.</p>
                </div>
                <div>
                    <Link href="/(student)/order" className="bg-cyan-500 hover:bg-cyan-600 px-3 py-2 rounded text-white">Place order</Link>
                </div>
            </div>

            {showDevLogin && (
                <div className="bg-yellow-900/10 border border-yellow-700 p-4 rounded">
                    <div className="text-sm text-yellow-200 mb-2">
                        Dev mode: no session detected. Enter a student registration number to continue in development.
                    </div>
                    <form onSubmit={handleDevLoginSubmit} className="flex gap-2">
                        <input
                            value={devRegInput}
                            onChange={(e) => setDevRegInput(e.target.value)}
                            placeholder="Enter reg number (dev only)"
                            className="p-2 bg-slate-900 rounded text-slate-100 flex-1"
                        />
                        <button type="submit" className="px-3 py-2 rounded bg-amber-500 hover:bg-amber-600">Use</button>
                        <button type="button" onClick={() => { setDevRegInput(''); setDevMessage(''); try { localStorage.removeItem('rivercafe_dev_reg'); } catch (e) { } }} className="px-3 py-2 rounded border">Clear</button>
                    </form>
                    {devMessage && <div className="mt-2 text-sm text-yellow-200">{devMessage}</div>}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-800 p-4 rounded">
                    <div className="text-sm text-slate-300">Balance</div>
                    <div className="mt-2 text-2xl font-semibold">{profile ? fmtCurrency(profile.balance) : (loading ? 'Loading…' : '—')}</div>
                    <div className="mt-3 text-sm text-slate-400">Quick favourites and top-ups will appear here.</div>
                </div>

                <div className="bg-slate-800 p-4 rounded col-span-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-slate-300">Ordering Window</div>
                            <div className="mt-1 text-lg font-medium">{activeWindows.length ? `${activeWindows.map(w => w.name).join(', ')}` : 'No active ordering window'}</div>
                        </div>
                        <div>
                            <Link href="/(student)/order" className="text-sm text-cyan-300">View menu & order →</Link>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
