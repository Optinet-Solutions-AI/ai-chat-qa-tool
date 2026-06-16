// Pure, edge-safe types + constants for the team login roster.
//
// The roster itself now lives in the Supabase `app_users` table (see
// sql/app_users.sql), NOT in this file. This module holds only the shared
// vocabulary — roles, teams, the team→role rule — so it can be imported from
// the edge middleware (lib/auth.ts) and client store without pulling in the
// Supabase client or node:crypto. DB access lives in lib/db.ts.
//
// Two roles:
//   'admin'    — Management. Full access AND may edit the Prompt Library.
//   'standard' — Everyone else. Full access EXCEPT the Prompt Library (the
//                /prompts page is hidden + prompt-mutating APIs are blocked).

export type Role = 'admin' | 'standard';

// The teams from the "AI Tool Users" sheet Val maintains. Order is the order
// they appear in the team picker.
export const TEAMS = [
  'Management',
  'CRM',
  'NON-VIP',
  'VIP English',
  'VIP German',
  'VIP Italian',
  'GCC',
] as const;

export type Team = (typeof TEAMS)[number];

export function isTeam(value: unknown): value is Team {
  return typeof value === 'string' && (TEAMS as readonly string[]).includes(value);
}

// Account lifecycle. Only 'approved' accounts may log in.
export type UserStatus = 'pending' | 'approved' | 'rejected' | 'disabled';

// Role is derived from team: Management is the admin team, everyone else is
// standard. Keeping this a single function means there's exactly one place that
// decides who can edit the Prompt Library.
export function roleForTeam(team: string): Role {
  return team === 'Management' ? 'admin' : 'standard';
}

// Whether members of a team receive the morning Daily Snapshot email by
// default. Management + CRM are the snapshot recipients in the sheet; this is
// only the default applied at registration/seed time — an admin can flip the
// per-user `snapshot` flag afterwards.
export function defaultSnapshotForTeam(team: string): boolean {
  return team === 'Management' || team === 'CRM';
}

export interface AppUser {
  id: string;
  /** Login username (matched case-insensitively). */
  username: string;
  role: Role;
  email: string;
  team: string;
  status: UserStatus;
  /** Receives the morning Daily Snapshot email. */
  snapshot: boolean;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}
