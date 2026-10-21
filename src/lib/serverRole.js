import { getToken } from "next-auth/jwt";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function getRequestUser(req) {
  const token = await getToken({
    req,
    secret: authOptions?.secret || process.env.NEXTAUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
    cookieName: process.env.NODE_ENV === "production" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
  }).catch(() => null);
  return token?.user || token || null;
}

export async function hasRole(req, roles) {
  const user = await getRequestUser(req);
  return roles.includes(String(user?.role || "").toLowerCase()) ? user : null;
}
