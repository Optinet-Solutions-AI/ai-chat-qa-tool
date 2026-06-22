import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildSnapshot, renderSnapshotHTML, renderSnapshotSubject } from '@/lib/dailySnapshot';
import { sendEmail, parseRecipients } from '@/lib/email';
import { getSnapshotRecipients } from '@/lib/usersDb';

// Manual trigger for the QA Daily Snapshot email. Same pipeline as the cron
// at /api/cron/daily-snapshot, plus three QA conveniences:
//
//   ?dry=1         — return the rendered HTML directly (text/html), no send.
//                    Useful for iterating on the layout in a browser without
//                    burning Resend sends.
//   ?date=YYYY-MM-DD — override the target day (defaults to yesterday UTC).
//                    Used to backfill a missed run, or to render a snapshot
//                    for any historical day.
//   ?to=a@b.com[,c@d.com] — override the recipient list with a one-off
//                    address (or comma-separated list). Lets us send a test
//                    only to ourselves before going wide.
//
// Auth supports either Bearer token (matches cron) or ?secret= query param so
// this route can be hit from a browser tab.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    const querySecret = new URL(req.url).searchParams.get('secret') ?? '';
    if (auth !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';
  const dateOverride = url.searchParams.get('date') ?? undefined;
  const toOverride = url.searchParams.get('to');

  try {
    const data = await buildSnapshot({ targetDateISO: dateOverride });
    const html = renderSnapshotHTML(data);
    const subject = renderSnapshotSubject(data);

    if (dry) {
      // Return the HTML directly so the admin can preview in a browser tab.
      // Status 200, content-type text/html — Vercel/Next will serve as-is.
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Precedence: ?to= one-off test override → the "Daily Snapshot" checkboxes
    // (app_users.snapshot). The checkbox is the source of truth; ?to= only
    // exists to send a test to yourself without emailing the whole list.
    const recipients = toOverride ? parseRecipients(toOverride) : await getSnapshotRecipients();
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: 'No recipients (nobody has the Daily Snapshot box checked; or pass ?to=…)' },
        { status: 400 },
      );
    }

    const { id } = await sendEmail({ to: recipients, subject, html });

    return NextResponse.json({
      ok: true,
      sent: true,
      messageId: id,
      targetDateISO: data.targetDateISO,
      recipients,
      subject,
      totals: data.totals,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
