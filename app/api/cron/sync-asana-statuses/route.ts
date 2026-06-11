import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAsanaConfigured } from '@/lib/asana';
import { reconcileAsanaStatuses } from '@/lib/asana-sync';

// Vercel cron tick — refreshes asana_completed_at for every ticketed
// conversation by pulling task status from Asana in one project-level sweep.
// Schedule lives in vercel.json. Manual equivalent (with browser-friendly
// ?secret= auth) is /api/admin/sync-asana-statuses.

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  if (!isAsanaConfigured()) {
    return NextResponse.json({ skipped: 'asana not configured' });
  }

  const result = await reconcileAsanaStatuses();
  return NextResponse.json(result);
}
