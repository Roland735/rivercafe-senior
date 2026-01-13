"use client";

import { useSession, signOut, signIn } from "next-auth/react";
import Link from "next/link";
import { FiSettings, FiLogOut, FiUser, FiBell, FiMenu } from "react-icons/fi";
import { useState, useRef, useEffect } from "react";

function fmtCurrency(n) {
  try {
    return new Intl.NumberFormat("en-ZW", {
      style: "currency",
      currency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD",
    }).format(Number(n || 0));
  } catch (e) {
    return `${n}`;
  }
}

export default function ItHeader({ toggleSidebar }) {
  const { data: session, status } = useSession();
  const loading = status === "loading";

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // derive display name & initials
  const rawName =
    session?.user?.name ||
    session?.user?.email ||
    (loading ? "Loading…" : "IT");
  const name = rawName;
  const initials = String(name)
    .split(" ")
    .map((n) => n[0] || "")
    .join("")
    .substring(0, 2)
    .toUpperCase();

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
        <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
      </button>

      {/* If still loading session, show spinner-like placeholder */}
      {loading ? (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-slate-700 animate-pulse" />
          <div className="hidden md:block">
            <div className="w-28 h-3 bg-slate-700 rounded animate-pulse" />
            <div className="w-20 h-2 mt-1 bg-slate-700 rounded animate-pulse" />
          </div>
        </div>
      ) : !session ? (
        // Not authenticated: show Sign in button
        <div className="flex items-center gap-2">
          <button
            onClick={() => signIn()}
            className="px-3 py-2 rounded bg-cyan-600 text-white hover:bg-cyan-700 transition-colors duration-150"
          >
            Sign in
          </button>
        </div>
      ) : (
        // Authenticated user dropdown
        <div className="relative" ref={dropdownRef}>
          <button
            className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-800 transition-colors duration-200"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            aria-haspopup="true"
            aria-expanded={isDropdownOpen}
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-red-500 to-red-600 flex items-center justify-center text-white text-xs font-bold">
              {initials || "IT"}
            </div>
            <div className="hidden md:block text-left">
              <div className="text-sm font-medium text-slate-100">{name}</div>

              {/* show role and balance if student */}
              <div className="text-xs text-slate-400">
                {session?.user?.role === "IT" ? (
                  <>
                    <span className=" capitalize">
                      {session?.user?.role || "IT"}ss
                    </span>
                    <span className="mx-2">•</span>
                    {/* <span>Balance: {fmtCurrency(session?.user?.balance)}</span> */}
                  </>
                ) : (
                  <span>{session?.user?.role || "User"}</span>
                )}
              </div>
            </div>
          </button>

          {isDropdownOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-lg py-1 z-50">
              <div className="px-4 py-2 border-b border-slate-700">
                <p className="text-sm text-slate-200">{name}</p>
                <p className="text-xs text-slate-400">
                  {session?.user?.regNumber || session?.user?.email || "IT"}
                </p>
                {/* {session?.user?.role === "student" && (
                  <p className="text-xs text-slate-300 mt-1">
                    Balance: {fmtCurrency(session?.user?.balance)}
                  </p>
                )} */}
              </div>

              {/* <Link
                href="/student/settings"
                onClick={() => setIsDropdownOpen(false)}
                className="flex items-center px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-slate-100 transition-colors duration-200"
              >
                <FiSettings size={16} className="mr-2" />
                Settings
              </Link>

              <Link
                href="/student/profile"
                onClick={() => setIsDropdownOpen(false)}
                className="flex items-center px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-slate-100 transition-colors duration-200"
              >
                <FiUser size={16} className="mr-2" />
                Profile
              </Link> */}

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
      )}
    </div>
  );
}
