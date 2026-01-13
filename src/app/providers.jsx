// app/providers.jsx
"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Simple provider component that wraps the app with NextAuth's SessionProvider.
 * Accepts an optional session prop (recommended to pass server-supplied session
 * from root layout for better immediate client-render).
 */
export default function Providers({ children, session }) {
  return (
    <SessionProvider session={session} refetchInterval={0}>
      {children}
    </SessionProvider>
  );
}
