// Password-gate auth helpers. Edge-runtime compatible (uses Web Crypto only).
//
// Token format: `<msg>.<hexHmacSha256(msg, AUTH_SECRET)>` where
//   msg = `<expiryMs>|<role>|<encodeURIComponent(username)>`
// so the signed cookie carries the logged-in identity + role without a DB
// lookup. The HMAC covers the whole msg, so none of the fields can be tampered.
// - HttpOnly cookie, 30-day sliding window.
// - Rotating AUTH_SECRET invalidates every session.
// - Changing this format also invalidates older-format tokens (they fail to
//   parse/verify and are treated as logged-out).

import type { Role } from './users';

export const AUTH_COOKIE = 'qa_auth';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Session {
  username: string;
  role: Role;
  expiryMs: number;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(sig);
}

// Constant-time string compare to avoid timing oracles on the signature check.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signToken(
  secret: string,
  session: { username: string; role: Role; expiryMs: number },
): Promise<string> {
  const msg = `${session.expiryMs}|${session.role}|${encodeURIComponent(session.username)}`;
  const sig = await hmac(secret, msg);
  return `${msg}.${sig}`;
}

// Verifies the HMAC + expiry and returns the decoded session, or null if the
// token is absent, malformed, tampered, or expired.
export async function verifyToken(secret: string, token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  // Signature is the segment after the final dot; everything before it is the
  // signed message (the msg fields are dot-free: digits, a fixed role word,
  // and a URI-encoded username).
  const lastDot = token.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const msg = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);

  const expected = await hmac(secret, msg);
  if (!timingSafeEqual(sig, expected)) return null;

  const parts = msg.split('|');
  if (parts.length !== 3) return null;
  const expiryMs = Number(parts[0]);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return null;
  const role = parts[1];
  if (role !== 'admin' && role !== 'standard') return null;

  let username: string;
  try {
    username = decodeURIComponent(parts[2]);
  } catch {
    return null;
  }
  return { username, role, expiryMs };
}

// Parse a single cookie value out of a raw Cookie header. Route handlers that
// receive a plain Request (not NextRequest) have no req.cookies helper, so they
// use this. Pure string work — edge-safe.
export function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

// Verify the auth cookie carried on a plain Request and return the decoded
// session (or null if missing/invalid/misconfigured). The single entry point
// for API route handlers that need the caller's identity.
export async function getSessionFromRequest(req: Request): Promise<Session | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const token = parseCookie(req.headers.get('cookie'), AUTH_COOKIE);
  return verifyToken(secret, token);
}
