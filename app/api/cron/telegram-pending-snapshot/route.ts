import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildPendingSnapshot, sendTelegramMessage } from '@/lib/telegram-snapshot';
import { pingHeartbeat } from '@/lib/heartbeat';

// Vercel cron tick — posts a "Pending Action Cases Snapshot" to the Telegram
// chat configured via TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID. Schedule lives in
// vercel.json. Manual equivalent (with browser-friendly ?secret= auth and a
// ?dry=1 preview mode) is /api/admin/telegram-pending-snapshot.

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Heartbeat pings live inside the try/catch only — an Unauthorized probe is
  // not a pipeline failure and must not raise an alert.
  try {
    const { total, byAm, message } = await buildPendingSnapshot();
    await sendTelegramMessage(message);
    // Only after the message is actually delivered, so the monitor tracks
    // snapshots reaching the group rather than the route merely being invoked.
    await pingHeartbeat('success');
    return NextResponse.json({
      ok: true,
      total,
      byAm: Object.fromEntries(byAm),
    });
  } catch (e) {
    await pingHeartbeat('fail');
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
