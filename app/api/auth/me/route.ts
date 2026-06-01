import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE, verifyToken } from '@/lib/auth';

export const runtime = 'nodejs';

// Returns the logged-in identity decoded from the qa_auth cookie. The client
// (AppInitializer) uses this to show the current user and to gate admin-only
// UI (e.g. the Prompt Library nav). 401 when there's no valid session.
export async function GET(req: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Auth misconfigured' }, { status: 500 });
  }
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const session = await verifyToken(secret, token);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ username: session.username, role: session.role });
}
