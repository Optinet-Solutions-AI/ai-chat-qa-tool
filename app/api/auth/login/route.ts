import { NextResponse } from 'next/server';
import { AUTH_COOKIE, SESSION_TTL_MS, signToken } from '@/lib/auth';
import { findUser } from '@/lib/users';

export const runtime = 'nodejs';

// Constant-time string compare to keep timing identical whether the password
// is right, wrong, or differs in length.
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// Passwords live in the APP_USERS env var as JSON { username: password }.
// Roles/emails come from the committed roster in lib/users.ts.
function parseAppUsers(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  const secret = process.env.AUTH_SECRET;
  const passwords = parseAppUsers(process.env.APP_USERS);
  if (!secret || Object.keys(passwords).length === 0) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const providedUser = typeof body.username === 'string' ? body.username.trim() : '';
  const providedPass = typeof body.password === 'string' ? body.password : '';

  // Resolve the canonical roster entry (case-insensitive username). When the
  // user is unknown we still run a constant-time compare against a dummy so
  // response timing doesn't reveal whether the username exists.
  const user = findUser(providedUser);
  const expectedPass = user ? passwords[user.username] : undefined;
  const passOk = timingSafeEqual(providedPass, expectedPass ?? '\0invalid');
  if (!user || !expectedPass || !passOk) {
    return NextResponse.json({ error: 'Wrong username or password' }, { status: 401 });
  }

  const expiry = Date.now() + SESSION_TTL_MS;
  const token = await signToken(secret, { username: user.username, role: user.role, expiryMs: expiry });

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: AUTH_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
