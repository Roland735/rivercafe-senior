// app/admin/page.jsx
'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import StatCard from '../components/admin/StatCard';
import { FiTrendingUp, FiClock, FiAlertTriangle, FiCode, FiMenu, FiX } from 'react-icons/fi';

function formatCurrency(n) {
    try {
        return new Intl.NumberFormat('en-ZW', { style: 'currency', currency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || 'USD' }).format(n);
    } catch (e) {
        return `${n}`;
    }
}

export default function AdminHome() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const pollingRef = useRef(null);

    const fetchStats = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/stats', { cache: 'no-store' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body?.error || `Status ${res.status}`);
            }
            const data = await res.json();
            if (!data.ok) throw new Error(data?.error || 'Invalid response');
            setStats(data.stats);
        } catch (err) {
            console.error('Failed to fetch admin stats', err);
            setError(err.message || 'Failed to load stats');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // initial fetch
        fetchStats();

        // poll every 5 seconds for live-ish updates
        pollingRef.current = setInterval(fetchStats, 5000);

        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, []);

    return (
        <section className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-100">Dashboard</h1>
                    <p className="text-sm text-slate-300">Quick overview of the canteen right now</p>
                </div>
                <div className="w-full sm:w-auto">
                    <Link href="/admin/menu" className="inline-block w-full sm:w-auto text-center bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition-colors duration-200">
                        Go to Menu
                    </Link>
                </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                <StatCard
                    title="Today's revenue"
                    value={loading ? 'Loading...' : error ? '—' : formatCurrency(stats?.todaysRevenueValue ?? 0)}
                    icon={<FiTrendingUp className="text-red-400" />}
                    loading={loading}
                    error={error}
                />
                <StatCard
                    title="Active orders"
                    value={loading ? 'Loading...' : error ? '—' : (stats?.activeOrders ?? 0)}
                    icon={<FiClock className="text-red-400" />}
                    loading={loading}
                    error={error}
                />
                <StatCard
                    title="Low balance alerts"
                    value={loading ? 'Loading...' : error ? '—' : (stats?.lowBalanceAlerts ?? 0)}
                    icon={<FiAlertTriangle className="text-red-400" />}
                    loading={loading}
                    error={error}
                />
                <StatCard
                    title="Pending external codes"
                    value={loading ? 'Loading...' : error ? '—' : (stats?.pendingExternalCodes ?? 0)}
                    icon={<FiCode className="text-red-400" />}
                    loading={loading}
                    error={error}
                />
            </div>

            {error && (
                <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-200 text-sm">
                    Error loading stats: {error}
                </div>
            )}

            {/* Recent activity / quick links */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="col-span-2 bg-slate-800 border border-slate-700 rounded-xl p-4 md:p-6">
                    <h2 className="font-semibold text-slate-100 mb-4 text-lg">Recent Orders</h2>
                    <div className="bg-slate-900/50 rounded-lg p-4 text-center">
                        <div className="text-sm text-slate-400 mb-2">Real-time order tracking</div>
                        <div className="text-xs text-slate-500">Order list will appear here (use Socket.IO/Websockets)</div>
                    </div>
                </div>

                <aside className="bg-slate-800 border border-slate-700 rounded-xl p-4 md:p-6">
                    <h3 className="font-semibold text-slate-100 mb-4 text-lg">Quick Actions</h3>
                    <ul className="space-y-3">
                        <li>
                            <Link
                                href="/admin/accounting"
                                className="flex items-center p-3 rounded-lg bg-slate-900/50 hover:bg-slate-700/50 transition-colors duration-200 group"
                            >
                                <span className="text-red-300 group-hover:text-red-400 mr-2">→</span>
                                <span className="text-sm text-slate-200 group-hover:text-white">View accounting reports</span>
                            </Link>
                        </li>
                        <li>
                            <Link
                                href="/admin/menu"
                                className="flex items-center p-3 rounded-lg bg-slate-900/50 hover:bg-slate-700/50 transition-colors duration-200 group"
                            >
                                <span className="text-red-300 group-hover:text-red-400 mr-2">→</span>
                                <span className="text-sm text-slate-200 group-hover:text-white">Edit menu</span>
                            </Link>
                        </li>
                        <li>
                            <Link
                                href="/admin/settings"
                                className="flex items-center p-3 rounded-lg bg-slate-900/50 hover:bg-slate-700/50 transition-colors duration-200 group"
                            >
                                <span className="text-red-300 group-hover:text-red-400 mr-2">→</span>
                                <span className="text-sm text-slate-200 group-hover:text-white">Ordering windows & settings</span>
                            </Link>
                        </li>
                    </ul>
                </aside>
            </div>
        </section>
    );
}