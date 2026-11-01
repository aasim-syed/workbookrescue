import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { jwtVerify, SignJWT } from "jose";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  isGuest: boolean;
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const key = await scrypt(pw, Buffer.from(salt, "hex"), 32);
  const expected = Buffer.from(hash, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.VERCEL) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s ?? "dev-only-secret-change-me-dev-only-secret");
}

const COOKIE = "wr_session";
const MAX_AGE = 60 * 60 * 24 * 30;

export async function startSession(c: Context, u: AuthUser): Promise<void> {
  const token = await new SignJWT({ org: u.orgId, email: u.email, name: u.name, guest: u.isGuest })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", secure: !!process.env.VERCEL, path: "/", maxAge: MAX_AGE });
}

export function endSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function currentUser(c: Context): Promise<AuthUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { id: String(payload.sub), orgId: String(payload.org), email: String(payload.email), name: String(payload.name), isGuest: !!payload.guest };
  } catch {
    return null;
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const u = await currentUser(c);
  if (!u) throw new HTTPException(401, { message: "Sign in required" });
  c.set("user", u);
  await next();
};
