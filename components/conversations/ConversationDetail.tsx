'use client';

import { useState } from 'react';
import type { Conversation, ConversationNote, AnalysisResult } from '@/lib/types';
import { useStore } from '@/lib/store';
import { useToast } from '@/components/layout/ToastProvider';
import { generateId, fmtTime } from '@/lib/utils';
import { dbDeleteConversation, dbInsertNote, dbUpdateNote, dbDeleteNote, dbUpdateConversation } from '@/lib/db-client';
import { loadPrompts, getActivePrompt } from '@/lib/prompts';
import AnalysisResultView from './AnalysisResultView';

interface Props {
  conversation: Conversation;
  onClose: () => void;
}

export default function ConversationDetail({ conversation, onClose }: Props) {
  const { updateConversation, deleteConversation, addNote, updateNote, deleteNote, currentUser } = useStore();
  const { toast } = useToast();

  const [noteText, setNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [reanalyzing, setReanalyzing] = useState(false);
  const [analysisPreview, setAnalysisPreview] = useState<AnalysisResult | null>(null);

  // Local view of conversation (may be updated by re-analyze)
  const [conv, setConv] = useState<Conversation>(conversation);

  const handleDelete = () => {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    deleteConversation(conv.id);
    dbDeleteConversation(conv.id);
    toast('Conversation deleted', 'success');
    onClose();
  };

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    const note: ConversationNote = {
      id: generateId(),
      author: currentUser || 'Admin',
      text: noteText.trim(),
      ts: new Date().toISOString(),
      system: false,
    };
    const updated: Conversation = { ...conv, notes: [...conv.notes, note] };
    setConv(updated);
    addNote(conv.id, note);
    dbInsertNote(conv.id, note);
    setNoteText('');
  };

  const handleSaveNote = (note: ConversationNote) => {
    const updated: Conversation = {
      ...conv,
      notes: conv.notes.map((n) => (n.id === note.id ? { ...n, text: editingNoteText } : n)),
    };
    setConv(updated);
    updateNote(conv.id, { ...note, text: editingNoteText });
    dbUpdateNote({ ...note, text: editingNoteText });
    setEditingNoteId(null);
  };

  const handleDeleteNote = (noteId: string) => {
    const updated: Conversation = { ...conv, notes: conv.notes.filter((n) => n.id !== noteId) };
    setConv(updated);
    deleteNote(conv.id, noteId);
    dbDeleteNote(noteId);
  };

  const handleReanalyze = async () => {
    if (!conv.original_text) {
      toast('No original transcript stored for re-analysis', 'error');
      return;
    }
    setReanalyzing(true);
    try {
      const prompts = loadPrompts();
      const active = getActivePrompt(prompts);
      if (!active) {
        toast('No prompt configured. Add one in the Prompt Library first.', 'error');
        setReanalyzing(false);
        return;
      }
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customSystemPrompt: active.content,
          text: conv.original_text,
          conversation_id: conv.id,
        }),
      });
      if (!res.ok) throw new Error('Re-analysis failed');
      const data: AnalysisResult = await res.json();
      setAnalysisPreview(data);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setReanalyzing(false);
    }
  };

  const applyReanalysis = () => {
    if (!analysisPreview) return;
    const sentiment =
      analysisPreview.dissatisfaction_severity === 'Low'
        ? 'Positive'
        : analysisPreview.dissatisfaction_severity === 'Critical' ||
          analysisPreview.dissatisfaction_severity === 'High'
        ? 'Negative'
        : 'Neutral';

    const updated: Conversation = {
      ...conv,
      sentiment,
      summary: analysisPreview.summary || conv.summary,
      dissatisfaction_severity: (analysisPreview.dissatisfaction_severity as Conversation['dissatisfaction_severity']) || conv.dissatisfaction_severity,
      issue_category: analysisPreview.issue_category || conv.issue_category,
      resolution_status: (analysisPreview.resolution_status as Conversation['resolution_status']) || conv.resolution_status,
      language: analysisPreview.language || conv.language,
      agent_performance_score: analysisPreview.agent_performance_score ?? conv.agent_performance_score,
      agent_performance_notes: analysisPreview.agent_performance_notes || conv.agent_performance_notes,
      key_quotes: analysisPreview.key_quotes || conv.key_quotes,
      recommended_action: analysisPreview.recommended_action || conv.recommended_action,
      is_alert_worthy: analysisPreview.is_alert_worthy ?? conv.is_alert_worthy,
      alert_reason: analysisPreview.alert_reason ?? conv.alert_reason,
      analyzed_at: new Date().toISOString(),
    };
    setConv(updated);
    updateConversation(updated);
    dbUpdateConversation(updated);
    setAnalysisPreview(null);
    toast('Re-analysis applied', 'success');
  };

  const analysisForView: AnalysisResult = {
    language: conv.language,
    summary: conv.summary,
    dissatisfaction_severity: conv.dissatisfaction_severity,
    issue_category: conv.issue_category,
    resolution_status: conv.resolution_status,
    key_quotes: conv.key_quotes,
    agent_performance_score: conv.agent_performance_score,
    agent_performance_notes: conv.agent_performance_notes,
    recommended_action: conv.recommended_action,
    is_alert_worthy: conv.is_alert_worthy,
    alert_reason: conv.alert_reason,
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 truncate">{conv.title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Analyzed {fmtTime(conv.analyzed_at)}</p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={handleReanalyze}
              disabled={reanalyzing || !conv.original_text}
              className="border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
            >
              {reanalyzing ? '…' : '↺ Re-analyze'}
            </button>
            <button
              onClick={handleDelete}
              className="text-red-500 hover:text-red-700 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Delete
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-xl leading-none p-1"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 3-column body */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-3 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          {/* Left: original transcript */}
          <div className="overflow-y-auto p-5">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Original Transcript
            </h3>
            {conv.original_text ? (
              <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed">
                {conv.original_text}
              </pre>
            ) : (
              <p className="text-slate-400 text-sm">No transcript stored.</p>
            )}
            {conv.intercom_id && (
              <a
                href={`https://app.intercom.com/a/inbox/conversations/${conv.intercom_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs text-blue-500 underline"
              >
                View in Intercom →
              </a>
            )}
          </div>

          {/* Middle: analysis */}
          <div className="overflow-y-auto p-5">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Analysis Results
            </h3>
            <AnalysisResultView result={analysisForView} />

            {analysisPreview && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
                  Re-analysis Preview
                </h3>
                <AnalysisResultView result={analysisPreview} />
                <button
                  onClick={applyReanalysis}
                  className="mt-3 w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Apply New Analysis
                </button>
              </div>
            )}
          </div>

          {/* Right: notes */}
          <div className="flex flex-col overflow-hidden p-5">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Team Notes
            </h3>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {conv.notes.length === 0 && (
                <p className="text-slate-400 text-sm">No notes yet. Add one below.</p>
              )}
              {conv.notes.map((note) => (
                <div
                  key={note.id}
                  className={`rounded-lg p-3 text-sm ${note.system ? 'bg-slate-50 border border-slate-200' : 'bg-blue-50 border border-blue-100'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-xs text-slate-600">{note.author}</span>
                    <span className="text-xs text-slate-400">{fmtTime(note.ts)}</span>
                  </div>
                  {editingNoteId === note.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingNoteText}
                        onChange={(e) => setEditingNoteText(e.target.value)}
                        rows={3}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveNote(note)}
                          className="text-xs bg-blue-500 text-white px-2 py-1 rounded"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingNoteId(null)}
                          className="text-xs text-slate-500 px-2 py-1 rounded hover:bg-slate-100"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-slate-700 text-xs leading-relaxed">{note.text}</p>
                      {!note.system && (
                        <div className="flex gap-2 mt-1.5">
                          <button
                            onClick={() => {
                              setEditingNoteId(note.id);
                              setEditingNoteText(note.text);
                            }}
                            className="text-xs text-slate-400 hover:text-slate-600"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteNote(note.id)}
                            className="text-xs text-red-400 hover:text-red-600"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Add note */}
            <div className="mt-3 border-t border-slate-200 pt-3">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a team note…"
                rows={3}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleAddNote}
                disabled={!noteText.trim()}
                className="mt-2 w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Add Note
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
