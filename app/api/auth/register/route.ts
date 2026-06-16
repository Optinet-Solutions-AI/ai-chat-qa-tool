import { NextResponse } from 'next/server';
import { dbCreateUser, dbUsernameExists } from '@/lib/usersDb';
import { hashPassword } from '@/lib/password';
import { isTeam, roleForTeam, defaultSnapshotForTeam } from '@/lib/users';

export const runtime = 'nodejs';

// Public self-registration. Creates a 'pending' account that an admin must
// approve before it can log in. This route sits under /api/auth/* which the
// middleware treats as public, so it's reachable without a session.
//
// The team the user picks here is only a *request* — on approval the admin
// confirms or overrides it (and the role is re-derived from the final team).

const MIN_PASSWORD_LEN = 6;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: Request) {
  let body: { username?: string; email?: string; password?: string; team?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const team = typeof body.team === 'string' ? body.team.trim() : '';

  // ── Validate ──
  if (username.length < 2) {
    return NextResponse.json({ error: 'Username must be at least 2 characters.' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
      { status: 400 },
    );
  }
  if (!isTeam(team)) {
    return NextResponse.json({ error: 'Pick a valid team.' }, { status: 400 });
  }

  if (await dbUsernameExists(username)) {
    return NextResponse.json({ error: 'That username is already taken.' }, { status: 409 });
  }

  // role is derived from the requested team but doesn't actually grant anything
  // until an admin approves (status stays 'pending').
  try {
    await dbCreateUser({
      username,
      email,
      passwordHash: hashPassword(password),
      team,
      role: roleForTeam(team),
      status: 'pending',
      snapshot: defaultSnapshotForTeam(team),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/auth/register]', msg);
    return NextResponse.json({ error: 'Could not create account. Try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
