import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { dbFindAuthUser, dbSetUserPassword } from '@/lib/usersDb';
import { hashPassword, verifyPassword } from '@/lib/password';
import { MIN_PASSWORD_LEN } from '@/lib/users';

export const runtime = 'nodejs';

// Self-service password change for the logged-in user. Lives under /api/auth/*
// (which the middleware treats as public), so it verifies the session cookie
// itself. The current password is required even when it is a temporary one —
// the user just typed it to sign in, and it stops a hijacked session from
// locking the real owner out. The new hash is stored with the plain `scrypt`
// scheme, which is what clears the "temporary password" prompt.
export async function POST(req: Request) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (next.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      { error: `New password must be at least ${MIN_PASSWORD_LEN} characters.` },
      { status: 400 },
    );
  }
  if (next === current) {
    return NextResponse.json(
      { error: 'New password must be different from the current one.' },
      { status: 400 },
    );
  }

  const user = await dbFindAuthUser(session.username);
  if (!user || user.status !== 'approved') {
    return NextResponse.json({ error: 'Your account is not active.' }, { status: 403 });
  }
  if (!verifyPassword(current, user.passwordHash)) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
  }

  try {
    await dbSetUserPassword(user.id, hashPassword(next));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/auth/change-password]', msg);
    return NextResponse.json({ error: 'Could not update password. Try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
