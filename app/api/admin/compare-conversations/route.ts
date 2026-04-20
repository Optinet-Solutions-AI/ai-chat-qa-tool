import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { cestDateToUnixRange } from '@/lib/intercom';
import { supabase } from '@/lib/supabase';

// POST { date, intercomIds: string[] }
// Compares a provided list of Intercom IDs (from Val's CSV export) against
// what we have in the DB for that date, and returns the extras in our DB.
export async function POST(req: NextRequest) {
  let body: { date: string; intercomIds: string[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { date, intercomIds } = body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 });
  }
  if (!Array.isArray(intercomIds) || intercomIds.length === 0) {
    return NextResponse.json({ error: 'intercomIds array required' }, { status: 400 });
  }

  const [startUnix, endUnix] = cestDateToUnixRange(date);
  const startISO = new Date(startUnix * 1000).toISOString();
  const endISO   = new Date(endUnix   * 1000).toISOString();

  // Get all DB rows for that date
  const dbRows: { id: string; intercom_id: string | null }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, intercom_id')
      .gte('intercom_created_at', startISO)
      .lte('intercom_created_at', endISO)
      .range(from, from + 499);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    dbRows.push(...(data ?? []));
    if ((data ?? []).length < 500) break;
    from += 500;
  }

  const csvSet = new Set(intercomIds.map((id) => String(id)));
  const dbSet  = new Set(dbRows.map((r) => r.intercom_id).filter(Boolean));

  // In our DB but NOT in Val's CSV
  const extraInDb = dbRows.filter((r) => r.intercom_id && !csvSet.has(String(r.intercom_id)));
  // In Val's CSV but NOT in our DB
  const missingFromDb = intercomIds.filter((id) => !dbSet.has(String(id)));

  return NextResponse.json({
    date,
    csv_count: intercomIds.length,
    db_count: dbRows.length,
    extra_in_db_count: extraInDb.length,
    missing_from_db_count: missingFromDb.length,
    extra_in_db: extraInDb.map((r) => ({ id: r.id, intercom_id: r.intercom_id })),
    missing_from_db: missingFromDb,
  });
}
