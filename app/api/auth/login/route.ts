import { NextResponse } from 'next/server';
import { AUTH_COOKIE, SESSION_TTL_MS, signToken } from '@/lib/auth';

export const runtime = 'nodejs';

// Constant-time string compare to keep timing identical whether the password
// is right, wrong, or differs in length.
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function POST(req: Request) {
  const expectedUser = process.env.APP_USERNAME;
  const expectedPass = process.env.APP_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!expectedUser || !expectedPass || !secret) {
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
  // Compare both fields unconditionally so timing doesn't leak which one failed.
  const userOk = timingSafeEqual(providedUser, expectedUser);
  const passOk = timingSafeEqual(providedPass, expectedPass);
  if (!userOk || !passOk) {
    return NextResponse.json({ error: 'Wrong username or password' }, { status: 401 });
  }

  const expiry = Date.now() + SESSION_TTL_MS;
  const token = await signToken(secret, expiry);

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
