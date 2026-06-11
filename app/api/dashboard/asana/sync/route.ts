import { NextResponse } from 'next/server';
import { isAsanaConfigured } from '@/lib/asana';
import { reconcileAsanaStatuses } from '@/lib/asana-sync';

// Browser-callable mirror of /api/admin/sync-asana-statuses for the
// "Refresh status from Asana" button on /dashboard/asana. Has no
// CRON_SECRET gate because the dashboard runs without auth (matches the
// existing /api/dashboard/* pattern); the sync itself is read-from-Asana
// + idempotent write to one column, so blast radius is bounded.
//
// Shares reconcileAsanaStatuses() with the cron + admin paths so all four
// stay in step. `synced` is kept as an alias (rows changed this run) for the
// existing "Synced X/Y tickets" toast on the reporting page.

export const maxDuration = 60;

export async function GET() {
  if (!isAsanaConfigured()) {
    return NextResponse.json(
      { error: 'Asana not configured — set ASANA_ACCESS_TOKEN and ASANA_PROJECT_GID' },
      { status: 400 },
    );
  }

  try {
    const result = await reconcileAsanaStatuses();
    return NextResponse.json({
      ...result,
      synced: result.completed + result.deleted + result.reopened,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
