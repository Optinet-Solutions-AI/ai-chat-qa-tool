import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { dbFindAuthUser } from '@/lib/usersDb';

export const runtime = 'nodejs';

// Returns the logged-in identity decoded from the qa_auth cookie, plus whether
// the account is still on an admin-issued temporary password (drives the
// first-visit "set your own password" prompt). The client (AppInitializer)
// uses this to show the current user and to gate admin-only UI (e.g. the
// Prompt Library nav). 401 when there is no valid session.
export async function GET(req: Request) {
  if (!process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Auth misconfigured' }, { status: 500 });
  }
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // One indexed lookup. If it fails we simply do not nag about the password —
  // identity still comes from the signed cookie.
  const user = await dbFindAuthUser(session.username);
  return NextResponse.json({
    username: session.username,
    role: session.role,
    mustChangePassword: user?.mustChangePassword ?? false,
  });
}
