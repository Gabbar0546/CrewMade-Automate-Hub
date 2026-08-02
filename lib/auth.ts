import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { query } from "@/lib/db";

export type Role = "admin" | "user";

export type CurrentUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
};

const COOKIE_NAME = "nexus_session";

function sessionSecret() {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET || "dev-only-change-this-secret-before-production",
  );
}

export async function createSession(user: CurrentUser) {
  return new SignJWT({ user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(sessionSecret());
}

export async function setSessionCookie(user: CurrentUser) {
  const token = await createSession(user);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const verified = await jwtVerify(token, sessionSecret());
    const user = verified.payload.user as CurrentUser | undefined;
    if (!user?.id) return null;

    const result = await query<CurrentUser>(
      "SELECT id, name, email, role FROM users WHERE id = $1 AND is_active = TRUE",
      [user.id],
    );
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  return user;
}

export function jsonError(error: unknown) {
  const err = error as Error & { status?: number };
  return Response.json({ error: err.message || "Internal server error" }, { status: err.status || 500 });
}
