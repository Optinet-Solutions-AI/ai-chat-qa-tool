// Password hashing for the app_users roster. Node-runtime only (uses
// node:crypto scrypt) — import this from nodejs route handlers, never from the
// edge middleware or client components. Environment-neutral constants that the
// client also needs (MIN_PASSWORD_LEN) live in lib/users.ts.
//
// Stored format: `<scheme>$<saltHex>$<hashHex>`, where scheme is one of
//   scrypt       — a password the user chose themselves.
//   scrypt-temp  — an admin-issued temporary password (reset / bulk rollout).
//                  The app greets the user with a "set your own password"
//                  prompt while their hash carries this scheme; choosing a
//                  password stores a plain `scrypt` hash, so the "temporary"
//                  state lives with the credential and can never drift from it
//                  (and it needed no schema change).
// Both schemes verify identically. scrypt is memory-hard and ships with Node,
// so there is no extra dependency. A per-password random salt means identical
// passwords do not collide to the same hash.
//
// scripts/accounts.mjs mirrors this format and generator — keep them in sync.

import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;
const SCHEME_USER = 'scrypt';
const SCHEME_TEMP = 'scrypt-temp';

export function hashPassword(password: string, opts: { temporary?: boolean } = {}): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  const scheme = opts.temporary ? SCHEME_TEMP : SCHEME_USER;
  return `${scheme}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// True while the stored hash is an admin-issued temporary password, i.e. the
// user has not set their own yet.
export function isTemporaryPasswordHash(stored: string | null | undefined): boolean {
  return !!stored && stored.split('$')[0] === SCHEME_TEMP;
}

// Constant-time verify. Returns false (never throws) for malformed/missing
// stored hashes so callers can treat "no such user" and "wrong password"
// identically.
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  if (parts[0] !== SCHEME_USER && parts[0] !== SCHEME_TEMP) return false;

  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length !== KEYLEN) return false;

  const actual = scryptSync(password, salt, KEYLEN);
  return timingSafeEqual(actual, expected);
}

// Temporary-password alphabet. Look-alikes are left out (no 0/O, 1/l/I) so a
// password read off an email can be typed reliably, and the symbol set is
// limited to keys that exist on every common keyboard layout.
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYMBOL = '!#$%&*?';
const TEMP_PASSWORD_LEN = 12;

function pick(set: string): string {
  return set[randomInt(set.length)];
}

// A human-shareable temporary password for admin resets and bulk rollouts:
// 12 chars with at least one lower, upper, digit and symbol (~72 bits). One
// of each class is drawn first, the rest from the full alphabet, then a
// Fisher–Yates shuffle so the guaranteed classes don't sit in fixed spots.
export function generateTempPassword(): string {
  const all = LOWER + UPPER + DIGIT + SYMBOL;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < TEMP_PASSWORD_LEN) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
