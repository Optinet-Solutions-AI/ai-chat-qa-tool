import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { dbGetAsanaConversationContext, dbUpdateAsanaTaskGid } from '@/lib/db';
import { createAsanaTaskForConversation, isAsanaConfigured } from '@/lib/asana';
import { parseAnalysisSummary, normalizeSeverity } from '@/lib/analyticsFilters';

// Forces creation of an Asana ticket for a single conversation regardless of
// dissatisfaction severity. Used to verify the integration end-to-end without
// waiting for a real Level-3 chat to arrive.
//
// Usage:
//   GET /api/admin/test-asana-ticket?agent=Ben          (most recent analyzed)
//   GET /api/admin/test-asana-ticket?id=<conv_id>
//   GET /api/admin/test-asana-ticket?intercom_id=<id>
//   &force=1   bypass dedup (clears existing asana_task_gid first)
//
// Auth (optional): set CRON_SECRET and pass either:
//   - Authorization: Bearer <secret>      (curl / Postman)
//   - ?secret=<secret>                    (browser-friendly)

interface ConversationRow {
  id: string;
  summary: string | null;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    const querySecret = new URL(req.url).searchParams.get('secret') ?? '';
    if (auth !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!isAsanaConfigured()) {
    return NextResponse.json(
      { error: 'Asana not configured — set ASANA_ACCESS_TOKEN and ASANA_PROJECT_GID' },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const intercomId = searchParams.get('intercom_id');
  const agent = searchParams.get('agent');
  const force = searchParams.get('force') === '1';

  if (!id && !intercomId && !agent) {
    return NextResponse.json(
      { error: 'Pass one of: id, intercom_id, agent' },
      { status: 400 },
    );
  }

  let row: ConversationRow | null = null;

  if (id) {
    const { data } = await supabase
      .from('conversations')
      .select('id, summary')
      .eq('id', id)
      .single();
    row = data as ConversationRow | null;
  } else if (intercomId) {
    const { data } = await supabase
      .from('conversations')
      .select('id, summary')
      .eq('intercom_id', intercomId)
      .single();
    row = data as ConversationRow | null;
  } else if (agent) {
    const { data } = await supabase
      .from('conversations')
      .select('id, summary')
      .eq('agent_name', agent)
      .not('summary', 'is', null)
      .order('intercom_created_at', { ascending: false })
      .limit(1)
      .single();
    row = data as ConversationRow | null;
  }

  if (!row) {
    return NextResponse.json(
      { error: 'No matching conversation found' },
      { status: 404 },
    );
  }
  if (!row.summary) {
    return NextResponse.json(
      { error: 'Conversation has no analysis summary; cannot build ticket body' },
      { status: 400 },
    );
  }

  if (force) {
    await supabase
      .from('conversations')
      .update({ asana_task_gid: null })
      .eq('id', row.id);
  }

  const ctx = await dbGetAsanaConversationContext(row.id);
  if (!ctx) {
    return NextResponse.json({ error: 'Could not load conversation context' }, { status: 500 });
  }
  if (ctx.asana_task_gid) {
    return NextResponse.json({
      message: 'Ticket already exists for this conversation; pass &force=1 to recreate',
      conversation_id: row.id,
      existing_gid: ctx.asana_task_gid,
      existing_url: `https://app.asana.com/0/0/${ctx.asana_task_gid}`,
    });
  }

  const parsed = parseAnalysisSummary(row.summary);
  const normalizedSev = normalizeSeverity(parsed.dissatisfaction_severity);
  const issueCategories: string[] = [];
  for (const r of parsed.results ?? []) {
    if (r.category) issueCategories.push(String(r.category).trim());
  }

  const gid = await createAsanaTaskForConversation({
    conversationId: row.id,
    intercomId: ctx.intercom_id,
    playerName: ctx.player_name,
    playerEmail: ctx.player_email,
    agentName: ctx.agent_name,
    agentEmail: ctx.agent_email,
    brand: ctx.brand,
    severity: normalizedSev ?? 'Test',
    resolutionStatus: parsed.resolution_status,
    issueCategories,
    summaryText: row.summary,
  });

  if (!gid) {
    return NextResponse.json(
      { error: 'Asana create returned null — check server logs for [asana] entries' },
      { status: 502 },
    );
  }

  await dbUpdateAsanaTaskGid(row.id, gid);

  return NextResponse.json({
    success: true,
    conversation_id: row.id,
    matched_agent: ctx.agent_name,
    severity_in_summary: normalizedSev,
    asana_task_gid: gid,
    asana_task_url: `https://app.asana.com/0/0/${gid}`,
  });
}
