// Password-gate auth helpers. Edge-runtime compatible (uses Web Crypto only).
//
// Token format: `<expiryMs>.<hexHmacSha256(expiryMs, AUTH_SECRET)>`
// - HttpOnly cookie, 30-day sliding window.
// - Rotating AUTH_SECRET invalidates every session.

export const AUTH_COOKIE = 'qa_auth';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(sig);
}

// Constant-time string compare to avoid timing oracles on the signature check.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signToken(secret: string, expiryMs: number): Promise<string> {
  const sig = await hmac(secret, String(expiryMs));
  return `${expiryMs}.${sig}`;
}

export async function verifyToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expiryStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expected = await hmac(secret, expiryStr);
  return timingSafeEqual(sig, expected);
}
