import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { dbGetConversationsByIds, dbGetActivePrompt } from '@/lib/db';
import { analyzeBatchSequential } from '@/lib/analyze-sync';

// Force re-analysis of specific conversations by id, regardless of whether
// they already have a summary. Used to verify model/prompt changes against
// known-bad cases without waiting for the cron to pick up new conversations.
//
// POST /api/admin/reanalyze?ids=<id1>,<id2>,...
//   - Authenticates with CRON_SECRET
//   - Looks up the given conversation ids
//   - Runs them through analyzeBatchSequential (gpt-4o, 15s spacing to fit
//     the 30k TPM cap; overwrites summary, inserts a fresh analysis_runs row
//     — same write path as the cron)
//
// Capped at 10 ids per call: 10 × ~15s ≈ 135s, well under the 300s timeout.
export const maxDuration = 300;

const MAX_IDS = 10;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });

  const idsParam = req.nextUrl.searchParams.get('ids') ?? '';
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids query param is required (comma-separated)' }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Too many ids (max ${MAX_IDS})` }, { status: 400 });
  }

  const prompt = await dbGetActivePrompt();
  if (!prompt) {
    return NextResponse.json({ error: 'No active prompt found' }, { status: 500 });
  }

  const conversations = await dbGetConversationsByIds(ids);
  const foundIds = new Set(conversations.map((c) => c.id));
  const missing = ids.filter((id) => !foundIds.has(id));

  if (conversations.length === 0) {
    return NextResponse.json({ requested: ids.length, analyzed: 0, failed: 0, missing, results: [] });
  }

  const results = await analyzeBatchSequential(conversations, prompt, apiKey);

  const analyzed = results.filter((r) => r.status === 'analyzed').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  return NextResponse.json({
    requested: ids.length,
    analyzed,
    failed,
    missing,
    results,
  });
}
