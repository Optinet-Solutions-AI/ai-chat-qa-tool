import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { cestDateToUnixRange, intercomHeaders, rateLimitResetMsg } from '@/lib/intercom';
import { supabase } from '@/lib/supabase';

// GET ?date=YYYY-MM-DD
// Fetches all DB conversations for the date and checks their current state
// from Intercom — to identify why our count differs from Intercom's UI report.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
  }

  const apiKey = process.env.INTERCOM_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'INTERCOM_API_KEY not configured' }, { status: 500 });

  try {
    const [startUnix, endUnix] = cestDateToUnixRange(date);
    const startISO = new Date(startUnix * 1000).toISOString();
    const endISO   = new Date(endUnix   * 1000).toISOString();

    // Pull all DB rows for the date
    const allRows: { intercom_id: string; is_bot_handled: boolean }[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('conversations')
        .select('intercom_id, is_bot_handled')
        .gte('intercom_created_at', startISO)
        .lte('intercom_created_at', endISO)
        .range(from, from + 499);
      if (error) throw new Error(error.message);
      allRows.push(...(data ?? []));
      if ((data ?? []).length < 500) break;
      from += 500;
    }

    const headers = { ...intercomHeaders(apiKey), 'Content-Type': 'application/json' };

    // Search Intercom with chat filter — same as our sync
    const searchRes = await fetch('https://api.intercom.io/conversations/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: {
          operator: 'AND',
          value: [
            { field: 'created_at', operator: '>=', value: startUnix },
            { field: 'created_at', operator: '<=', value: endUnix },
            { field: 'source.type', operator: '=', value: 'conversation' },
          ],
        },
        select: ['id', 'state', 'open'],
        pagination: { per_page: 1 },
      }),
    });

    if (!searchRes.ok) throw new Error(`Intercom search failed: ${searchRes.status}`);
    const searchData = await searchRes.json() as { total_count?: number };

    // Search without chat filter to get total across all channels
    const allChannelsRes = await fetch('https://api.intercom.io/conversations/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: {
          operator: 'AND',
          value: [
            { field: 'created_at', operator: '>=', value: startUnix },
            { field: 'created_at', operator: '<=', value: endUnix },
          ],
        },
        pagination: { per_page: 1 },
      }),
    });
    const allChannelsData = allChannelsRes.ok ? await allChannelsRes.json() as { total_count?: number } : null;

    // DB breakdown
    const botHandled   = allRows.filter((r) => r.is_bot_handled).length;
    const humanHandled = allRows.filter((r) => !r.is_bot_handled).length;

    return NextResponse.json({
      date,
      db_count: allRows.length,
      db_breakdown: {
        bot_handled: botHandled,
        human_handled: humanHandled,
      },
      intercom_chat_api_count: searchData.total_count ?? 'unknown',
      intercom_all_channels_count: allChannelsData?.total_count ?? 'unknown',
      note: 'Intercom UI "New conversations" report may exclude bot-handled or reopened conversations.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('reset')) return NextResponse.json({ error: msg }, { status: 429 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
