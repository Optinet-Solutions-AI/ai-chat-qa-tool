import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getSessionFromRequest } from '@/lib/auth';
import {
  dbListUsers,
  dbApproveUser,
  dbSetUserStatus,
  dbUpdateUserTeam,
  dbSetUserSnapshot,
  dbSetUserPassword,
  dbDeleteUser,
} from '@/lib/usersDb';
import { hashPassword } from '@/lib/password';
import { isTeam, roleForTeam, defaultSnapshotForTeam } from '@/lib/users';

export const runtime = 'nodejs';

// All user-management actions require an admin session. The middleware already
// requires *a* valid session for /api/*, but the admin role is the real
// boundary, so re-check it here on the server.
async function requireAdmin(req: Request): Promise<{ username: string } | null> {
  const session = await getSessionFromRequest(req);
  if (!session || session.role !== 'admin') return null;
  return { username: session.username };
}

// A short, human-shareable temporary password for admin-initiated resets.
function generateTempPassword(): string {
  // 9 url-safe chars — enough entropy for a temp credential the user changes
  // implicitly by being reset again if needed.
  return randomBytes(7).toString('base64url').slice(0, 9);
}

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const users = await dbListUsers();
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: { action?: string; id?: string; team?: string; snapshot?: boolean; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, id } = body;
  if (!action || !id) {
    return NextResponse.json({ error: 'Missing action or id' }, { status: 400 });
  }

  try {
    switch (action) {
      case 'approve': {
        // Team is required at approval — it sets the derived role and the
        // default snapshot flag (admin may override snapshot via payload).
        const team = typeof body.team === 'string' ? body.team.trim() : '';
        if (!isTeam(team)) {
          return NextResponse.json({ error: 'Pick a valid team to approve.' }, { status: 400 });
        }
        const snapshot =
          typeof body.snapshot === 'boolean' ? body.snapshot : defaultSnapshotForTeam(team);
        await dbApproveUser(id, team, roleForTeam(team), snapshot, admin.username);
        return NextResponse.json({ ok: true });
      }
      case 'reject':
        await dbSetUserStatus(id, 'rejected');
        return NextResponse.json({ ok: true });
      case 'disable':
        await dbSetUserStatus(id, 'disabled');
        return NextResponse.json({ ok: true });
      case 'enable':
        await dbSetUserStatus(id, 'approved');
        return NextResponse.json({ ok: true });
      case 'updateTeam': {
        const team = typeof body.team === 'string' ? body.team.trim() : '';
        if (!isTeam(team)) {
          return NextResponse.json({ error: 'Pick a valid team.' }, { status: 400 });
        }
        await dbUpdateUserTeam(id, team, roleForTeam(team));
        return NextResponse.json({ ok: true });
      }
      case 'setSnapshot':
        await dbSetUserSnapshot(id, !!body.snapshot);
        return NextResponse.json({ ok: true });
      case 'resetPassword': {
        // Admin may supply a specific password; otherwise we generate a
        // temporary one and return it so they can share it with the user.
        const supplied = typeof body.password === 'string' ? body.password : '';
        const temp = supplied.length >= 6 ? supplied : generateTempPassword();
        await dbSetUserPassword(id, hashPassword(temp));
        return NextResponse.json({ ok: true, password: temp });
      }
      case 'delete':
        await dbDeleteUser(id);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[api/admin/users] ${action} error:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
