import { NextResponse } from 'next/server';
import {
  dbInsertConversation,
  dbUpdateConversation,
  dbDeleteConversation,
  dbInsertNote,
  dbUpdateNote,
  dbDeleteNote,
  dbInsertPrompt,
  dbUpdatePrompt,
  dbDeletePrompt,
  dbActivatePrompt,
  dbInsertAnalysisRun,
  loadFromSupabase,
} from '@/lib/db';
import type { Conversation, ConversationNote, PromptVersion, AnalysisRun } from '@/lib/types';

export async function GET() {
  const data = await loadFromSupabase();
  if (!data) return NextResponse.json(null, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: { action: string; payload: any };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, payload } = body;

  try {
    switch (action) {
      case 'insertConversation':  await dbInsertConversation(payload as Conversation); break;
      case 'updateConversation':  await dbUpdateConversation(payload as Conversation); break;
      case 'deleteConversation':  await dbDeleteConversation(payload.id as string); break;
      case 'insertNote':          await dbInsertNote(payload.convId as string, payload.note as ConversationNote); break;
      case 'updateNote':          await dbUpdateNote(payload as ConversationNote); break;
      case 'deleteNote':          await dbDeleteNote(payload.id as string); break;
      case 'insertPrompt':        await dbInsertPrompt(payload as PromptVersion); break;
      case 'updatePrompt':        await dbUpdatePrompt(payload as PromptVersion); break;
      case 'deletePrompt':        await dbDeletePrompt(payload.id as string); break;
      case 'activatePrompt':      await dbActivatePrompt(payload.id as string); break;
      case 'insertAnalysisRun':   await dbInsertAnalysisRun(payload as AnalysisRun); break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[api/db] ${action} error:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
