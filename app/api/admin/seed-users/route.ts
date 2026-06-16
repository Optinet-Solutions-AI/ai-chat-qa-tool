import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { dbCreateUser, dbExistingUsernamesLower } from '@/lib/usersDb';
import { hashPassword } from '@/lib/password';
import { roleForTeam, defaultSnapshotForTeam, type Team } from '@/lib/users';

export const runtime = 'nodejs';

// One-time migration of the legacy hardcoded roster into the app_users table.
//
// Run ONCE after creating the table (sql/app_users.sql), while the old
// APP_USERS env var (JSON { username: password }) is still set — it supplies
// the passwords to hash. Auth (Bearer CRON_SECRET):
//
//   curl -X POST https://<host>/api/admin/seed-users -H "Authorization: Bearer $CRON_SECRET"
//
// Idempotent: skips any username that already exists, so re-running is safe.
// All seeded users land as 'approved' so nobody is locked out. Once seeded you
// can remove the APP_USERS env var and (optionally) delete this route.

// The legacy roster, with each person's team (the role + snapshot default are
// derived from the team). Emails carried over verbatim from the old lib/users.ts.
const LEGACY: Array<{ username: string; email: string; team: Team }> = [
  // Management
  { username: 'Val',       email: 'val@roosterpartners.com',               team: 'Management' },
  { username: 'Dror',      email: 'dror@roosterpartners.com',              team: 'Management' },
  { username: 'Alex',      email: 'Alex@roosterpartners.com',              team: 'Management' },
  { username: 'Maria',     email: 'maria.grigorova@roosterpartners.com',   team: 'Management' },
  { username: 'Meny',      email: 'meny@roosterpartners.com',              team: 'Management' },
  // CRM
  { username: 'Tina',      email: 'Tina@roosterpartners.com',              team: 'CRM' },
  { username: 'Ernie',     email: 'ernie.gabriel@roosterpartners.com',     team: 'CRM' },
  { username: 'Gisela',    email: 'Gisela.Gutierrez@roosterpartners.com',  team: 'CRM' },
  { username: 'Janice',    email: 'janice.santangelo@roosterpartners.com', team: 'CRM' },
  // NON-VIP
  { username: 'Geri',      email: 'Geri.Andonova@roosterpartners.com',     team: 'NON-VIP' },
  { username: 'Martin',    email: 'martin.nikolov@roosterpartners.com',    team: 'NON-VIP' },
  { username: 'Nik',       email: 'nik.stoyanov@roosterpartners.com',      team: 'NON-VIP' },
  // VIP English
  { username: 'Borislava', email: 'borislava@roosterpartners.com',         team: 'VIP English' },
  { username: 'Allan',     email: 'allan.lauchengco@roosterpartners.com',  team: 'VIP English' },
  { username: 'Koko',      email: 'koko@roosterpartners.com',              team: 'VIP English' },
  // VIP German
  { username: 'Christian', email: 'christian.deeken@roosterpartners.com',  team: 'VIP German' },
  { username: 'Niklas',    email: 'niklas.wirth@roosterpartners.com',      team: 'VIP German' },
  // VIP Italian
  { username: 'Salvatore', email: 'salvatore@roosterpartners.com',         team: 'VIP Italian' },
  { username: 'Stefano',   email: 'stefano@roosterpartners.com',           team: 'VIP Italian' },
  // GCC
  { username: 'Esam',      email: 'esam@roosterpartners.com',              team: 'GCC' },
  { username: 'Yassine',   email: 'yassine.ridene@roosterpartners.com',    team: 'GCC' },
  { username: 'Feras',     email: 'feras.akkawi@roosterpartners.com',      team: 'GCC' },
  { username: 'Youssef',   email: 'Youssef.Ayedi@roosterpartners.com',     team: 'GCC' },
  { username: 'Khoury',    email: 'khoury.raed@roosterpartners.com',       team: 'GCC' },
  { username: 'Mohamed',   email: 'Mohamed.AlJebali@roosterpartners.com',  team: 'GCC' },
];

function parseAppUsers(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const passwords = parseAppUsers(process.env.APP_USERS);
  if (Object.keys(passwords).length === 0) {
    return NextResponse.json(
      { error: 'APP_USERS env var is empty — nothing to seed from.' },
      { status: 400 },
    );
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const missingPassword: string[] = [];

  // One query for all taken usernames, rather than a round trip per candidate.
  const existing = await dbExistingUsernamesLower();

  for (const u of LEGACY) {
    if (existing.has(u.username.toLowerCase())) {
      skipped.push(u.username);
      continue;
    }
    const pw = passwords[u.username];
    if (!pw) {
      missingPassword.push(u.username);
      continue;
    }
    await dbCreateUser({
      username: u.username,
      email: u.email,
      passwordHash: hashPassword(pw),
      team: u.team,
      role: roleForTeam(u.team),
      status: 'approved',
      snapshot: defaultSnapshotForTeam(u.team),
      approvedBy: 'seed',
    });
    created.push(u.username);
  }

  return NextResponse.json({ ok: true, created, skipped, missingPassword });
}
