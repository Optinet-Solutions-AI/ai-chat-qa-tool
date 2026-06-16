import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildSnapshot, renderSnapshotHTML, renderSnapshotSubject } from '@/lib/dailySnapshot';
import { sendEmail, parseRecipients } from '@/lib/email';
import { getSnapshotRecipients } from '@/lib/usersDb';

// Vercel cron tick — sends the QA Daily Snapshot email to the recipient list.
// Schedule lives in vercel.json (07:00 UTC daily). Manual equivalent (with
// browser-friendly ?secret= auth, ?dry=1 preview, ?date= override and ?to=
// recipient override) is /api/admin/daily-snapshot.
//
// The route fetches yesterday's full UTC day and the 7 days before it in a
// single Supabase pagination pass (see lib/dailySnapshot), so total runtime
// is dominated by one query loop. 30s should be ample headroom; the existing
// telegram-pending-snapshot uses the same value.

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Recipients come from the roster (lib/users.ts — the "Daily Snapshot
  // Notification" column). DAILY_SNAPSHOT_RECIPIENTS, if set, overrides the
  // roster for one-off testing.
  const envRecipients = parseRecipients(process.env.DAILY_SNAPSHOT_RECIPIENTS);
  const recipients = envRecipients.length > 0 ? envRecipients : await getSnapshotRecipients();
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: 'No snapshot recipients configured (roster + DAILY_SNAPSHOT_RECIPIENTS both empty)' },
      { status: 500 },
    );
  }

  try {
    const data = await buildSnapshot();
    const html = renderSnapshotHTML(data);
    const subject = renderSnapshotSubject(data);

    const { id } = await sendEmail({ to: recipients, subject, html });

    return NextResponse.json({
      ok: true,
      messageId: id,
      targetDateISO: data.targetDateISO,
      recipients,
      totals: data.totals,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
