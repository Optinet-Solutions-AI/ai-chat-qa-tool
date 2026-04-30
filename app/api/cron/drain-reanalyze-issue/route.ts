import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  dbGetActivePrompt,
  dbGetConversationsByIssueBeforeCutoff,
  dbCountConversationsByIssueBeforeCutoff,
} from '@/lib/db';
import { ANALYSIS_MIN_DATE_ISO } from '@/lib/analyticsFilters';
import { analyzeBatchSequential } from '@/lib/analyze-sync';

// Server-side drain cron for re-analyzing conversations that gpt-5-mini
// tagged with a stale issue label before the gpt-4o switchover. Each tick
// processes one batch (LIMIT conversations) via the same shared helper the
// admin endpoint uses; becomes a no-op once the queue is drained. Once the
// dashboard count for ISSUE stabilizes the cron entry in vercel.json can
// be deleted (or left as a near-zero-cost no-op — each tick only runs a
// COUNT query when nothing matches).
//
// Schedule is staggered from /api/cron/analyze-daily so the two don't
// race for gpt-4o's 30k TPM budget at the same minute.

export const maxDuration = 300;

const ISSUE  = 'Slow response times';
const CUTOFF = '2026-04-30T13:30:00Z';
const LIMIT  = 10;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  const prompt = await dbGetActivePrompt();
  if (!prompt) {
    return NextResponse.json({ error: 'No active prompt found' }, { status: 500 });
  }

  let conversations;
  try {
    conversations = await dbGetConversationsByIssueBeforeCutoff(
      ISSUE,
      CUTOFF,
      ANALYSIS_MIN_DATE_ISO,
      LIMIT,
    );
  } catch (e) {
    console.error('[cron] drain-reanalyze-issue lookup error:', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  if (conversations.length === 0) {
    console.log('[cron] drain-reanalyze-issue: drained, no-op');
    return NextResponse.json({
      issue: ISSUE,
      done: true,
      remaining: 0,
      processed: 0,
      analyzed: 0,
      failed: 0,
    });
  }

  const results  = await analyzeBatchSequential(conversations, prompt, apiKey);
  const analyzed = results.filter((r) => r.status === 'analyzed').length;
  const failed   = results.filter((r) => r.status === 'failed').length;

  const remaining = await dbCountConversationsByIssueBeforeCutoff(
    ISSUE,
    CUTOFF,
    ANALYSIS_MIN_DATE_ISO,
  );

  console.log(
    `[cron] drain-reanalyze-issue: processed=${conversations.length} analyzed=${analyzed} failed=${failed} remaining=${remaining}`,
  );

  return NextResponse.json({
    issue: ISSUE,
    done: remaining === 0,
    remaining,
    processed: conversations.length,
    analyzed,
    failed,
  });
}
