import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE, verifyToken } from '@/lib/auth';

// Bypass list: cron endpoints (they use CRON_SECRET bearer), the auth API itself,
// the login page, and Next.js static/build assets. Everything else must carry a
// valid qa_auth cookie.
function isPublicPath(pathname: string): boolean {
  if (pathname === '/login') return true;
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname.startsWith('/api/cron/')) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname === '/favicon.ico' || pathname === '/robots.txt') return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();

  const secret = process.env.AUTH_SECRET;
  // If AUTH_SECRET is missing in the environment we fail closed — better a broken
  // app than an accidentally-open one. Set AUTH_SECRET in .env.local / Vercel.
  if (!secret) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Auth misconfigured' }, { status: 500 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const session = await verifyToken(secret, token);

  if (session) {
    // Prompt Library is admin-only ("can change the prompt"). Standard users
    // who navigate to it directly are bounced to the home page. The matching
    // prompt-mutating API is gated server-side in app/api/db (the real guard).
    if (
      session.role !== 'admin' &&
      (pathname === '/prompts' || pathname.startsWith('/prompts/'))
    ) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Run on every request except Next.js internals and common static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
