'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { useToast } from '@/components/layout/ToastProvider';
import { dbDeleteConversation } from '@/lib/db-client';
import type { Conversation } from '@/lib/types';
import ConversationCard from './ConversationCard';
import ConversationDetail from './ConversationDetail';

export default function ConversationList() {
  const { conversations, deleteConversation } = useStore();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Conversation | null>(null);

  const handleSelect = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (!window.confirm(`Delete ${selected.size} conversation(s)?`)) return;
    selected.forEach((id) => {
      deleteConversation(id);
      dbDeleteConversation(id);
    });
    setSelected(new Set());
    toast(`${selected.size} conversation(s) deleted`, 'success');
  };

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-6xl mb-4">💬</div>
        <h2 className="text-xl font-semibold text-slate-700 mb-2">No conversations yet</h2>
        <p className="text-slate-400 text-sm max-w-xs">
          Click &ldquo;Add Conversation&rdquo; in the header to analyze your first customer support chat.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-3">
          <span className="text-sm text-blue-700 font-medium">
            {selected.size} selected
          </span>
          <button
            onClick={handleDeleteSelected}
            className="text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Delete Selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-slate-500 hover:text-slate-700 ml-auto"
          >
            Clear
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {conversations.map((conv) => (
          <ConversationCard
            key={conv.id}
            conversation={conv}
            selected={selected.has(conv.id)}
            onSelect={handleSelect}
            onClick={() => setDetail(conv)}
          />
        ))}
      </div>

      {/* Detail modal */}
      {detail && (
        <ConversationDetail
          conversation={detail}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
