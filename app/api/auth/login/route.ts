import { NextResponse } from 'next/server';
import { AUTH_COOKIE, SESSION_TTL_MS, signToken } from '@/lib/auth';
import { dbFindAuthUser } from '@/lib/usersDb';
import { verifyPassword } from '@/lib/password';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
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

  // Look up the account (case-insensitive) and verify the password against the
  // stored scrypt hash. verifyPassword is constant-time and returns false for a
  // missing/malformed hash, so an unknown user and a wrong password look the
  // same to the caller.
  const user = await dbFindAuthUser(providedUser);
  const passOk = verifyPassword(providedPass, user?.passwordHash);
  if (!user || !passOk) {
    return NextResponse.json({ error: 'Wrong username or password' }, { status: 401 });
  }

  // Only approved accounts may sign in. Pending/rejected/disabled get a clear,
  // distinct message (code 403) so the login page can explain the hold-up
  // without the user wondering if they fat-fingered the password.
  if (user.status !== 'approved') {
    const reason =
      user.status === 'pending'
        ? 'Your account is awaiting admin approval.'
        : user.status === 'rejected'
          ? 'Your account request was declined. Contact an admin.'
          : 'Your account has been disabled. Contact an admin.';
    return NextResponse.json({ error: reason, status: user.status }, { status: 403 });
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
