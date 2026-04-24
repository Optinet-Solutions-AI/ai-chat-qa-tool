import { NextResponse } from 'next/server';
import { getConversationById, dbUpdateTranslatedMessages } from '@/lib/db';
import type { RawMessage } from '@/lib/types';

const MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `You translate chat transcript messages to English.
You will receive a JSON object: { "messages": [{ "i": <index>, "body": <string> }, ...] }.
Return a JSON object: { "translations": [{ "i": <index>, "body": <english string> }, ...] }.
Rules:
- Return exactly one translation per input message, with the same "i" index.
- If a message is already in English, return it unchanged.
- Preserve emoji, URLs, numbers, currency symbols, and inline markdown.
- Do not add any extra commentary or notes.
- Keep bracketed system tokens (e.g. "[Conversation Rating Request]") verbatim.`;

async function translateMessages(
  messages: RawMessage[],
  apiKey: string,
): Promise<string[]> {
  const input = {
    messages: messages.map((m, i) => ({ i, body: m.body })),
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(input) },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'OpenAI API error');

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned an empty response.');

  let parsed: { translations?: Array<{ i: number; body: string }> };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('OpenAI returned invalid JSON.');
  }

  const byIndex = new Map<number, string>();
  for (const t of parsed.translations ?? []) {
    if (typeof t?.i === 'number' && typeof t?.body === 'string') byIndex.set(t.i, t.body);
  }

  // Fall back to original body for any message the model skipped, so indices
  // always align with raw_messages and the UI never renders "undefined".
  return messages.map((m, i) => byIndex.get(i) ?? m.body);
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 });

  const { id } = await params;
  try {
    const conv = await getConversationById(id);
    if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const source = conv.raw_messages ?? [];
    if (source.length === 0) {
      return NextResponse.json({ raw_messages_translated: [] });
    }

    // Cache hit: existing translation covers every source message.
    const cached = conv.raw_messages_translated;
    if (cached && cached.length === source.length) {
      return NextResponse.json({ raw_messages_translated: cached });
    }

    const translatedBodies = await translateMessages(source, apiKey);
    const translated: RawMessage[] = source.map((m, i) => ({
      author_type: m.author_type,
      body: translatedBodies[i],
      created_at: m.created_at ?? null,
    }));

    await dbUpdateTranslatedMessages(id, translated);
    return NextResponse.json({ raw_messages_translated: translated });
  } catch (e) {
    console.error('[api/conversations/translate]', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
