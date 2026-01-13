// app/layout.jsx
import { authOptions } from './api/auth/[...nextauth]/route';
import './globals.css'; // keep your global styles import
import Providers from './providers';
import { getServerSession } from 'next-auth/next';

export const metadata = {
  title: "River'Cafe",
  description: 'Smart canteen system',
  icons: {
    icon: '/logo.png',      // favicon -> logo.png from /public
    apple: '/logo.png',     // apple-touch-icon
  },
};

export default async function RootLayout({ children }) {
  // getServerSession is server-only and returns the current session if available.
  // Passing the server session to SessionProvider avoids a flash of unauthenticated UI.
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch (err) {
    console.error('[auth] getServerSession failed:', err?.message || err);
    session = null;
  }

  return (
    <html lang="en">
      <body>
        <Providers session={session}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
