import { supabase } from './supabase';
import type { Conversation, ConversationNote } from './types';

// ── Conversations ──────────────────────────────────────────────────────────

export async function dbInsertConversation(c: Conversation): Promise<void> {
  try {
    const { error } = await supabase.from('conversations').insert({
      id: c.id,
      title: c.title,
      sentiment: c.sentiment,
      intent: c.intent,
      summary: c.summary,
      intercom_id: c.intercom_id,
      original_text: c.original_text,
      analyzed_at: c.analyzed_at,
      dissatisfaction_severity: c.dissatisfaction_severity,
      issue_category: c.issue_category,
      resolution_status: c.resolution_status,
      language: c.language,
      agent_performance_score: c.agent_performance_score,
      agent_performance_notes: c.agent_performance_notes,
      key_quotes: c.key_quotes,
      recommended_action: c.recommended_action,
      is_alert_worthy: c.is_alert_worthy,
      alert_reason: c.alert_reason,
    });
    if (error) console.error('[db] insert conversation:', error.message);
  } catch (e) {
    console.error('[db] insert conversation exception:', e);
  }
}

export async function dbUpdateConversation(c: Conversation): Promise<void> {
  try {
    const { error } = await supabase
      .from('conversations')
      .update({
        title: c.title,
        sentiment: c.sentiment,
        intent: c.intent,
        summary: c.summary,
        intercom_id: c.intercom_id,
        original_text: c.original_text,
        analyzed_at: c.analyzed_at,
        dissatisfaction_severity: c.dissatisfaction_severity,
        issue_category: c.issue_category,
        resolution_status: c.resolution_status,
        language: c.language,
        agent_performance_score: c.agent_performance_score,
        agent_performance_notes: c.agent_performance_notes,
        key_quotes: c.key_quotes,
        recommended_action: c.recommended_action,
        is_alert_worthy: c.is_alert_worthy,
        alert_reason: c.alert_reason,
      })
      .eq('id', c.id);
    if (error) console.error('[db] update conversation:', error.message);
  } catch (e) {
    console.error('[db] update conversation exception:', e);
  }
}

export async function dbDeleteConversation(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('conversations').delete().eq('id', id);
    if (error) console.error('[db] delete conversation:', error.message);
  } catch (e) {
    console.error('[db] delete conversation exception:', e);
  }
}

// ── Notes ──────────────────────────────────────────────────────────────────

export async function dbInsertNote(convId: string, note: ConversationNote): Promise<void> {
  try {
    const { error } = await supabase.from('conversation_notes').insert({
      id: note.id,
      conversation_id: convId,
      author: note.author,
      text: note.text,
      is_system: note.system,
      created_at: note.ts,
    });
    if (error) console.error('[db] insert note:', error.message);
  } catch (e) {
    console.error('[db] insert note exception:', e);
  }
}

export async function dbUpdateNote(note: ConversationNote): Promise<void> {
  try {
    const { error } = await supabase
      .from('conversation_notes')
      .update({ text: note.text })
      .eq('id', note.id);
    if (error) console.error('[db] update note:', error.message);
  } catch (e) {
    console.error('[db] update note exception:', e);
  }
}

export async function dbDeleteNote(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('conversation_notes').delete().eq('id', id);
    if (error) console.error('[db] delete note:', error.message);
  } catch (e) {
    console.error('[db] delete note exception:', e);
  }
}

// ── Load all state ─────────────────────────────────────────────────────────

export async function loadFromSupabase(): Promise<{
  conversations: Conversation[];
} | null> {
  try {
    const [cRes, cnRes] = await Promise.all([
      supabase.from('conversations').select('*').order('analyzed_at'),
      supabase.from('conversation_notes').select('*').order('created_at'),
    ]);

    if (cRes.error) throw cRes.error;

    const conversations: Conversation[] = (cRes.data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      sentiment: c.sentiment,
      intent: c.intent ?? '',
      summary: c.summary ?? '',
      intercom_id: c.intercom_id ?? null,
      original_text: c.original_text ?? null,
      analyzed_at: c.analyzed_at ?? new Date().toISOString(),
      dissatisfaction_severity: c.dissatisfaction_severity ?? 'Low',
      issue_category: c.issue_category ?? '',
      resolution_status: c.resolution_status ?? 'Unresolved',
      language: c.language ?? 'en',
      agent_performance_score: c.agent_performance_score ?? null,
      agent_performance_notes: c.agent_performance_notes ?? '',
      key_quotes: c.key_quotes ?? '',
      recommended_action: c.recommended_action ?? '',
      is_alert_worthy: c.is_alert_worthy ?? false,
      alert_reason: c.alert_reason ?? null,
      notes: !cnRes.error
        ? (cnRes.data ?? [])
            .filter((n) => n.conversation_id === c.id)
            .map((n) => ({
              id: n.id,
              author: n.author,
              text: n.text,
              ts: n.created_at,
              system: n.is_system,
            }))
        : [],
    }));

    return { conversations };
  } catch (e) {
    console.error('[db] loadFromSupabase failed:', e);
    return null;
  }
}
