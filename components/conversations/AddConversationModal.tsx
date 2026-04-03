'use client';

import { useState, useRef } from 'react';
import { useStore } from '@/lib/store';
import { useToast } from '@/components/layout/ToastProvider';
import { generateId } from '@/lib/utils';
import { loadPrompts, getActivePrompt } from '@/lib/prompts';
import { dbInsertConversation } from '@/lib/db-client';
import type { AnalysisResult, Conversation } from '@/lib/types';
import AnalysisResultView from './AnalysisResultView';

type Tab = 'paste' | 'upload' | 'intercom';

interface Props {
  onClose: () => void;
}

export default function AddConversationModal({ onClose }: Props) {
  const { addConversation } = useStore();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>('paste');
  const [pasteText, setPasteText] = useState('');
  const [intercomId, setIntercomId] = useState('');
  const [fileText, setFileText] = useState('');
  const [fileName, setFileName] = useState('');
  const [convId, setConvId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [agentName, setAgentName] = useState('');
  const [intercomLink, setIntercomLink] = useState('');
  const [isBotHandled, setIsBotHandled] = useState(false);

  const [loading, setLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setFileText((ev.target?.result as string) || '');
    reader.readAsText(file);
  };

  const handleAnalyze = async () => {
    setLoading(true);
    setAnalysisResult(null);
    try {
      const prompts = loadPrompts();
      const active = getActivePrompt(prompts);
      if (!active) {
        toast('No prompt configured. Add one in the Prompt Library first.', 'error');
        setLoading(false);
        return;
      }

      const body: Record<string, unknown> = {
        customSystemPrompt: active.content,
        conversation_id: convId || 'unknown',
        player_id: playerId || 'unknown',
        agent_name: agentName || 'Unknown',
        intercom_link: intercomLink || '',
        is_bot_handled: isBotHandled,
      };

      if (tab === 'paste') body.text = pasteText;
      else if (tab === 'upload') body.text = fileText;
      else if (tab === 'intercom') body.intercomId = intercomId;

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Analysis failed');
      }

      const data: AnalysisResult = await res.json();
      setAnalysisResult(data);
    } catch (e) {
      toast((e as Error).message || 'Analysis failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!analysisResult) return;

    const transcript =
      tab === 'paste' ? pasteText : tab === 'upload' ? fileText : '';

    const sentiment =
      analysisResult.dissatisfaction_severity === 'Low'
        ? 'Positive'
        : analysisResult.dissatisfaction_severity === 'Critical' ||
          analysisResult.dissatisfaction_severity === 'High'
        ? 'Negative'
        : 'Neutral';

    const conv: Conversation = {
      id: generateId(),
      title: `Conv ${convId || analysisResult.conversation_id || 'Unknown'}`,
      sentiment,
      intent: analysisResult.issue_category || '',
      summary: analysisResult.summary || '',
      intercom_id: intercomId || null,
      original_text: transcript || null,
      analyzed_at: new Date().toISOString(),
      dissatisfaction_severity: analysisResult.dissatisfaction_severity as Conversation['dissatisfaction_severity'],
      issue_category: analysisResult.issue_category || '',
      resolution_status: analysisResult.resolution_status as Conversation['resolution_status'],
      language: analysisResult.language || 'en',
      agent_performance_score: analysisResult.agent_performance_score ?? null,
      agent_performance_notes: analysisResult.agent_performance_notes || '',
      key_quotes: analysisResult.key_quotes || '',
      recommended_action: analysisResult.recommended_action || '',
      is_alert_worthy: analysisResult.is_alert_worthy ?? false,
      alert_reason: analysisResult.alert_reason ?? null,
      notes: [],
    };

    addConversation(conv);
    dbInsertConversation(conv);
    toast('Conversation saved to dashboard', 'success');
    onClose();
  };

  const canAnalyze =
    (tab === 'paste' && pasteText.trim().length > 0) ||
    (tab === 'upload' && fileText.trim().length > 0) ||
    (tab === 'intercom' && intercomId.trim().length > 0);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'paste', label: 'Paste' },
    { key: 'upload', label: 'Upload' },
    { key: 'intercom', label: 'Intercom' },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Add Conversation</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  tab === t.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'paste' && (
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste conversation transcript here…"
              rows={8}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}

          {tab === 'upload' && (
            <div>
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-blue-400 transition-colors"
              >
                <div className="text-3xl mb-2">📂</div>
                <p className="text-sm text-slate-500">
                  {fileName ? fileName : 'Click to upload .txt or .json file'}
                </p>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.json"
                className="hidden"
                onChange={handleFile}
              />
              {fileText && (
                <p className="mt-2 text-xs text-green-600">
                  File loaded ({fileText.length.toLocaleString()} chars)
                </p>
              )}
            </div>
          )}

          {tab === 'intercom' && (
            <input
              type="text"
              value={intercomId}
              onChange={(e) => setIntercomId(e.target.value)}
              placeholder="Intercom Conversation ID (e.g. 12345678)"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}

          {/* Metadata fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Conversation ID
              </label>
              <input
                type="text"
                value={convId}
                onChange={(e) => setConvId(e.target.value)}
                placeholder="optional"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Player ID</label>
              <input
                type="text"
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
                placeholder="optional"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Agent Name</label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="optional"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Intercom Link</label>
              <input
                type="text"
                value={intercomLink}
                onChange={(e) => setIntercomLink(e.target.value)}
                placeholder="optional"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isBotHandled}
              onChange={(e) => setIsBotHandled(e.target.checked)}
              className="rounded border-slate-300"
            />
            Bot-handled conversation
          </label>

          {/* Analysis result preview */}
          {analysisResult && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Analysis Preview</h3>
              <AnalysisResultView result={analysisResult} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-200">
          <button
            onClick={onClose}
            className="border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Cancel
          </button>
          {!analysisResult ? (
            <button
              onClick={handleAnalyze}
              disabled={!canAnalyze || loading}
              className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
            >
              {loading && (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {loading ? 'Analyzing…' : 'Analyze'}
            </button>
          ) : (
            <>
              <button
                onClick={() => setAnalysisResult(null)}
                className="border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Re-analyze
              </button>
              <button
                onClick={handleSave}
                className="bg-green-500 hover:bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Save to Dashboard
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
