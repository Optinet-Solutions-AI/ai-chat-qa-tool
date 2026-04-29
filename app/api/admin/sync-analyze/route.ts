import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getUnanalyzedConversationsPage,
  dbGetActivePrompt,
} from '@/lib/db';
import { ANALYSIS_MIN_DATE_ISO } from '@/lib/analyticsFilters';
import { analyzeConversationSync, type SyncAnalysisResult } from '@/lib/analyze-sync';

// Manual sync-analysis catch-up — used when the autonomous cron is behind or
// when verifying the sync path during incidents. The hourly cron uses the
// same lib/analyze-sync helper, so any output here matches what the dashboard
// gets from autonomous runs.
//
// POST /api/admin/sync-analyze?limit=N
//   - Authenticates with CRON_SECRET
//   - Pulls N (default 5, max 10) oldest unanalyzed April-27+ conversations
//   - Runs them through gpt-5-mini in parallel
//   - Writes summaries + analysis_runs inline
export const maxDuration = 300;

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

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

  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? DEFAULT_LIMIT : limitParam), MAX_LIMIT);

  const prompt = await dbGetActivePrompt();
  if (!prompt) {
    return NextResponse.json({ error: 'No active prompt found' }, { status: 500 });
  }

  const conversations = await getUnanalyzedConversationsPage(0, limit, {
    fromDate: ANALYSIS_MIN_DATE_ISO,
  });

  if (conversations.length === 0) {
    return NextResponse.json({ message: 'No unanalyzed April-27+ conversations remain.', analyzed: 0, failed: 0 });
  }

  const settled = await Promise.allSettled(
    conversations.map((conv) => analyzeConversationSync(conv, prompt, apiKey)),
  );

  const results: SyncAnalysisResult[] = settled.map((s) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          conversation_id: 'unknown',
          intercom_id: null,
          status: 'failed' as const,
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        },
  );

  const analyzed = results.filter((r) => r.status === 'analyzed').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  return NextResponse.json({
    requested: conversations.length,
    analyzed,
    failed,
    results,
  });
}
