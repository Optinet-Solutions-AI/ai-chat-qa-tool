// Per-user roster for the team login gate. Replaces the old single shared
// APP_USERNAME/APP_PASSWORD account.
//
// This file holds only NON-secret data: login username, access role, email,
// and whether the person receives the Daily Snapshot email. Passwords live in
// the APP_USERS env var (JSON: { username: password }) so they stay out of git
// — see app/api/auth/login/route.ts for how the two are joined at login.
//
// Two roles:
//   'admin'    — Management. Full access AND may edit the Prompt Library.
//   'standard' — Everyone else. Full access EXCEPT the Prompt Library (the
//                /prompts page is hidden + prompt-mutating APIs are blocked).
//
// Source of truth: the "AI Tool Users" sheet Val maintains. A few people log
// in under a username that differs from their display name ("Raed" → Khoury;
// "Youseff" → Youssef). To add/remove a person:
// add a row here AND add their password to APP_USERS (env), then redeploy.

export type Role = 'admin' | 'standard';

export interface AppUser {
  /** Login username (matched case-insensitively). */
  username: string;
  role: Role;
  /** Used as a Daily Snapshot recipient when `snapshot` is true. */
  email: string;
  /** Receives the morning Daily Snapshot email. */
  snapshot: boolean;
}

export const USERS: AppUser[] = [
  // ── Management — admin, snapshot recipients ──
  { username: 'Val',       role: 'admin',    email: 'val@roosterpartners.com',                  snapshot: true },
  { username: 'Dror',      role: 'admin',    email: 'dror@roosterpartners.com',                 snapshot: true },
  { username: 'Alex',      role: 'admin',    email: 'Alex@roosterpartners.com',                 snapshot: true },
  { username: 'Maria',     role: 'admin',    email: 'maria.grigorova@roosterpartners.com',      snapshot: true },
  { username: 'Meny',      role: 'admin',    email: 'meny@roosterpartners.com',                 snapshot: true },

  // ── CRM — standard, snapshot recipients ──
  { username: 'Tina',      role: 'standard', email: 'Tina@roosterpartners.com',                 snapshot: true },
  { username: 'Ernie',     role: 'standard', email: 'ernie.gabriel@roosterpartners.com',        snapshot: true },
  { username: 'Gisela',    role: 'standard', email: 'Gisela.Gutierrez@roosterpartners.com',     snapshot: true },
  { username: 'Janice',    role: 'standard', email: 'janice.santangelo@roosterpartners.com',    snapshot: true },

  // ── NON-VIP — standard ──
  { username: 'Geri',      role: 'standard', email: 'Geri.Andonova@roosterpartners.com',        snapshot: false },
  { username: 'Martin',    role: 'standard', email: 'martin.nikolov@roosterpartners.com',       snapshot: false },
  { username: 'Nik',       role: 'standard', email: 'nik.stoyanov@roosterpartners.com',         snapshot: false },

  // ── VIP English — standard ──
  { username: 'Borislava', role: 'standard', email: 'borislava@roosterpartners.com',            snapshot: false },
  { username: 'Allan',     role: 'standard', email: 'allan.lauchengco@roosterpartners.com',     snapshot: false },
  { username: 'Koko',      role: 'standard', email: 'koko@roosterpartners.com',                 snapshot: false },

  // ── VIP German — standard ──
  { username: 'Christian', role: 'standard', email: 'christian.deeken@roosterpartners.com',     snapshot: false },
  { username: 'Niklas',    role: 'standard', email: 'niklas.wirth@roosterpartners.com',         snapshot: false },

  // ── VIP Italian — standard ──
  { username: 'Salvatore', role: 'standard', email: 'salvatore@roosterpartners.com',            snapshot: false },
  { username: 'Stefano',   role: 'standard', email: 'stefano@roosterpartners.com',              snapshot: false },

  // ── GCC — standard ──
  { username: 'Esam',      role: 'standard', email: 'esam@roosterpartners.com',                 snapshot: false },
  { username: 'Yassine',   role: 'standard', email: 'yassine.ridene@roosterpartners.com',       snapshot: false },
  { username: 'Feras',     role: 'standard', email: 'feras.akkawi@roosterpartners.com',         snapshot: false },
  { username: 'Youssef',   role: 'standard', email: 'Youssef.Ayedi@roosterpartners.com',        snapshot: false },
  { username: 'Khoury',    role: 'standard', email: 'khoury.raed@roosterpartners.com',          snapshot: false },
  { username: 'Mohamed',   role: 'standard', email: 'Mohamed.AlJebali@roosterpartners.com',     snapshot: false },
];

/** Case-insensitive username lookup. Returns the canonical roster entry. */
export function findUser(username: string): AppUser | undefined {
  const key = username.trim().toLowerCase();
  return USERS.find((u) => u.username.toLowerCase() === key);
}

/** Emails of everyone flagged to receive the Daily Snapshot email. */
export function getSnapshotRecipients(): string[] {
  return USERS.filter((u) => u.snapshot).map((u) => u.email);
}
