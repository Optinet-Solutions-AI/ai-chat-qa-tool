// Shared synchronous-analysis helper used by /api/admin/sync-analyze (manual
// catch-up) and the /api/cron/analyze-daily Step B (autonomous daily flow).
// Both paths must produce identical DB writes so the dashboard sees uniform
// analysis output regardless of how a conversation got analyzed.
//
// We use the synchronous /v1/chat/completions endpoint (not Batch API) for
// reliability — Batch has shown 70%+ failure rates on this org and stalls
// without warning. Sync is ~2× cost but completes in real time and self-heals
// since failed conversations stay summary-IS-NULL and re-enter the queue on
// the next cron tick.

import {
  dbUpdateAnalysisFields,
  dbInsertAnalysisRun,
  dbGetAsanaConversationContext,
  dbUpdateAsanaTaskGid,
  type MinimalConversation,
} from '@/lib/db';
import { generateId } from '@/lib/utils';
import type { AnalysisRun } from '@/lib/types';
import {
  parseAnalysisSummary,
  normalizeSeverity,
  type AnalysisSummary,
} from '@/lib/analyticsFilters';
import { createAsanaTaskForConversation, isAsanaConfigured } from '@/lib/asana';

export interface SyncAnalysisResult {
  conversation_id: string;
  intercom_id: string | null;
  status: 'analyzed' | 'failed';
  error?: string;
  durationMs?: number;
}

function buildUserMessage(conv: MinimalConversation): string {
  return [
    `Conversation ID: ${conv.intercom_id ?? 'N/A'}`,
    `Player: ${conv.player_name ?? 'Unknown'} (${conv.player_email ?? 'no email'})`,
    `Agent: ${conv.agent_name ?? 'Unknown'}`,
    `Brand: ${conv.brand ?? 'Unknown'}`,
    '',
    'Transcript:',
    conv.original_text ?? '',
  ].join('\n');
}

export async function analyzeConversationSync(
  conv: MinimalConversation,
  prompt: { id: string; content: string },
  apiKey: string,
): Promise<SyncAnalysisResult> {
  const startedAt = Date.now();
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: prompt.content },
          { role: 'user', content: buildUserMessage(conv) },
        ],
        // gpt-5-mini reasoning consumes tokens before producing output;
        // 4096 was the empirical floor at which per-request failures stopped.
        max_completion_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      return {
        conversation_id: conv.id,
        intercom_id: conv.intercom_id,
        status: 'failed',
        error: `OpenAI ${res.status}: ${errorBody.slice(0, 300)}`,
        durationMs: Date.now() - startedAt,
      };
    }

    const data = await res.json();
    const analysisText: string | null = data.choices?.[0]?.message?.content ?? null;

    if (!analysisText) {
      return {
        conversation_id: conv.id,
        intercom_id: conv.intercom_id,
        status: 'failed',
        error: `Empty content (finish_reason=${data.choices?.[0]?.finish_reason ?? 'unknown'})`,
        durationMs: Date.now() - startedAt,
      };
    }

    const now = new Date().toISOString();
    await dbUpdateAnalysisFields(conv.id, {
      summary: analysisText,
      last_prompt_id: prompt.id,
      last_prompt_content: prompt.content,
      analyzed_at: now,
    });

    const run: AnalysisRun = {
      id: generateId(),
      conversation_id: conv.id,
      conversation_title: null,
      player_name: null,
      analyzed_at: now,
      prompt_id: prompt.id ?? null,
      prompt_title: null,
      prompt_content: prompt.content ?? '',
      summary: analysisText,
      language: null,
      dissatisfaction_severity: null,
      issue_category: null,
      resolution_status: null,
      key_quotes: null,
      agent_performance_score: null,
      agent_performance_notes: null,
      recommended_action: null,
      is_alert_worthy: false,
      alert_reason: null,
    };
    await dbInsertAnalysisRun(run);

    // Severity-3 → push an action-item ticket into Asana. Wrapped so any
    // Asana-side failure (auth, rate limit, network) is logged but never
    // fails the analysis itself.
    await maybeCreateAsanaTicket(conv.id, analysisText);

    return {
      conversation_id: conv.id,
      intercom_id: conv.intercom_id,
      status: 'analyzed',
      durationMs: Date.now() - startedAt,
    };
  } catch (e) {
    return {
      conversation_id: conv.id,
      intercom_id: conv.intercom_id,
      status: 'failed',
      error: (e as Error).message,
      durationMs: Date.now() - startedAt,
    };
  }
}

// Fires only when the AI-returned summary normalises to severity Level 3.
// Re-fetches the conversation row to get the agent/player/intercom fields not
// present in MinimalConversation, dedups via the asana_task_gid column, and
// swallows all errors so analysis never breaks on Asana-side problems.
async function maybeCreateAsanaTicket(
  conversationId: string,
  summaryText: string,
): Promise<void> {
  if (!isAsanaConfigured()) return;
  try {
    const parsed = parseAnalysisSummary(summaryText);
    if (normalizeSeverity(parsed.dissatisfaction_severity) !== 'Level 3') return;

    const ctx = await dbGetAsanaConversationContext(conversationId);
    if (!ctx || ctx.asana_task_gid) return;

    const gid = await createAsanaTaskForConversation({
      conversationId,
      intercomId: ctx.intercom_id,
      playerName: ctx.player_name,
      playerEmail: ctx.player_email,
      agentName: ctx.agent_name,
      agentEmail: ctx.agent_email,
      brand: ctx.brand,
      severity: 'Level 3',
      resolutionStatus: parsed.resolution_status,
      issueCategories: collectCategories(parsed),
      summaryText,
    });
    if (gid) await dbUpdateAsanaTaskGid(conversationId, gid);
  } catch (e) {
    console.error('[asana] trigger error:', (e as Error).message);
  }
}

function collectCategories(parsed: AnalysisSummary): string[] {
  const set = new Set<string>();
  for (const r of parsed.results ?? []) {
    if (r.category) set.add(String(r.category).trim());
  }
  return [...set];
}
