'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend, Sector,
} from 'recharts';
import ConversationsOverlay from '@/components/dashboard/ConversationsOverlay';
import { AM_NAMES } from '@/lib/utils';

interface LabelCount { label: string; count: number; }
interface DateCount  { date: string; count: number; }

interface AsanaMetrics {
  configured: boolean;
  projectGid: string | null;
  totalTickets: number;
  openTickets: number;
  closedTickets: number;
  ticketsByAm: LabelCount[];
  ticketsBySeverity: LabelCount[];
  ticketsByCategory: LabelCount[];
  ticketsByDate: DateCount[];
  closuresByDate: DateCount[];
  lastSyncedAt: string | null;
  error?: string;
}

// Same accent palette the dashboard uses for chart cells/lines.
const COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#34d399', '#60a5fa', '#f87171'];

const SEVERITY_COLORS: Record<string, string> = {
  'Level 0': '#34d399',
  'Level 1': '#22d3ee',
  'Level 2': '#fb923c',
  'Level 3': '#f472b6',
  Unknown:   '#94a3b8',
};

interface Filters {
  dateFrom: string;  // YYYY-MM-DD or '' for unbounded
  dateTo:   string;  // YYYY-MM-DD or '' for unbounded
  am: string;        // 'all' or AM name
  severity: string;  // 'all' or 'Level 1' | 'Level 2' | 'Level 3' | 'Unknown'
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function defaultFilters(): Filters {
  return { dateFrom: todayISO(), dateTo: todayISO(), am: 'all', severity: 'all' };
}

const SEVERITY_OPTIONS = ['Level 1', 'Level 2', 'Level 3', 'Unknown'];

function buildQuery(f: Filters): string {
  const params = new URLSearchParams();
  if (f.dateFrom) params.set('from', f.dateFrom);
  if (f.dateTo)   params.set('to',   f.dateTo);
  if (f.am !== 'all')       params.set('am', f.am);
  if (f.severity !== 'all') params.set('severity', f.severity);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function fmt(n: number) { return n.toLocaleString(); }

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}

// Ctrl/Cmd-click or middle-click → open in a new tab instead of overlay.
// Mirrors the helper used on the Dashboard so behaviour is consistent.
function isNewTabClick(e?: { ctrlKey?: boolean; metaKey?: boolean; button?: number }): boolean {
  if (!e) return false;
  return Boolean(e.ctrlKey) || Boolean(e.metaKey) || e.button === 1;
}

export default function ReportPage() {
  const [data, setData] = useState<AsanaMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters());

  // Drill-down overlay state — same pattern as the Dashboard so Ctrl/middle-
  // click can open the same view in a new tab via URL params.
  const [overlayFilters, setOverlayFilters] = useState<Record<string, string> | null>(null);
  const [overlayTitle, setOverlayTitle]     = useState('');

  async function load(f: Filters) {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/asana${buildQuery(f)}`);
      const json = await res.json();
      setData(json as AsanaMetrics);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(filters); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters]);

  // Build the conversation-list filter set for a click. Always includes
  // asana_ticketed=true so the drill-down matches the report row set, plus
  // the current Report Page filters (date range, AM, severity), then merges
  // dimension-specific extras (which win on conflict).
  const navToConversations = useCallback((extra: Record<string, string>, e?: React.MouseEvent | MouseEvent) => {
    const out: Record<string, string> = { asana_ticketed: 'true' };
    if (filters.dateFrom) out.dateFrom = filters.dateFrom;
    if (filters.dateTo)   out.dateTo   = filters.dateTo;
    if (filters.am !== 'all')       out.account_manager          = filters.am;
    if (filters.severity !== 'all') out.dissatisfaction_severity = filters.severity;
    Object.entries(extra).forEach(([k, v]) => { if (v) out[k] = v; });

    // Build a human-readable title from the dimension-specific extras
    const dimEntries = Object.entries(extra).filter(([, v]) => v);
    let title = 'Escalations';
    if (out.asana_status === 'closed') title = 'Closures by AMs';
    else if (out.asana_status === 'open') title = 'Open escalations';
    if (dimEntries.length > 0) {
      const [key, val] = dimEntries[0];
      if (key === 'account_manager') title = `Escalations: ${val}`;
      else if (key === 'dissatisfaction_severity') title = `Severity ${val}`;
      else if (key === 'issue_category') title = `Category: ${val}`;
      else if (key === 'dateFrom' && out.dateFrom === out.dateTo) {
        const base = out.asana_status === 'closed' ? 'Closures' : 'Escalations';
        title = `${base} on ${out.dateFrom}`;
      }
    }

    if (isNewTabClick(e)) {
      const params = new URLSearchParams();
      params.set('ov_filters', JSON.stringify(out));
      params.set('ov_title', title);
      window.open(`${window.location.pathname}?${params.toString()}`, '_blank', 'noopener,noreferrer');
      return;
    }

    setOverlayTitle(title);
    setOverlayFilters(out);
  }, [filters]);

  // Restore the overlay from URL params when a tab was opened via Ctrl/middle-click.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const f = sp.get('ov_filters');
    const t = sp.get('ov_title');
    if (f && t) {
      try {
        setOverlayFilters(JSON.parse(f));
        setOverlayTitle(t);
      } catch { /* ignore malformed params */ }
    }
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/dashboard/asana/sync');
      const json = await res.json();
      if (!res.ok) {
        setSyncMessage(`Error: ${json.error ?? 'unknown'}`);
      } else {
        setSyncMessage(`Synced ${json.synced}/${json.total} tickets`);
        await load(filters);
      }
    } catch (e) {
      setSyncMessage(`Error: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  // Merge the two date series for the multi-line trajectory chart. We union
  // the dates so a day with closures-but-no-new-escalations (or vice versa)
  // still gets a point.
  const trajectory = useMemo(() => {
    if (!data) return [];
    const byDate = new Map<string, { date: string; escalations: number; closures: number }>();
    for (const d of data.ticketsByDate) {
      byDate.set(d.date, { date: d.date, escalations: d.count, closures: 0 });
    }
    for (const d of data.closuresByDate) {
      const existing = byDate.get(d.date);
      if (existing) existing.closures = d.count;
      else byDate.set(d.date, { date: d.date, escalations: 0, closures: d.count });
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const today = todayISO();
  const filtersActive = filters.dateFrom !== today || filters.dateTo !== today || filters.am !== 'all' || filters.severity !== 'all';

  if (!data && loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm gap-2">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        Loading…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="text-slate-400 text-sm">No data.</div>
      </div>
    );
  }
  if (!data.configured) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="text-xl font-bold text-slate-800">Report Page</h1>
        <div className="bg-white rounded-2xl border border-amber-400/40 ring-1 ring-amber-400/10 p-5 text-sm text-amber-300">
          Asana isn&apos;t configured yet. Set <code>ASANA_ACCESS_TOKEN</code>{' '}
          and <code>ASANA_PROJECT_GID</code> in env to start pushing tickets.
        </div>
      </div>
    );
  }

  const closureRate = data.totalTickets
    ? `${Math.round((data.closedTickets / data.totalTickets) * 100)}%`
    : '—';
  const closurePct = data.totalTickets ? (data.closedTickets / data.totalTickets) * 100 : 0;

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Report Page</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Summary of Severity-3 escalations pushed to Asana. Click any metric
            to drill in; Ctrl/⌘+click or middle-click to open in a new tab.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-3">
            {loading && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Refreshing…
              </div>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              {syncing ? 'Syncing…' : 'Refresh status from Asana'}
            </button>
          </div>
          <div className="text-[11px] text-slate-400">
            {syncMessage ?? `Last synced ${formatRelative(data.lastSyncedAt)}`}
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Date from</label>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Date to</label>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Account Manager</label>
          <select
            value={filters.am}
            onChange={(e) => setFilters((f) => ({ ...f, am: e.target.value }))}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All</option>
            {AM_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="Unassigned">Unassigned</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Severity</label>
          <select
            value={filters.severity}
            onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All</option>
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {filtersActive && (
          <button
            onClick={() => setFilters(defaultFilters())}
            className="ml-auto text-xs text-slate-400 hover:text-slate-600 underline pb-1.5"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total escalations"
          value={data.totalTickets}
          accent="cyan"
          icon="doc"
          onClick={(e) => navToConversations({}, e)}
        />
        <StatCard
          label="Handled by AMs"
          value={data.closedTickets}
          accent="teal"
          icon="check"
          onClick={(e) => navToConversations({ asana_status: 'closed' }, e)}
        />
        <StatCard
          label="Open"
          value={data.openTickets}
          accent="amber"
          icon="clock"
          onClick={(e) => navToConversations({ asana_status: 'open' }, e)}
        />
        <StatCard
          label="Closure rate"
          value={closureRate}
          accent="violet"
          donutPct={closurePct}
          onClick={(e) => navToConversations({}, e)}
        />
      </div>

      {/* Trajectory: escalations + closures per day */}
      <Section title="Trajectory over time">
        {trajectory.length === 0 ? (
          <Empty message="No tickets in this slice." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={trajectory}
              margin={{ top: 8, right: 16, left: -10, bottom: 0 }}
              style={{ cursor: 'pointer' }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={(d: any, e: any) => { if (d?.activeLabel) navToConversations({ dateFrom: d.activeLabel, dateTo: d.activeLabel }, e); }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMouseDown={(d: any, e: any) => { if (e?.button === 1 && d?.activeLabel) { e.preventDefault?.(); navToConversations({ dateFrom: d.activeLabel, dateTo: d.activeLabel }, e); } }}
            >
              <defs>
                <filter id="reportTrajGlow" x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#22d3ee', strokeWidth: 1, strokeDasharray: '3 3', opacity: 0.55 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              <Line
                type="monotone"
                dataKey="escalations"
                name="Escalations created"
                stroke="#22d3ee"
                strokeWidth={2.5}
                activeDot={{ r: 6, cursor: 'pointer', fill: '#22d3ee', filter: 'url(#reportTrajGlow)' }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                dot={(props: any) => {
                  const { cx, cy, index } = props;
                  const lastIdx = trajectory.length - 1;
                  if (index !== lastIdx || cx == null || cy == null) {
                    return <circle key={`re-${index}`} cx={0} cy={0} r={0} fill="none" />;
                  }
                  return (
                    <g key={`re-${index}`} filter="url(#reportTrajGlow)">
                      <circle className="trend-pulse-ring" cx={cx} cy={cy} r={4} fill="#22d3ee" />
                      <circle cx={cx} cy={cy} r={3} fill="#22d3ee" stroke="#0b0f17" strokeWidth={1.5} />
                    </g>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="closures"
                name="Closures by AMs"
                stroke="#34d399"
                strokeWidth={2.5}
                activeDot={{ r: 6, cursor: 'pointer', fill: '#34d399', filter: 'url(#reportTrajGlow)' }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                dot={(props: any) => {
                  const { cx, cy, index } = props;
                  const lastIdx = trajectory.length - 1;
                  if (index !== lastIdx || cx == null || cy == null) {
                    return <circle key={`rc-${index}`} cx={0} cy={0} r={0} fill="none" />;
                  }
                  return (
                    <g key={`rc-${index}`} filter="url(#reportTrajGlow)">
                      <circle className="trend-pulse-ring" cx={cx} cy={cy} r={4} fill="#34d399" />
                      <circle cx={cx} cy={cy} r={3} fill="#34d399" stroke="#0b0f17" strokeWidth={1.5} />
                    </g>
                  );
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Section>

      {/* Two-column: per AM bar chart, severity pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Escalations per Account Manager">
          {data.ticketsByAm.length === 0 ? (
            <Empty message="No tickets in this slice." />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, data.ticketsByAm.length * 38)}>
              <BarChart
                data={data.ticketsByAm}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                style={{ cursor: 'pointer' }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onClick={(d: any, e: any) => { if (d?.activeLabel) navToConversations({ account_manager: d.activeLabel }, e); }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMouseDown={(d: any, e: any) => { if (e?.button === 1 && d?.activeLabel) { e.preventDefault?.(); navToConversations({ account_manager: d.activeLabel }, e); } }}
              >
                <defs>
                  <linearGradient id="amBar" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"   stopColor="#22d3ee" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={1} />
                  </linearGradient>
                  <filter id="amBarGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 11, fill: 'var(--chart-axis-label)' }} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                <Bar
                  dataKey="count"
                  fill="url(#amBar)"
                  radius={[0, 6, 6, 0]}
                  activeBar={{ filter: 'url(#amBarGlow)' }}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>

        <Section title="Severity breakdown">
          {data.ticketsBySeverity.length === 0 ? (
            <Empty message="No tickets in this slice." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart style={{ cursor: 'pointer' }}>
                  <defs>
                    <filter id="reportPieGlow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                  <Pie
                    data={data.ticketsBySeverity}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    activeShape={(props: any) => (
                      <Sector {...props} outerRadius={props.outerRadius + 4} style={{ filter: 'url(#reportPieGlow)' }} />
                    )}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(d: any, _i: number, e: any) => { if (d?.label) navToConversations({ dissatisfaction_severity: d.label }, e); }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onMouseDown={(d: any, _i: number, e: any) => { if (e?.button === 1 && d?.label) { e.preventDefault?.(); navToConversations({ dissatisfaction_severity: d.label }, e); } }}
                  >
                    {data.ticketsBySeverity.map((entry, i) => (
                      <Cell key={i} fill={SEVERITY_COLORS[entry.label] ?? COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {data.ticketsBySeverity.map((s, i) => (
                  <div
                    key={s.label}
                    className="flex items-center justify-between text-xs cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1 transition-colors"
                    onClick={(e) => navToConversations({ dissatisfaction_severity: s.label }, e)}
                    onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); navToConversations({ dissatisfaction_severity: s.label }, e); } }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEVERITY_COLORS[s.label] ?? COLORS[i % COLORS.length] }} />
                      <span className="text-slate-600">{s.label}</span>
                    </div>
                    <span className="font-semibold text-slate-700">{fmt(s.count)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      </div>

      {/* Top categories */}
      <Section title="Top issue categories">
        {data.ticketsByCategory.length === 0 ? (
          <Empty message="No tickets in this slice." />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, data.ticketsByCategory.length * 38)}>
            <BarChart
              data={data.ticketsByCategory}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
              style={{ cursor: 'pointer' }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={(d: any, e: any) => { if (d?.activeLabel) navToConversations({ issue_category: d.activeLabel }, e); }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMouseDown={(d: any, e: any) => { if (e?.button === 1 && d?.activeLabel) { e.preventDefault?.(); navToConversations({ issue_category: d.activeLabel }, e); } }}
            >
              <defs>
                <linearGradient id="catBar" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%"   stopColor="#a78bfa" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity={1} />
                </linearGradient>
                <filter id="catBarGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis type="category" dataKey="label" width={220} tick={{ fontSize: 11, fill: 'var(--chart-axis-label)' }} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
              <Bar
                dataKey="count"
                fill="url(#catBar)"
                radius={[0, 6, 6, 0]}
                activeBar={{ filter: 'url(#catBarGlow)' }}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Section>

      {data.projectGid && (
        <a
          href={`https://app.asana.com/0/${data.projectGid}/board`}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-blue-600 hover:underline"
        >
          Open project board in Asana →
        </a>
      )}

      {overlayFilters && (
        <ConversationsOverlay
          filters={overlayFilters}
          title={overlayTitle}
          onClose={() => {
            setOverlayFilters(null);
            if (typeof window !== 'undefined') {
              const sp = new URLSearchParams(window.location.search);
              if (sp.has('ov_filters') || sp.has('ov_title')) {
                sp.delete('ov_filters');
                sp.delete('ov_title');
                const qs = sp.toString();
                window.history.replaceState({}, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
              }
            }
          }}
        />
      )}
    </div>
  );
}

// ── Stat card (mirrors the dashboard's accent-token pattern) ────────────────

type StatAccent = 'cyan' | 'teal' | 'amber' | 'violet';

const ACCENT_TOKENS: Record<StatAccent, { border: string; iconBg: string; iconStroke: string; valueText: string }> = {
  cyan:   { border: 'border-cyan-400/40    ring-cyan-400/10',    iconBg: 'bg-cyan-400/15',    iconStroke: '#22d3ee', valueText: 'text-cyan-300' },
  teal:   { border: 'border-emerald-400/40 ring-emerald-400/10', iconBg: 'bg-emerald-400/15', iconStroke: '#34d399', valueText: 'text-emerald-300' },
  amber:  { border: 'border-amber-400/40   ring-amber-400/10',   iconBg: 'bg-amber-400/15',   iconStroke: '#fbbf24', valueText: 'text-amber-300' },
  violet: { border: 'border-violet-400/40  ring-violet-400/10',  iconBg: 'bg-violet-400/15',  iconStroke: '#a78bfa', valueText: 'text-violet-300' },
};

function StatIcon({ kind, color }: { kind: 'doc' | 'check' | 'clock'; color: string }) {
  const common = { fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, viewBox: '0 0 24 24', className: 'w-5 h-5' };
  switch (kind) {
    case 'doc':   return <svg {...common}><path d="M14 3v4a1 1 0 0 0 1 1h4M5 21h14a2 2 0 0 0 2-2V7l-4-4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z" /><path d="M8 12h8M8 16h6" /></svg>;
    case 'check': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>;
    case 'clock': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>;
  }
}

function MiniDonut({ pct, color }: { pct: number; color: string }) {
  const r = 22, c = 2 * Math.PI * r;
  const safe = Math.max(0, Math.min(100, pct));
  return (
    <svg viewBox="0 0 56 56" className="w-12 h-12">
      <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-slate-200 dark:text-slate-700" />
      <circle
        cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (c * safe / 100)}
        transform="rotate(-90 28 28)"
      />
    </svg>
  );
}

function StatCard({ label, value, accent, icon, donutPct, onClick }: {
  label: string;
  value: string | number;
  accent: StatAccent;
  icon?: 'doc' | 'check' | 'clock';
  donutPct?: number;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const tok = ACCENT_TOKENS[accent];
  return (
    <div
      className={`bg-white rounded-2xl border ${tok.border} ring-1 ${tok.border.split(' ').filter(Boolean)[1]} p-4 transition-colors ${onClick ? 'cursor-pointer hover:bg-slate-50/40' : ''}`}
      onClick={onClick}
      onMouseDown={onClick ? (e) => { if (e.button === 1) { e.preventDefault(); onClick(e); } } : undefined}
    >
      <div className="flex items-center gap-3">
        {donutPct != null ? (
          <MiniDonut pct={donutPct} color={tok.iconStroke} />
        ) : icon ? (
          <div className={`w-10 h-10 rounded-lg ${tok.iconBg} flex items-center justify-center shrink-0`}>
            <StatIcon kind={icon} color={tok.iconStroke} />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-slate-500 truncate">{label}</p>
          <p className={`text-2xl font-bold mt-0.5 ${tok.valueText}`}>{typeof value === 'number' ? fmt(value) : value}</p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name?: string; color?: string; fill?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-xs backdrop-blur-sm">
      {label && <p className="font-medium text-slate-600 mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color ?? p.fill ?? '#22d3ee' }}>{p.name ? `${p.name}: ` : ''}{fmt(p.value)}</p>
      ))}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-sm text-slate-400">{message}</div>
  );
}
