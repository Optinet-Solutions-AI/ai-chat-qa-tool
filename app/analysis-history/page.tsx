'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { AnalysisRun } from '@/lib/types';

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconChevronLeft() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function ResolutionBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-300">—</span>;
  const colors: Record<string, string> = {
    Resolved: 'bg-green-100 text-green-700',
    'Partially Resolved': 'bg-amber-100 text-amber-700',
    Unresolved: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return <span className="text-slate-300">—</span>;
  const colors: Record<string, string> = {
    Low: 'bg-blue-100 text-blue-700',
    Medium: 'bg-amber-100 text-amber-700',
    High: 'bg-orange-100 text-orange-700',
    Critical: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors[severity] ?? 'bg-slate-100 text-slate-600'}`}>
      {severity}
    </span>
  );
}

const PER_PAGE = 25;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnalysisHistoryPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analysis-runs?page=${p}&perPage=${PER_PAGE}`);
      if (!res.ok) throw new Error('Failed to load analysis history');
      const data = await res.json();
      setRuns(data.runs);
      setTotal(data.total);
      setPage(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 flex-shrink-0">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Analysis History</h1>
          <p className="text-xs text-slate-400 mt-0.5">{total} run{total !== 1 ? 's' : ''} total</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-20 text-red-500 text-sm">{error}</div>
        ) : runs.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-400 text-sm">No analysis runs yet.</p>
            <p className="text-xs text-slate-300 mt-1">Run QA on a conversation to see results here.</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Date</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Conversation</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Prompt</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Resolution</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Severity</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Score</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Alert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      onClick={() => router.push(`/analysis-history/${run.id}`)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {fmtDate(run.analyzed_at)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-medium text-slate-800 truncate max-w-[180px]">
                          {run.conversation_title ?? '—'}
                        </p>
                        {run.player_name && (
                          <p className="text-[11px] text-slate-400 truncate max-w-[180px]">{run.player_name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 truncate max-w-[140px]">
                        {run.prompt_title ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <ResolutionBadge status={run.resolution_status} />
                      </td>
                      <td className="px-4 py-3">
                        <SeverityBadge severity={run.dissatisfaction_severity} />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {run.agent_performance_score != null ? run.agent_performance_score : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {run.is_alert_worthy ? (
                          <span className="inline-flex items-center gap-1 text-red-600 text-[10px] font-semibold">
                            <IconAlert /> Alert
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-slate-400">
                  Page {page + 1} of {totalPages} — {total} runs
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => fetchPage(page - 1)}
                    disabled={page === 0}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <IconChevronLeft />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => fetchPage(i)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                        i === page
                          ? 'bg-slate-800 text-white'
                          : 'border border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => fetchPage(page + 1)}
                    disabled={page >= totalPages - 1}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <IconChevronRight />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
