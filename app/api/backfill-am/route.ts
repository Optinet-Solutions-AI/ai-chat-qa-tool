import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { amFromGroups } from '@/lib/utils';

// Allow up to 5 minutes for large datasets
export const maxDuration = 300;

export async function POST() {
  const pageSize = 500;

  // Read ALL null-AM rows first, then write — writing as we paginate would set
  // account_manager non-null and shift rows out of the `is null` filter, making
  // the offset cursor skip unread rows. Derivation uses the shared groups-first
  // resolver so the backfilled value matches what getAccountManager reads.
  const toUpdate: Array<{ id: string; am: string }> = [];
  let skipped = 0;
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, player_tags, player_segments, tags, player_companies')
      .is('account_manager', null)
      // Stable cursor: unordered .range() pagination over a large table can skip
      // or duplicate rows between pages (PostgREST gives no ordering guarantee),
      // so a single backfill pass would silently miss rows. Order by id.
      .order('id', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;

    for (const row of data) {
      const companyNames = (row.player_companies ?? []).map((c: { name?: string }) => c.name ?? '');
      const am = amFromGroups([
        ...(row.player_tags ?? []),
        ...(row.player_segments ?? []),
        ...(row.tags ?? []),
        ...companyNames,
      ]);
      if (am) toUpdate.push({ id: row.id, am });
      else skipped++;
    }

    if (data.length < pageSize) break;
    page++;
  }

  let updated = 0;
  for (const { id, am } of toUpdate) {
    const { error: updateError } = await supabase
      .from('conversations')
      .update({ account_manager: am })
      .eq('id', id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    updated++;
  }

  return NextResponse.json({ updated, skipped });
}
