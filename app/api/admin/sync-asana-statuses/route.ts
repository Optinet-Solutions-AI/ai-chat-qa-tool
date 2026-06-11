import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAsanaConfigured } from '@/lib/asana';
import { reconcileAsanaStatuses } from '@/lib/asana-sync';

// Manual trigger for the Asana status sync — same reconcileAsanaStatuses() the
// */15 cron runs, so they can't drift. Reconciles asana_completed_at /
// asana_task_deleted_at against the live board (the reporting page reads those
// columns to show open vs closed counts without hitting Asana on every load).
// Handy for clearing a backlog on demand instead of waiting for the next tick.
//
// Auth (optional but recommended): set CRON_SECRET and pass either
//   - Authorization: Bearer <secret>      (curl / cron)
//   - ?secret=<secret>                    (browser-friendly)
//
// Idempotent and chunked, so re-running is cheap and a partial run self-heals.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    const querySecret = new URL(req.url).searchParams.get('secret') ?? '';
    if (auth !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  if (!isAsanaConfigured()) {
    return NextResponse.json(
      { error: 'Asana not configured — set ASANA_ACCESS_TOKEN and ASANA_PROJECT_GID' },
      { status: 400 },
    );
  }

  try {
    const result = await reconcileAsanaStatuses();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
