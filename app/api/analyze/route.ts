import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';


async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  openAIKey: string
): Promise<Record<string, unknown>> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAIKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI API error');

  const messageContent = data.choices[0]?.message?.content;
  if (!messageContent) throw new Error('OpenAI returned an empty response.');

  const jsonMatch = (messageContent as string).match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not find a valid JSON object in the AI response.');

  return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
}

async function analyzeSingleConversation(
  body: Record<string, unknown>,
  openAIKey: string,
  systemPrompt: string
): Promise<Record<string, unknown>> {
  const {
    conversation_id = 'unknown',
    player_id = 'unknown',
    agent_name = 'Unknown',
    transcript,
    intercom_link = '',
    is_bot_handled = false,
    messages,
    text,
    intercomId,
  } = body as {
    conversation_id?: string;
    player_id?: string;
    agent_name?: string;
    transcript?: string;
    intercom_link?: string;
    is_bot_handled?: boolean;
    messages?: unknown[];
    text?: string;
    intercomId?: string;
  };

  let contentToAnalyze = transcript;

  if (!contentToAnalyze && intercomId) {
    const intercomApiKey = process.env.INTERCOM_API_KEY;
    if (!intercomApiKey) {
      throw new Error('Server misconfiguration: INTERCOM_API_KEY not found.');
    }

    const intercomRes = await fetch(`https://api.intercom.io/conversations/${intercomId}`, {
      headers: {
        Authorization: `Bearer ${intercomApiKey}`,
        Accept: 'application/json',
        'Intercom-Version': '2.9',
      },
    });

    if (!intercomRes.ok) {
      const errorBody = await intercomRes.text();
      console.error('Intercom API Error:', errorBody);
      throw new Error(`Intercom API responded with ${intercomRes.status}`);
    }

    const conversationData = await intercomRes.json() as {
      conversation_parts?: {
        conversation_parts?: Array<{
          part_type: string;
          body: string;
          author: { type: string };
        }>;
      };
    };

    if (!conversationData.conversation_parts?.conversation_parts) {
      throw new Error('Invalid conversation format from Intercom.');
    }

    contentToAnalyze = conversationData.conversation_parts.conversation_parts
      .filter((part) => part.part_type === 'comment' && part.body)
      .map((part) => {
        const author = part.author.type === 'admin' ? 'Agent' : 'User';
        const bodyText = (part.body || '').replace(/<[^>]*>?/gm, '').trim();
        return `${author}: ${bodyText}`;
      })
      .join('\n\n');
  } else if (!contentToAnalyze && Array.isArray(messages) && messages.length > 0) {
    contentToAnalyze = JSON.stringify(messages);
  } else if (!contentToAnalyze && text) {
    contentToAnalyze = text;
  }

  if (!contentToAnalyze || contentToAnalyze.trim().length === 0) {
    throw new Error(`Empty transcript for conversation ${conversation_id}`);
  }

  const MAX_CHARS = 60000;
  const truncated =
    contentToAnalyze.length > MAX_CHARS
      ? contentToAnalyze.substring(0, MAX_CHARS) + '\n\n[Transcript truncated]'
      : contentToAnalyze;

  const userMessage = `Conversation ID: ${conversation_id}\nPlayer ID: ${player_id}\nAgent: ${agent_name}\nIs Bot Handled: ${is_bot_handled}\n\nTranscript:\n${truncated}`;
  const analysis = await callOpenAI(systemPrompt, userMessage, openAIKey);

  analysis.conversation_id = conversation_id;
  analysis.player_id = player_id;
  analysis.agent_name = agent_name;
  analysis.intercom_link =
    intercom_link || (intercomId ? `https://app.intercom.com/a/inbox/conversations/${intercomId}` : '');
  analysis.is_bot_handled = is_bot_handled;

  return analysis;
}

async function analyzeIntercomBatch(
  openAIKey: string,
  systemPrompt: string
): Promise<Record<string, unknown>[]> {
  const intercomApiKey = process.env.INTERCOM_API_KEY;
  if (!intercomApiKey) {
    throw new Error('Server misconfiguration: INTERCOM_API_KEY not found');
  }

  const twentyFourHoursAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const searchPayload = {
    query: {
      operator: 'AND',
      value: [
        { field: 'updated_at', operator: '>', value: twentyFourHoursAgo },
        { field: 'state', operator: '=', value: 'closed' },
      ],
    },
    pagination: { per_page: 5 },
    sort: { field: 'updated_at', order: 'descending' },
  };

  const searchRes = await fetch('https://api.intercom.io/conversations/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${intercomApiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.9',
    },
    body: JSON.stringify(searchPayload),
  });

  if (!searchRes.ok) throw new Error(`Intercom API responded with ${searchRes.status}`);

  const searchData = await searchRes.json() as {
    conversations?: Array<{
      id: string;
      conversation_parts?: {
        conversation_parts?: Array<{
          part_type: string;
          body: string;
          author: { type: string; name?: string };
        }>;
      };
      contacts?: { contacts?: Array<{ id: string }> };
      teammates?: Array<{ type: string }>;
      created_at?: string;
    }>;
  };

  const conversations = searchData.conversations || [];
  if (conversations.length === 0) return [];

  const analysisPromises = conversations.map(async (convo) => {
    try {
      const MAX_CHARS = 60000;
      let transcript = (convo.conversation_parts?.conversation_parts || [])
        .filter((part) => part.part_type === 'comment' && part.body)
        .map(
          (part) =>
            `${part.author.type === 'admin' ? 'Agent' : 'User'}: ${(part.body || '')
              .replace(/<[^>]*>?/gm, '')
              .trim()}`
        )
        .join('\n\n');

      if (!transcript) return null;

      if (transcript.length > MAX_CHARS) {
        transcript = transcript.substring(0, MAX_CHARS) + '\n\n[Transcript truncated]';
      }

      const firstAdmin = (convo.conversation_parts?.conversation_parts || []).find(
        (part) => part.author?.type === 'admin'
      );
      const agentName = firstAdmin?.author?.name || 'Unknown';
      const isBotHandled = convo.teammates?.some((t) => t.type === 'bot') ?? false;

      const userMessage = `Conversation ID: ${convo.id}\nPlayer ID: ${convo.contacts?.contacts?.[0]?.id || 'unknown'}\nAgent: ${agentName}\nIs Bot Handled: ${isBotHandled}\n\nTranscript:\n${transcript}`;
      const analysisResult = await callOpenAI(systemPrompt, userMessage, openAIKey);

      return {
        ...analysisResult,
        conversation_id: convo.id,
        player_id: convo.contacts?.contacts?.[0]?.id || 'unknown',
        agent_name: agentName,
        is_bot_handled: isBotHandled,
        intercom_link: `https://app.intercom.com/a/inbox/conversations/${convo.id}`,
        created_at: convo.created_at,
      };
    } catch (error) {
      console.error(`Failed to analyze conversation ${convo.id}:`, error);
      return null;
    }
  });

  const settled = await Promise.all(analysisPromises);
  const results = settled.filter((r) => r !== null) as Record<string, unknown>[];
  return results;
}

export async function POST(req: NextRequest) {
  const openAIKey = process.env.OPENAI_API_KEY;
  if (!openAIKey) {
    return NextResponse.json(
      { error: 'Server misconfiguration: OPENAI_API_KEY not found' },
      { status: 500 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { customSystemPrompt, fetchIntercom } = body as {
    customSystemPrompt?: string;
    fetchIntercom?: boolean;
  };

  if (!customSystemPrompt?.trim()) {
    return NextResponse.json({ error: 'No prompt configured. Add a prompt in the Prompt Library first.' }, { status: 400 });
  }

  const systemPrompt = customSystemPrompt;

  try {
    if (fetchIntercom) {
      const analyses = await analyzeIntercomBatch(openAIKey, systemPrompt);
      return NextResponse.json({
        message: `Analyzed ${analyses.length} conversations from Intercom`,
        analyses,
      });
    } else {
      const analysis = await analyzeSingleConversation(body, openAIKey, systemPrompt);
      return NextResponse.json(analysis);
    }
  } catch (error) {
    console.error('Analysis Error:', error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Failed to parse AI response as JSON.' },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
