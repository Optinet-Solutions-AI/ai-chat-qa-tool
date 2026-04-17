import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { toolSchemas, executeTool, type ToolCallResult } from '@/lib/ai-tools';
import { dbInsertAiQuery } from '@/lib/db';

export const maxDuration = 60;

const MODEL = 'gpt-4o-mini';
const MAX_TOOL_ITERATIONS = 6;

function systemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  const d30 = new Date(); d30.setDate(d30.getDate() - 30);
  const last30Start = d30.toISOString().slice(0, 10);

  return `You are an analytics assistant for a customer-support QA platform. Data covers support conversations analyzed for issues, sentiment, resolution status, and agent performance.

Today's date is ${today}. "Last 30 days" = ${last30Start} to ${today}.

## Rules

1. **Stay on topic.** Answer only questions about support conversation analytics (issues, concerns, sentiment, resolution, agent performance, alerts, brands, counts, query types, etc.). For off-topic questions reply exactly:
   "This question isn't about our support conversation data. Please ask about customer concerns, agent performance, issue categories, resolution rates, or similar analytics."

2. **Always ground answers in tool data.** Never fabricate numbers. If a date range isn't given, use the last 30 days.

3. **Date parsing**:
   - "last month" / "past month" → last 30 days from today
   - "last week" → last 7 days from today
   - "this month" → first of current month to today
   - "march" / specific month → the full calendar month

4. **Handling empty results — this is critical:**
   If a tool returns an empty array \`[]\` or zero data:
   - Do NOT just say "no data". First investigate why.
   - Call \`data_coverage\` for the same date range to see which fields are populated.
   - If the question was about agent ratings/performance and those fields are sparse, fall back to \`top_agents_by_volume\` and tell the user: "Customer ratings are only available for X of Y conversations, so I'm showing agents by conversation volume instead."
   - If the AI-analyzed fields are empty (summary, sentiment, etc.), tell the user: "These conversations haven't been analyzed yet. Run Batch Analysis to generate insights."

5. **For "best agent" questions specifically:**
   - First try \`agent_performance_leaderboard\` with metric='rating'
   - If empty, try metric='performance'
   - If still empty, fall back to \`top_agents_by_volume\` and explain the ranking is by volume since rating/score data is missing

6. **Format answers** as short paragraphs or bullet lists. No JSON, no markdown tables with pipe chars. Convert scores to readable form (e.g. "4.2/5 from 28 ratings"). Use human names, never IDs.

7. **Be honest about limitations.** If only partial data exists (e.g. "only 12 of 450 conversations have ratings"), say so.`;
}

// ── POST: ask a question ──────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const openAIKey = process.env.OPENAI_API_KEY;
  if (!openAIKey) return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });

  let body: { question: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const question = (body.question ?? '').trim();
  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ error: 'Question too long (max 500 chars)' }, { status: 400 });

  // Message history for the tool-calling loop
  const messages: unknown[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: question },
  ];

  const toolsUsed: ToolCallResult[] = [];
  let finalAnswer = '';

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIKey}` },
        body: JSON.stringify({
          model: MODEL,
          messages,
          tools: toolSchemas,
          tool_choice: iter === MAX_TOOL_ITERATIONS - 1 ? 'none' : 'auto',
          temperature: 0.2,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'OpenAI error');

      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error('Empty OpenAI response');
      messages.push(msg);

      const toolCalls = msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;

      if (!toolCalls || toolCalls.length === 0) {
        finalAnswer = (msg.content ?? '').trim();
        break;
      }

      // Execute each tool call and feed the results back
      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); }
        catch { args = {}; }

        const result = await executeTool(tc.function.name, args);
        toolsUsed.push(result);

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result.error ? { error: result.error } : result.result),
        });
      }
    }

    if (!finalAnswer) finalAnswer = 'I was unable to form an answer from the available data.';

    const isIrrelevant = /isn't about our support conversation data/i.test(finalAnswer);

    // Save to DB
    let saved;
    try {
      saved = await dbInsertAiQuery({
        question,
        answer: finalAnswer,
        tools_used: toolsUsed,
        is_irrelevant: isIrrelevant,
      });
    } catch (e) {
      console.error('[ask-ai] save failed:', (e as Error).message);
    }

    return NextResponse.json({
      id: saved?.id ?? null,
      question,
      answer: finalAnswer,
      tools_used: toolsUsed,
      is_irrelevant: isIrrelevant,
      created_at: saved?.created_at ?? new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
