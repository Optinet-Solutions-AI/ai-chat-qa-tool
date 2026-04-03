'use client';

import { useState, useEffect } from 'react';
import type { PromptVersion } from '@/lib/types';
import { loadPrompts, savePrompts, getActivePrompt, createNewVersion } from '@/lib/prompts';
import { useToast } from '@/components/layout/ToastProvider';
import { fmtTime } from '@/lib/utils';
import RunAnalyzeModal from './RunAnalyzeModal';

export default function PromptLibrary() {
  const { toast } = useToast();

  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showTest, setShowTest] = useState(false);

  useEffect(() => {
    const loaded = loadPrompts();
    setPrompts(loaded);
  }, []);

  const active = prompts.length > 0 ? getActivePrompt(prompts) : null;

  const handleEdit = () => {
    setEditContent(active?.content ?? '');
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setEditContent('');
  };

  const handleSave = () => {
    if (!editContent.trim()) return;
    const updated = createNewVersion(editContent, prompts);
    setPrompts(updated);
    savePrompts(updated);
    setEditing(false);
    toast('New prompt version saved', 'success');
  };

  const handleUseVersion = (id: string) => {
    const updated = prompts.map((p) => ({ ...p, active: p.id === id }));
    setPrompts(updated);
    savePrompts(updated);
    toast('Prompt version activated', 'success');
  };

  const older = prompts.filter((p) => !p.active);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Active prompt */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-semibold text-slate-900">Active Prompt</h2>
            {active && (
              <p className="text-xs text-slate-400 mt-0.5">
                {active.label} · Created {fmtTime(active.createdAt)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!editing ? (
              <>
                <button
                  onClick={() => setShowTest(true)}
                  className="border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-1.5 rounded-lg"
                >
                  Test Prompt
                </button>
                <button
                  onClick={handleEdit}
                  className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
                >
                  Edit Prompt
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleCancel}
                  className="border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-1.5 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="bg-green-500 hover:bg-green-600 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
                >
                  Save Prompt
                </button>
              </>
            )}
          </div>
        </div>

        <div className="p-5">
          {editing ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={20}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          ) : active ? (
            <pre className="text-xs text-slate-700 font-mono whitespace-pre-wrap leading-relaxed bg-slate-50 rounded-lg p-4 max-h-96 overflow-y-auto">
              {active.content}
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-4xl mb-3">📝</div>
              <p className="text-sm font-medium text-slate-700 mb-1">No prompt configured</p>
              <p className="text-xs text-slate-400 mb-4">Create a prompt to start analyzing conversations.</p>
              <button
                onClick={handleEdit}
                className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                Create Prompt
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Version history */}
      {older.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="font-semibold text-slate-900">Version History</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {older.map((v) => (
              <div key={v.id} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-sm font-medium text-slate-700">{v.label}</span>
                    <span className="text-xs text-slate-400 ml-2">{fmtTime(v.createdAt)}</span>
                  </div>
                  <button
                    onClick={() => handleUseVersion(v.id)}
                    className="text-xs border border-slate-200 hover:bg-slate-50 text-slate-600 px-2.5 py-1 rounded-lg"
                  >
                    Use This Version
                  </button>
                </div>
                <pre className="text-xs text-slate-500 font-mono whitespace-pre-wrap line-clamp-4 bg-slate-50 rounded p-3">
                  {v.content}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {showTest && active && (
        <RunAnalyzeModal
          promptContent={active.content}
          onClose={() => setShowTest(false)}
        />
      )}
    </div>
  );
}
