import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  dbGetActivePrompt,
  dbGetConversationsByIssueBeforeCutoff,
  dbCountConversationsByIssueBeforeCutoff,
} from '@/lib/db';
import { analyzeBatchSequential } from '@/lib/analyze-sync';

// Re-runs a batch of conversations that were tagged with a specific issue
// label (e.g. "Slow response times") under the previous (gpt-5-mini) model,
// so they get re-evaluated by gpt-4o. Designed to be called in a loop until
// `remaining` reaches 0.
//
// POST /api/admin/reanalyze-by-issue?issue=<label>&cutoff=<ISO>&limit=<N>
//   - Authenticates with CRON_SECRET
//   - Loads up to `limit` conversations whose summary contains <label> and
//     whose analyzed_at is before <cutoff>
//   - Runs them sequentially via analyzeBatchSequential (15s spacing,
//     gpt-4o, 429 retry-with-backoff)
//   - Returns analyzed/failed counts plus `remaining` so a calling script
//     knows whether to keep looping
//
// Sized to fit the 300s Vercel timeout: limit=10 → ~150s, limit=16 → ~240s.
export const maxDuration = 300;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 16;

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

  const issue = req.nextUrl.searchParams.get('issue')?.trim();
  if (!issue) {
    return NextResponse.json({ error: 'issue query param is required' }, { status: 400 });
  }

  const cutoff = req.nextUrl.searchParams.get('cutoff')?.trim();
  if (!cutoff) {
    return NextResponse.json({ error: 'cutoff query param is required (ISO timestamp)' }, { status: 400 });
  }
  if (Number.isNaN(Date.parse(cutoff))) {
    return NextResponse.json({ error: 'cutoff is not a valid ISO timestamp' }, { status: 400 });
  }

  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? DEFAULT_LIMIT : limitParam), MAX_LIMIT);

  const prompt = await dbGetActivePrompt();
  if (!prompt) {
    return NextResponse.json({ error: 'No active prompt found' }, { status: 500 });
  }

  const conversations = await dbGetConversationsByIssueBeforeCutoff(issue, cutoff, limit);

  if (conversations.length === 0) {
    return NextResponse.json({
      issue,
      cutoff,
      remaining: 0,
      processed: 0,
      analyzed: 0,
      failed: 0,
      results: [],
      done: true,
    });
  }

  const results = await analyzeBatchSequential(conversations, prompt, apiKey);

  const analyzed = results.filter((r) => r.status === 'analyzed').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  // After we've re-analyzed this batch, count what's still pending. Note: a
  // conversation's row drops out of this count only if gpt-4o produced a
  // summary that no longer contains the issue substring. If gpt-4o agrees
  // with the old verdict, the row stays — but its analyzed_at is now past
  // the cutoff, so it's still excluded from future iterations.
  const remaining = await dbCountConversationsByIssueBeforeCutoff(issue, cutoff);

  return NextResponse.json({
    issue,
    cutoff,
    remaining,
    processed: conversations.length,
    analyzed,
    failed,
    results,
    done: remaining === 0,
  });
}
