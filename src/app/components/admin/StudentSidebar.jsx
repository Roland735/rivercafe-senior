// components/student/Sidebar.jsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FiHome,
  FiList,
  FiFileText,
  FiSettings,
  FiUsers,
  FiShoppingCart,
  FiBarChart,
  FiChevronLeft,
  FiLogOut,
  FiMenu,
} from "react-icons/fi";
import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";

export default function Sidebar({ isCollapsed, toggleSidebar, onItemClick }) {
  const pathname = usePathname() || "/";
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  const items = [
    { href: "/student", label: "Dashboard", icon: <FiHome /> },
    {
      href: "/student/order",
      label: "Orders",
      icon: <FiShoppingCart />,
    },
    { href: "/student/transactions", label: "Transactions", icon: <FiList /> },
    {
      href: "/student/reset-password",
      label: "Reset Password",
      icon: <FiList />,
    },
  ];

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && !isCollapsed && (
        <div
          className="fixed inset-0 bg-slate-900/80 z-40 lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      <aside
        className={`
        fixed lg:sticky top-0 h-screen z-50 bg-gradient-to-b from-slate-800 to-slate-900 border-r border-slate-700 
        transform transition-all duration-300 ease-in-out
        ${isCollapsed ? "w-20" : "w-72"}
        ${isMobile ? (isCollapsed ? "-translate-x-full" : "translate-x-0") : ""}
      `}
      >
        {/* Sidebar header */}
        <div
          className={`p-4 flex items-center justify-between border-b border-slate-700 ${
            isCollapsed ? "flex-col" : ""
          }`}
        >
          {!isCollapsed ? (
            <Link href="/" className="inline-block">
              <h2 className="text-xl font-bold text-slate-100 bg-gradient-to-r from-red-500 to-red-600 bg-clip-text text-transparent">
                River'Café
              </h2>
              <p className="text-xs text-slate-400 mt-1">Student Console</p>
            </Link>
          ) : (
            <Link
              href="/"
              className="p-2 rounded-lg bg-red-600/10 flex items-center justify-center"
            >
              <span className="text-lg text-red-400 font-bold">R</span>
            </Link>
          )}

          <button
            onClick={toggleSidebar}
            className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-700/50 transition-colors duration-200"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <FiMenu size={20} /> : <FiChevronLeft size={20} />}
          </button>
        </div>

        {/* Navigation items */}
        <nav className="mt-6 px-2">
          <ul className="space-y-1">
            {items.map((it) => {
              const active =
                pathname === it.href || pathname.startsWith(it.href + "/");
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => {
                      onItemClick();
                      if (isMobile) toggleSidebar();
                    }}
                    className={`flex items-center rounded-lg transition-all duration-200 group
                      ${isCollapsed ? "justify-center p-3" : "p-3 gap-3"}
                      ${
                        active
                          ? "bg-red-900/20 text-red-400 shadow-lg shadow-red-900/10"
                          : "text-slate-300 hover:bg-slate-700/50 hover:text-slate-100"
                      }`}
                    title={isCollapsed ? it.label : ""}
                  >
                    <span className="text-lg">{it.icon}</span>
                    {!isCollapsed && (
                      <span className="text-sm font-medium">{it.label}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Sidebar footer */}
        <div
          className={`absolute bottom-0 w-full p-4 border-t border-slate-700 ${
            isCollapsed ? "px-2" : ""
          }`}
        >
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className={`flex items-center w-full rounded-lg p-3 text-slate-300 hover:bg-slate-700/50 hover:text-red-400 transition-colors duration-200 group
              ${isCollapsed ? "justify-center" : "gap-3"}`}
            title={isCollapsed ? "Sign out" : ""}
          >
            <FiLogOut size={18} />
            {!isCollapsed && (
              <span className="text-sm font-medium">Sign Out</span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
