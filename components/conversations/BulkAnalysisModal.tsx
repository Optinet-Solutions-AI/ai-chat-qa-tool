'use client';

import { useState } from 'react';
import type { Conversation, PromptVersion, AnalysisResult, AnalysisRun } from '@/lib/types';
import { useStore } from '@/lib/store';
import { generateId } from '@/lib/utils';
import { dbUpdateConversation, dbInsertAnalysisRun } from '@/lib/db-client';

interface Props {
  conversations: Conversation[];
  onClose: () => void;
  onComplete: () => void;
}

type Phase = 'pick' | 'running' | 'done';

function IconChevronDown() {
  return (
    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function IconX() {
  return (
    <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export default function BulkAnalysisModal({ conversations, onClose, onComplete }: Props) {
  const { prompts, updateConversation } = useStore();
  const [selectedPromptId, setSelectedPromptId] = useState<string>(
    prompts.find((p) => p.is_active)?.id ?? prompts[0]?.id ?? ''
  );
  const [phase, setPhase] = useState<Phase>('pick');
  const [progress, setProgress] = useState<{ id: string; status: 'pending' | 'ok' | 'error'; title: string }[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId) as PromptVersion | undefined;

  const handleProceed = async () => {
    if (!selectedPrompt) return;

    // Only run on conversations that have an intercom_id
    const runnable = conversations.filter((c) => c.intercom_id);
    const skipped = conversations.filter((c) => !c.intercom_id);

    setProgress([
      ...runnable.map((c) => ({ id: c.id, status: 'pending' as const, title: c.title })),
      ...skipped.map((c) => ({ id: c.id, status: 'error' as const, title: `${c.title} (no Intercom ID)` })),
    ]);
    setPhase('running');

    let ok = 0;
    let err = skipped.length;

    for (const conv of runnable) {
      try {
        const res = await fetch('/api/conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customSystemPrompt: selectedPrompt.content,
            intercomId: conv.intercom_id,
          }),
        });

        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error ?? 'Analysis failed');
        }

        const data: AnalysisResult & Record<string, unknown> = await res.json();
        const now = new Date().toISOString();

        const updated: Conversation = {
          ...conv,
          summary: data.analysisText,
          last_prompt_id: selectedPrompt.id,
          last_prompt_content: selectedPrompt.content,
          analyzed_at: now,
        };

        updateConversation(updated);
        dbUpdateConversation(updated);

        const run: AnalysisRun = {
          id: generateId(),
          conversation_id: conv.id,
          conversation_title: conv.title,
          player_name: conv.player_name,
          analyzed_at: now,
          prompt_id: selectedPrompt.id,
          prompt_title: selectedPrompt.title,
          prompt_content: selectedPrompt.content,
          summary: data.analysisText,
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
        dbInsertAnalysisRun(run);

        ok++;
        setDoneCount(ok);
        setProgress((prev) =>
          prev.map((p) => (p.id === conv.id ? { ...p, status: 'ok' } : p))
        );
      } catch {
        err++;
        setErrorCount(err);
        setProgress((prev) =>
          prev.map((p) => (p.id === conv.id ? { ...p, status: 'error' } : p))
        );
      }
    }

    setPhase('done');
  };

  const total = conversations.length;
  const runnable = conversations.filter((c) => c.intercom_id).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-900">
            {phase === 'done' ? 'Analysis complete' : 'Run Bulk Analysis'}
          </h2>
          {phase !== 'running' && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">

          {phase === 'pick' && (
            <>
              <p className="text-sm text-slate-600">
                Running analysis on <span className="font-semibold">{total}</span> conversation{total !== 1 ? 's' : ''}.
                {total !== runnable && (
                  <span className="text-amber-600"> {total - runnable} will be skipped (no Intercom ID).</span>
                )}
              </p>

              {/* Prompt picker */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Prompt to use
                </label>
                {prompts.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    No prompts found.{' '}
                    <a href="/prompts" className="text-blue-600 hover:underline">Create one →</a>
                  </p>
                ) : (
                  <div className="relative">
                    <select
                      value={selectedPromptId}
                      onChange={(e) => setSelectedPromptId(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 pr-8"
                    >
                      {prompts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}{p.is_active ? ' (Default)' : ''}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                      <IconChevronDown />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {(phase === 'running' || phase === 'done') && (
            <div className="space-y-3">
              {/* Progress bar */}
              {phase === 'running' && (
                <div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                    <span>Analyzing…</span>
                    <span>{doneCount + errorCount} / {total}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${((doneCount + errorCount) / total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {phase === 'done' && (
                <div className="flex items-center gap-4 py-1">
                  <div className="text-center flex-1">
                    <p className="text-2xl font-bold text-green-600">{doneCount}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Completed</p>
                  </div>
                  {errorCount > 0 && (
                    <div className="text-center flex-1">
                      <p className="text-2xl font-bold text-red-500">{errorCount}</p>
                      <p className="text-xs text-slate-400 mt-0.5">Failed / Skipped</p>
                    </div>
                  )}
                </div>
              )}

              {/* Per-conversation status list */}
              <div className="max-h-52 overflow-y-auto space-y-1.5 rounded-xl border border-slate-100 p-3 bg-slate-50">
                {progress.map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5">
                    {p.status === 'pending' && (
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                    )}
                    {p.status === 'ok' && <IconCheck />}
                    {p.status === 'error' && <IconX />}
                    <span className="text-xs text-slate-700 truncate">{p.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 flex-shrink-0">
          {phase === 'pick' && (
            <>
              <button
                onClick={onClose}
                className="text-sm font-medium text-slate-500 px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleProceed}
                disabled={!selectedPrompt || runnable === 0}
                className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 px-4 py-2 rounded-xl transition-colors"
              >
                Proceed
              </button>
            </>
          )}
          {phase === 'done' && (
            <button
              onClick={onComplete}
              className="text-sm font-medium text-white bg-slate-800 hover:bg-slate-900 px-4 py-2 rounded-xl transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
