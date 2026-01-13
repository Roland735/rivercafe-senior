// app/(admin)/ClientAdminLayout.jsx
'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Sidebar from '../components/admin/StudentSidebar';
import StudentHeader from '../components/admin/StudentHeader';


export default function ClientAdminLayout({ children }) {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth < 1024;
            setIsMobile(mobile);
            // On mobile, sidebar starts collapsed
            if (mobile) {
                setSidebarCollapsed(true);
            }
        };

        checkMobile();
        window.addEventListener('resize', checkMobile);

        return () => {
            window.removeEventListener('resize', checkMobile);
        };
    }, []);

    const toggleSidebar = () => {
        setSidebarCollapsed(!sidebarCollapsed);
    };

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex">
            {/* Sidebar */}
            <Sidebar
                isCollapsed={isMobile ? !sidebarCollapsed : sidebarCollapsed}
                toggleSidebar={toggleSidebar}
                onItemClick={() => {
                    if (isMobile) setSidebarCollapsed(true);
                }}
            />

            {/* Main content area */}
            <div className={`flex-1 flex flex-col transition-all duration-300 ${sidebarCollapsed && !isMobile ? 'lg:ml-0' : 'lg:ml-0'}`}>
                {/* Header */}
                <header className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-800 bg-slate-900/95 backdrop-blur-md">
                    <div className="flex items-center">
                        <div>
                            <h1 className="text-xl font-semibold text-slate-100">Student Dashboard</h1>
                            <p className="text-xs text-red-600">Aspire <span className='text-slate-50'>|</span> Achieve <span className='text-slate-50'>|</span> Succeed</p>
                        </div>
                    </div>

                    <StudentHeader toggleSidebar={toggleSidebar} />
                </header>

                {/* Content */}
                <main className="flex-1 p-4 sm:p-6 overflow-auto">
                    {children}
                </main>
            </div>
        </div>
    );
}