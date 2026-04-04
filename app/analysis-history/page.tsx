'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { AnalysisRun } from '@/lib/types';
import { dbDeleteAnalysisRun } from '@/lib/db-client';
import { useConfirm } from '@/components/layout/ConfirmProvider';

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

function IconTrash() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
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

function SummaryPreview({ text }: { text: string | null }) {
  if (!text) return <span className="text-slate-300">—</span>;

  // Strip code fences and try to extract a summary field from JSON
  const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    const candidate = parsed?.summary ?? parsed?.Summary ?? Object.values(parsed).find((v) => typeof v === 'string' && (v as string).length > 20);
    if (candidate) {
      return <span className="text-slate-600 line-clamp-2">{String(candidate)}</span>;
    }
  } catch { /* not JSON */ }

  return <span className="text-slate-600 line-clamp-2">{cleaned}</span>;
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirm = useConfirm();

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

  const handleDeleteRun = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!await confirm('Delete this analysis run?', { danger: true, confirmLabel: 'Delete' })) return;
    setDeletingId(id);
    await dbDeleteAnalysisRun(id);
    setDeletingId(null);
    // Reload current page; if it becomes empty go back one page
    const newTotal = total - 1;
    const newTotalPages = Math.ceil(newTotal / PER_PAGE);
    fetchPage(page >= newTotalPages && page > 0 ? page - 1 : page);
  };

  const handleClearAll = async () => {
    if (!await confirm(`Delete all ${total} analysis run(s)? This cannot be undone.`, { title: 'Clear All', danger: true, confirmLabel: 'Clear All' })) return;
    // Delete all runs visible in current data set sequentially via existing helper
    // We fetch all IDs first then delete
    setLoading(true);
    try {
      let p = 0;
      while (true) {
        const res = await fetch(`/api/analysis-runs?page=${p}&perPage=100`);
        const data = await res.json();
        if (!data.runs?.length) break;
        await Promise.all(data.runs.map((r: AnalysisRun) => dbDeleteAnalysisRun(r.id)));
        if (data.runs.length < 100) break;
        p++;
      }
    } finally {
      fetchPage(0);
    }
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 flex-shrink-0">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Analysis History</h1>
          <p className="text-xs text-slate-400 mt-0.5">{total} run{total !== 1 ? 's' : ''} total</p>
        </div>
        {total > 0 && (
          <button
            onClick={handleClearAll}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <IconTrash />
            Clear All
          </button>
        )}
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
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Summary</th>
                    <th className="px-4 py-3 w-10" />
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
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap max-w-[140px] truncate">
                        {run.prompt_title ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs max-w-[320px]">
                        <SummaryPreview text={run.summary} />
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => handleDeleteRun(e, run.id)}
                          disabled={deletingId === run.id}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                          title="Delete run"
                        >
                          {deletingId === run.id
                            ? <div className="w-3.5 h-3.5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                            : <IconTrash />
                          }
                        </button>
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
