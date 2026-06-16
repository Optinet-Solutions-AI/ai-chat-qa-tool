// Password hashing for the app_users roster. Node-runtime only (uses
// node:crypto scrypt) — import this from nodejs route handlers, never from the
// edge middleware.
//
// Stored format: `scrypt$<saltHex>$<hashHex>`. scrypt is memory-hard and ships
// with Node, so there's no extra dependency. A per-password random salt means
// identical passwords don't collide to the same hash.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// Constant-time verify. Returns false (never throws) for malformed/missing
// stored hashes so callers can treat "no such user" and "wrong password"
// identically.
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length !== KEYLEN) return false;

  const actual = scryptSync(password, salt, KEYLEN);
  return timingSafeEqual(actual, expected);
}
