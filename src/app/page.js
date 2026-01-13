// app/page.js
'use client';

import { useEffect, useState } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

/**
 * Login page that redirects to role-aware dashboard after successful sign-in.
 * - Waits briefly for the session to be available after signIn, then routes by role.
 * - Uses mounted flag to avoid SSR/CSR hydration mismatches.
 *
 * Role -> path mapping:
 *  - admin  -> /(admin)
 *  - canteen -> /(canteen)
 *  - student -> /(student)
 *  - it -> /(it)
 *  - otherwise -> /
 */

export default function LoginPage() {
  const router = useRouter();

  // form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // mounted flag to avoid mismatches
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // helper: wait/poll for session after signIn
  async function waitForSession(attempts = 8, delayMs = 250) {
    for (let i = 0; i < attempts; i++) {
      // getSession hits the auth endpoint and returns session or null
      // eslint-disable-next-line no-await-in-loop
      const session = await getSession();
      if (session && session.user) return session;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  }

  function roleToPath(role) {
    if (!role) return '/';
    const r = role.toString().toLowerCase();
    if (r === 'admin') return '/admin';
    if (r === 'canteen') return '/canteen';
    if (r === 'student') return '/student';
    if (r === 'it') return '/it';
    return '/';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      const res = await signIn('credentials', {
        redirect: false,
        email: identifier,
        password
      });

      if (!res) {
        setLoading(false);
        setErrorMsg('Login failed — no response from auth.');
        return;
      }
      if (res.error) {
        setLoading(false);
        setErrorMsg(res.error === 'CredentialsSignin' ? 'Invalid email/regNumber or password.' : String(res.error));
        return;
      }

      // Wait briefly for the session to be available, then redirect based on role
      const session = await waitForSession(10, 250); // ~2.5s max
      setLoading(false);

      if (!session) {
        // session didn't appear — fallback to root or show message
        setErrorMsg('Signed in but session not available yet. Redirecting...');
        router.replace('/');
        return;
      }

      const role = session?.user?.role;
      const path = roleToPath(role);
      router.replace(path);
    } catch (err) {
      setLoading(false);
      setErrorMsg(err?.message || 'Login error');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-800 p-4">
      <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-sm border border-slate-700 rounded-2xl p-6 shadow-lg">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-100">River’Café</h1>
          <p className="text-sm text-slate-300">Fast • Cash-safe • Paperless canteen</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4" aria-describedby="login-note">
          <label className="block">
            <span className="text-sm text-slate-200">Email or RegNumber</span>
            <input
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="mt-1 block w-full bg-slate-800/60 border border-slate-700 rounded-md p-2 text-slate-100 placeholder-slate-400"
              placeholder="admin@... or ST2025-001"
              autoComplete="username"
            />
          </label>

          <label className="block">
            <span className="text-sm text-slate-200">Password</span>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full bg-slate-800/60 border border-slate-700 rounded-md p-2 text-slate-100 placeholder-slate-400"
              placeholder="password"
              autoComplete="current-password"
            />
          </label>

          {/* show runtime errors only after client mount to avoid SSR/CSR mismatch */}
          {mounted && errorMsg && <div className="text-sm text-red-300">{errorMsg}</div>}

          <button
            type="submit"
            className="w-full py-2 rounded-md text-white font-medium transition-colors
                       bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={loading}
          >
            {mounted && loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div id="login-note" className="mt-5 text-sm text-slate-400">
          {/* {mounted ? (
            <>
              Dev seed credentials: <br />
              <span className="font-medium text-slate-100">admin:</span> admin@rivercafe.local / <span className="font-semibold">adminpass</span><br />
              <span className="font-medium text-slate-100">canteen:</span> canteen@rivercafe.local / <span className="font-semibold">canteenpass</span><br />
              <span className="font-medium text-slate-100">student:</span> tariro@student.local / <span className="font-semibold">studentpass</span> or reg <span className="font-semibold">ST2025-001</span><br />
              <span className="font-medium text-slate-100">it (support):</span> it@rivercafe.local / <span className="font-semibold">itpass</span><br />
              <span className="font-medium text-slate-100">it (admin):</span> it-admin@rivercafe.local / <span className="font-semibold">itadminpass</span>
            </>
          ) : (
            <span>Loading login form…</span>
          )} */}
        </div>
      </div>
    </div>
  );
}
