// components/admin/AdminHeader.jsx
"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { FiSettings, FiLogOut, FiUser, FiBell, FiMenu } from "react-icons/fi";
import { useState, useRef, useEffect } from "react";

export default function AdminHeader({ toggleSidebar }) {
  const { data: session } = useSession();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const name = session?.user?.name || session?.user?.email || "Admin";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="flex items-center gap-4">
      {/* Mobile menu button */}
      <button
        className="lg:hidden p-2 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition-colors duration-200"
        onClick={toggleSidebar}
      >
        <FiMenu size={20} />
      </button>

      {/* Notifications */}
      <button className="p-2 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition-colors duration-200 relative">
        <FiBell size={18} />
        <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
      </button>

      {/* User dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-800 transition-colors duration-200"
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-r from-red-500 to-red-600 flex items-center justify-center text-white text-xs font-bold">
            {initials.substring(0, 2)}
          </div>
          <div className="hidden md:block text-left">
            <div className="text-sm font-medium text-slate-100">{name}</div>
            <div className="text-xs text-slate-400">Administrator</div>
          </div>
        </button>

        {isDropdownOpen && (
          <div className="absolute right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-lg py-1 z-50">
            <div className="px-4 py-2 border-b border-slate-700">
              <p className="text-sm text-slate-200">{name}</p>
              <p className="text-xs text-slate-400">Administrator</p>
            </div>
            <Link
              href="/admin/settings"
              className="flex items-center px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-slate-100 transition-colors duration-200"
              onClick={() => setIsDropdownOpen(false)}
            >
              <FiSettings size={16} className="mr-2" />
              Settings
            </Link>
            <Link
              href="/admin/profile"
              className="flex items-center px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-slate-100 transition-colors duration-200"
              onClick={() => setIsDropdownOpen(false)}
            >
              <FiUser size={16} className="mr-2" />
              Profile
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="flex items-center w-full px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-red-400 transition-colors duration-200"
            >
              <FiLogOut size={16} className="mr-2" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
