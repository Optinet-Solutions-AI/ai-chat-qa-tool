'use client';

import type { Conversation } from '@/lib/types';
import { fmtTime } from '@/lib/utils';

interface Props {
  conversation: Conversation;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onClick: () => void;
}

const severityColors: Record<string, string> = {
  Low: 'bg-green-100 text-green-700',
  Medium: 'bg-amber-100 text-amber-700',
  High: 'bg-red-100 text-red-700',
  Critical: 'bg-red-200 text-red-800 font-semibold',
};

const sentimentColors: Record<string, string> = {
  Positive: 'bg-green-100 text-green-700',
  Negative: 'bg-red-100 text-red-700',
  Neutral: 'bg-slate-100 text-slate-600',
};

const resolutionColors: Record<string, string> = {
  Resolved: 'text-green-600',
  'Partially Resolved': 'text-amber-600',
  Unresolved: 'text-red-600',
};

export default function ConversationCard({ conversation: c, selected, onSelect, onClick }: Props) {
  return (
    <div
      className={`bg-white rounded-xl border shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow group ${
        selected ? 'border-blue-400 ring-1 ring-blue-300' : 'border-slate-200'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(c.id, e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-blue-500"
          />
        </div>

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-slate-900 text-sm truncate">{c.title}</h3>
            {c.is_alert_worthy && (
              <span title={c.alert_reason || 'Alert'} className="text-amber-500 text-base leading-none">
                ⚠
              </span>
            )}
          </div>

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${sentimentColors[c.sentiment] || 'bg-slate-100 text-slate-600'}`}
            >
              {c.sentiment}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${severityColors[c.dissatisfaction_severity] || 'bg-slate-100 text-slate-600'}`}
            >
              {c.dissatisfaction_severity}
            </span>
            <span
              className={`text-xs font-medium ${resolutionColors[c.resolution_status] || 'text-slate-500'}`}
            >
              {c.resolution_status}
            </span>
            {c.language && (
              <span className="text-xs text-slate-400 uppercase">{c.language}</span>
            )}
          </div>

          {/* Issue category + summary */}
          <div className="mt-1.5">
            {c.issue_category && (
              <span className="text-xs text-slate-500 font-medium">{c.issue_category} · </span>
            )}
            <span className="text-xs text-slate-500 line-clamp-2">{c.summary}</span>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-slate-400">{fmtTime(c.analyzed_at)}</span>
            {c.agent_performance_score !== null && c.agent_performance_score !== undefined && (
              <span className="text-xs text-slate-500">
                Agent: {c.agent_performance_score}/5
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
