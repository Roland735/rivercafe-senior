// app/api/auth/[...nextauth]/route.js
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { connectToDatabase, User } from "../../../../models/allModels.js";
import bcrypt from "bcrypt";

const nextAuthSecret = String(process.env.NEXTAUTH_SECRET || "").trim();
if (!nextAuthSecret) {
    throw new Error("Missing NEXTAUTH_SECRET environment variable");
}

/**
 * Define authOptions here and export it once.
 */
export const authOptions = {
    providers: [
        CredentialsProvider({
            id: "credentials",
            name: "Credentials",
            credentials: {
                email: { label: "Email or RegNumber", type: "text", placeholder: "admin@..." },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                try {
                    await connectToDatabase();
                } catch (err) {
                    console.error("Auth DB connection error:", err?.message || err);
                    throw new Error("Login unavailable");
                }

                const { email, password } = credentials || {};
                const identifier = String(email || "").trim();
                const rawPassword = String(password || "");

                if (!identifier || !rawPassword) {
                    throw new Error("Email/RegNumber and password are required");
                }

                const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const identifierRegex = new RegExp(`^${escapeRegex(identifier)}$`, "i");

                const user = await User.findOne({
                    $or: [{ email: identifierRegex }, { regNumber: identifierRegex }],
                }).lean();

                if (!user) {
                    throw new Error("No user found for that Email/RegNumber");
                }

                const hash = user.passwordHash || user.password;
                if (!hash) {
                    throw new Error("User has no password set");
                }

                const match = await bcrypt.compare(rawPassword, hash);
                if (!match) {
                    throw new Error("Incorrect password");
                }

                return {
                    id: user._id.toString(),
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    regNumber: user.regNumber || null,
                    balance: typeof user.balance === "number" ? user.balance : 0,
                };
            },
        }),
    ],

    session: {
        strategy: "jwt",
        maxAge: 30 * 24 * 60 * 60, // 30 days
    },

    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.user = {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    regNumber: user.regNumber,
                    balance: typeof user.balance === "number" ? user.balance : 0,
                };
            }
            return token;
        },

        async session({ session, token }) {
            if (token?.user) {
                session.user = { ...session.user, ...token.user };
            }
            return session;
        },
    },

    cookies: {
        sessionToken: {
            name:
                process.env.NODE_ENV === "production"
                    ? "__Secure-next-auth.session-token"
                    : "next-auth.session-token",
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                secure: process.env.NODE_ENV === "production",
            },
        },
    },

    secret: nextAuthSecret,
    debug: process.env.NODE_ENV !== "production",

    pages: {
        signIn: "/", // your sign-in page
    },
};

// Instantiate NextAuth with the options
const handler = NextAuth(authOptions);

// Only export GET and POST — authOptions is already exported above
export { handler as GET, handler as POST };
