// Daily QA Snapshot — aggregation + HTML rendering for the morning email
// digest. Cron at /api/cron/daily-snapshot fires this once a day at 07:00 UTC
// covering the prior full UTC day; admin trigger at /api/admin/daily-snapshot
// supports ?dry=1 (HTML preview), ?date=YYYY-MM-DD (override target day) and
// ?to=<addr> (override recipient list for solo test sends).
//
// Comparison semantics (per Val's spec):
//   - Every delta pill is vs the trailing 7-day average, computed from
//     [target - 7 days, target) — i.e. the 7 full UTC days before the target.
//   - Δ within ±5% renders as a neutral grey "≈ ±X%" pill ("flat zone").
//   - Direction-aware coloring: an increase is "good" for some metrics
//     (Closure Rate, Resolved, Analyzed, L0) and "bad" for most others.
//     See METRIC_DIRECTION below.
//   - Top 5 Movers excludes any issue already in Top 5 Issues.
//
// Pending <24h / >24h tiles are operational (current state, not a daily
// aggregate), so they have no historical baseline to compare against in v1.
// They render their value with no delta pill until we add a daily snapshots
// table that records pending counts each morning. This is called out in the
// TILES section below.
//
// All filter / parse helpers come from lib/analyticsFilters so the snapshot's
// counts match the dashboard one-to-one.

import { supabase } from '@/lib/supabase';
import {
  parseAnalysisSummary,
  normalizeSeverity,
  ANALYSIS_MIN_DATE_ISO,
} from '@/lib/analyticsFilters';

// ── Constants ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 1000;
const FLAT_THRESHOLD_PCT = 5;
const BRAND_EXCLUDE_LOWER = 'rooster partners';
const BASELINE_DAYS = 7;
const MOVER_MIN_VOLUME = 5;       // require either today >= 5 or baselineAvg >= 2 to be a mover candidate

// ── Types ─────────────────────────────────────────────────────────────────

export type Direction = 'bad-up' | 'good-up' | 'neutral';

export interface DeltaPill {
  state: 'up' | 'down' | 'flat' | 'na';
  // Signed percentage vs baseline. Null when there's no baseline (e.g. pending
  // tiles in v1, or when the metric hasn't existed long enough).
  pct: number | null;
  // Special-case "new today, zero in baseline" pills.
  isNew?: boolean;
  label: string;
  color: 'red' | 'green' | 'grey';
}

export interface GlanceTile {
  label: string;
  value: string;            // formatted display (e.g. "308", "61%")
  delta: DeltaPill;
  href: string | null;
}

export interface IssueRow {
  rank: string;             // "01" or "↑" / "↓" for movers
  label: string;
  count: number;
  delta: DeltaPill;
  href: string;
}

export interface ResolutionRow {
  label: string;
  count: number;
  pct: number;              // share within yesterday's resolution mix
  delta: DeltaPill;
  direction: Direction;
}

export interface SeverityRow {
  level: 0 | 1 | 2 | 3;
  count: number;
  delta: DeltaPill;
  direction: Direction;
}

export interface BreakdownRow {
  rank: string;             // "01"..
  label: string;            // underlying value used to build the deep-link
  // Pre-formatted label as shown in the email. Defaults to `${rank} · ${label}`
  // when omitted; languages override this to render `${flag} ${fullName}`
  // (no rank prefix per the mockup).
  displayLabel?: string;
  count: number;
  pct: number;
  delta: DeltaPill;
  href: string;
}

export interface AgentRow {
  rank: string;
  name: string;
  count: number;
  delta: DeltaPill;
  href: string;
}

export interface SnapshotData {
  targetDateISO: string;          // 'YYYY-MM-DD' UTC
  targetDateLabel: string;        // 'Tuesday, May 5, 2026'
  baselineDays: number;
  hasFullBaseline: boolean;
  totals: {
    conversations: number;
    escalations: number;
    pendingUnder24h: number;      // current-state, no baseline in v1
    pendingOver24h: number;
    closureRate: number;          // 0-100 integer percent
    analyzed: number;
    unanalyzed: number;
  };
  glanceTop: GlanceTile[];
  glanceBottom: GlanceTile[];
  topIssues: IssueRow[];
  topMovers: IssueRow[];
  resolutions: ResolutionRow[];
  severities: SeverityRow[];
  brands: BreakdownRow[];
  languages: BreakdownRow[];
  agents: AgentRow[];
  // Full ordered list of issues seen on the target day (count > 0). Mirrors
  // the dashboard's "Issues Breakdown" widget — same row format as topIssues
  // with no top-N cap.
  issuesBreakdown: IssueRow[];
}

// ── Window math ───────────────────────────────────────────────────────────

// Returns the target day window (a single full UTC day) plus the trailing
// 7-day baseline window ending where the target begins.
//
//   targetDateISO: 'YYYY-MM-DD' for the day to report. Defaults to "yesterday
//     in UTC" relative to nowOverride (or new Date()).
//
// Example: targetDateISO='2026-05-04'
//   target   = [2026-05-04T00:00Z, 2026-05-05T00:00Z)
//   baseline = [2026-04-27T00:00Z, 2026-05-04T00:00Z)
export function computeWindows(targetDateISO?: string, nowOverride?: Date): {
  targetStart: Date;
  targetEnd: Date;
  baselineStart: Date;
  baselineEnd: Date;
  targetISO: string;
} {
  let targetStart: Date;
  if (targetDateISO) {
    targetStart = new Date(`${targetDateISO}T00:00:00.000Z`);
    if (Number.isNaN(targetStart.getTime())) {
      throw new Error(`Invalid targetDateISO: ${targetDateISO}`);
    }
  } else {
    targetStart = new Date(nowOverride ?? new Date());
    targetStart.setUTCHours(0, 0, 0, 0);
    targetStart.setUTCDate(targetStart.getUTCDate() - 1);
  }
  const targetEnd = new Date(targetStart);
  targetEnd.setUTCDate(targetEnd.getUTCDate() + 1);

  const baselineEnd = new Date(targetStart);
  const baselineStart = new Date(targetStart);
  baselineStart.setUTCDate(baselineStart.getUTCDate() - BASELINE_DAYS);

  return {
    targetStart,
    targetEnd,
    baselineStart,
    baselineEnd,
    targetISO: targetStart.toISOString().slice(0, 10),
  };
}

// ── Direction config ──────────────────────────────────────────────────────

// Per Val's point 3: an increase isn't always bad. Closure Rate, Analyzed,
// Resolved and L0 are "good when up"; volume tiles, escalations, pending,
// unresolved and L1+ severities are "bad when up". Brand/language/agent rows
// have no positive/negative meaning attached — we just show direction.
type MetricKey =
  | 'conversations' | 'escalations' | 'pendingUnder' | 'pendingOver'
  | 'closureRate' | 'analyzed' | 'unanalyzed'
  | 'issue' | 'mover'
  | 'resolved' | 'partial' | 'unresolved'
  | 'severity0' | 'severity1' | 'severity2' | 'severity3'
  | 'brand' | 'language' | 'agent';

const METRIC_DIRECTION: Record<MetricKey, Direction> = {
  conversations: 'bad-up',
  escalations:   'bad-up',
  pendingUnder:  'bad-up',
  pendingOver:   'bad-up',
  closureRate:   'good-up',
  analyzed:      'good-up',
  unanalyzed:    'bad-up',
  issue:         'bad-up',
  mover:         'bad-up',
  resolved:      'good-up',
  partial:       'good-up',
  unresolved:    'bad-up',
  severity0:     'good-up',
  severity1:     'bad-up',
  severity2:     'bad-up',
  severity3:     'bad-up',
  brand:         'neutral',
  language:      'neutral',
  agent:         'neutral',
};

// ── Pill construction ─────────────────────────────────────────────────────

// Builds a DeltaPill from a target value and the trailing-7-day average.
// Behavioural notes that aren't visible from the math alone:
//   - hasFullBaseline=false → render "—" (state='na'), regardless of values.
//     The first 7 days after launch can't have a real baseline yet.
//   - baselineAvg=0 with a non-zero target → "new" pill (no percent: any
//     finite ratio would be misleading and any large number (200%, 400%) just
//     looks noisy).
//   - both zero → flat "0%" pill.
//   - direction='neutral' renders as a colored pill that just shows direction
//     (red ↑ / green ↓ regardless — these rows have no good/bad meaning, so
//     we use the same color scheme as bad-up so an upward arrow is consistent
//     visually). Movement is the signal; what color it is is secondary.
export function formatPill(
  targetVal: number,
  baselineAvg: number,
  direction: Direction,
  hasFullBaseline: boolean,
): DeltaPill {
  if (!hasFullBaseline) {
    return { state: 'na', pct: null, label: '—', color: 'grey' };
  }
  if (baselineAvg === 0 && targetVal === 0) {
    return { state: 'flat', pct: 0, label: '≈ 0%', color: 'grey' };
  }
  if (baselineAvg === 0 && targetVal > 0) {
    return { state: 'up', pct: null, isNew: true, label: '▲ new', color: pickColor('up', direction) };
  }
  const deltaPct = ((targetVal - baselineAvg) / baselineAvg) * 100;
  const rounded = Math.round(deltaPct);
  const abs = Math.abs(rounded);

  if (abs <= FLAT_THRESHOLD_PCT) {
    const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
    return { state: 'flat', pct: rounded, label: `≈ ${sign}${Math.abs(rounded)}%`, color: 'grey' };
  }
  const state: 'up' | 'down' = rounded > 0 ? 'up' : 'down';
  const arrow = state === 'up' ? '▲' : '▼';
  const sign = state === 'up' ? '+' : '-';
  return { state, pct: rounded, label: `${arrow} ${sign}${Math.abs(rounded)}%`, color: pickColor(state, direction) };
}

// Closure-rate-style metrics need a percentage-point delta, not a percent
// change of a percent. (e.g. 60% → 65% is "+5pp", not "+8.3%").
export function formatPpPill(
  targetPct: number,         // 0-100
  baselineAvgPct: number,    // 0-100
  direction: Direction,
  hasFullBaseline: boolean,
): DeltaPill {
  if (!hasFullBaseline) {
    return { state: 'na', pct: null, label: '—', color: 'grey' };
  }
  const delta = Math.round(targetPct - baselineAvgPct);
  const abs = Math.abs(delta);
  if (abs <= FLAT_THRESHOLD_PCT) {
    const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
    return { state: 'flat', pct: delta, label: `≈ ${sign}${abs}pp`, color: 'grey' };
  }
  const state: 'up' | 'down' = delta > 0 ? 'up' : 'down';
  const arrow = state === 'up' ? '▲' : '▼';
  const sign = state === 'up' ? '+' : '-';
  return { state, pct: delta, label: `${arrow} ${sign}${abs}pp`, color: pickColor(state, direction) };
}

function pickColor(state: 'up' | 'down', direction: Direction): 'red' | 'green' {
  // Neutral rows borrow the bad-up palette so motion is visible — see comment
  // in formatPill above.
  if (direction === 'good-up') return state === 'up' ? 'green' : 'red';
  return state === 'up' ? 'red' : 'green';
}

// ── Data fetch ────────────────────────────────────────────────────────────

interface RawRow {
  id: string;
  intercom_created_at: string | null;
  summary: string | null;
  brand: string | null;
  agent_name: string | null;
  language: string | null;
  resolution_status: string | null;
  dissatisfaction_severity: string | null;
  is_alert_worthy: boolean | null;
  asana_task_gid: string | null;
  asana_completed_at: string | null;
  asana_task_deleted_at: string | null;
}

// Single-pass Supabase pagination covering [baselineStart, targetEnd). Each
// row carries its intercom_created_at; we bucket per-row in aggregate() based
// on which window the timestamp falls into.
async function fetchRows(baselineStart: Date, targetEnd: Date): Promise<RawRow[]> {
  // ANALYSIS_MIN_DATE_ISO is the project's hard floor — never read older data.
  const startISO = baselineStart.toISOString();
  const effectiveStart = startISO > ANALYSIS_MIN_DATE_ISO ? startISO : ANALYSIS_MIN_DATE_ISO;

  const out: RawRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('conversations')
      .select(
        'id, intercom_created_at, summary, brand, agent_name, language, ' +
        'resolution_status, dissatisfaction_severity, is_alert_worthy, ' +
        'asana_task_gid, asana_completed_at, asana_task_deleted_at',
      )
      .gte('intercom_created_at', effectiveStart)
      .lt('intercom_created_at', targetEnd.toISOString())
      .order('intercom_created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`[daily-snapshot] fetchRows: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as RawRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  // Defensive dedup by id — mirrors the dashboard route's safeguard against
  // any future paging quirk.
  const seen = new Set<string>();
  return out.filter((r) => {
    if (!r.id || seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

// Pending counts mirror the dashboard's pendingEscalations exactly: live
// Asana tasks (gid set, not deleted in Asana) that aren't completed, bucketed
// by analyzed_at age relative to "now".
async function fetchPendingNow(now: Date): Promise<{ under24: number; over24: number }> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  let under24 = 0;
  let over24 = 0;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('conversations')
      .select('analyzed_at')
      .not('asana_task_gid', 'is', null)
      .is('asana_task_deleted_at', null)
      .is('asana_completed_at', null)
      .order('analyzed_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`[daily-snapshot] fetchPendingNow: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ analyzed_at: string | null }>) {
      const age = r.analyzed_at ? nowMs - new Date(r.analyzed_at).getTime() : Infinity;
      if (age < DAY_MS) under24 += 1;
      else              over24  += 1;
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { under24, over24 };
}

// ── Per-row parsing ───────────────────────────────────────────────────────

interface ParsedRow {
  iso: string;
  inTarget: boolean;
  brand: string | null;          // raw brand label (display-cased)
  agent: string;                 // 'Unknown' for null
  languageUpper: string | null;  // 'EN', 'DE', ...
  resolution: 'Resolved' | 'Partially Resolved' | 'Unresolved';
  severityLevel: 0 | 1 | 2 | 3 | null;
  isEscalation: boolean;
  isResolvedEscalation: boolean;
  isAnalyzed: boolean;
  // Per-row deduped issue display labels (numeric prefix stripped, plurals
  // collapsed via normalizeIssueKey for the de-dup but the raw clean label
  // kept for display). Each row contributes each unique issue label exactly
  // once — mirrors the dashboard's topItems aggregation.
  issues: { key: string; label: string }[];
}

const stripItemNum = (s: string) => s.replace(/^\d+\.\s*/, '').trim();
const normalizeIssueKey = (s: string) => s.toLowerCase().replace(/s$/, '');

function parseRows(rows: RawRow[], targetStart: Date, targetEnd: Date): ParsedRow[] {
  const tStart = targetStart.getTime();
  const tEnd = targetEnd.getTime();
  return rows.map((r) => {
    const iso = r.intercom_created_at ?? '';
    const t = iso ? new Date(iso).getTime() : NaN;
    const inTarget = !Number.isNaN(t) && t >= tStart && t < tEnd;

    const summary = parseAnalysisSummary(r.summary);
    const isAnalyzed = !!r.summary;

    // Resolution: collapse null/Unknown into Unresolved (matches dashboard).
    const rawRes = (r.resolution_status ?? summary.resolution_status ?? '').trim();
    const resLower = rawRes.toLowerCase();
    let resolution: ParsedRow['resolution'] = 'Unresolved';
    if (resLower === 'resolved') resolution = 'Resolved';
    else if (resLower === 'partially resolved') resolution = 'Partially Resolved';
    // anything else (incl. blank/Unknown) → Unresolved

    // Severity: prefer the column, fall back to the worst level inside results[]
    const sevRaw = r.dissatisfaction_severity ?? summary.dissatisfaction_severity ?? null;
    const sevLabel = normalizeSeverity(sevRaw); // 'Level 0'..'Level 3' or null
    let severityLevel: ParsedRow['severityLevel'] = null;
    if (sevLabel) {
      const m = sevLabel.match(/[0123]/);
      if (m) severityLevel = parseInt(m[0], 10) as 0 | 1 | 2 | 3;
    }

    // Issues: dedup per row by normalized key, keep the cleaned (de-numbered)
    // label as the display value.
    const seenKeys = new Set<string>();
    const issues: ParsedRow['issues'] = [];
    for (const it of summary.results) {
      const raw = it.item ?? '';
      if (!raw || raw === 'Unknown') continue;
      const clean = stripItemNum(raw);
      if (!clean) continue;
      const key = normalizeIssueKey(clean);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      issues.push({ key, label: clean });
    }

    const langRaw = (r.language ?? summary.language ?? null);
    const languageUpper = langRaw ? String(langRaw).trim().toUpperCase() : null;

    return {
      iso,
      inTarget,
      brand: r.brand,
      agent: r.agent_name ?? 'Unknown',
      languageUpper,
      resolution,
      severityLevel,
      isEscalation: !!(r.asana_task_gid && !r.asana_task_deleted_at),
      isResolvedEscalation: !!(r.asana_task_gid && !r.asana_task_deleted_at && r.asana_completed_at),
      isAnalyzed,
      issues,
    };
  });
}

// ── Aggregation ───────────────────────────────────────────────────────────

interface BreakdownAgg {
  // Display-stable label for the row; for things like brand/language we keep
  // the most-frequent casing variant when the same value appears in multiple
  // forms. For agents we just preserve the column value.
  label: string;
  // Yesterday's count.
  target: number;
  // Sum across the baseline window — divide by BASELINE_DAYS for the per-day
  // average comparison.
  baselineTotal: number;
}

function tally(
  rows: ParsedRow[],
  pickKeys: (r: ParsedRow) => Array<{ key: string; label: string }>,
): Map<string, BreakdownAgg> {
  const map = new Map<string, BreakdownAgg>();
  for (const r of rows) {
    const items = pickKeys(r);
    for (const { key, label } of items) {
      const cur = map.get(key) ?? { label, target: 0, baselineTotal: 0 };
      if (r.inTarget) cur.target += 1;
      else            cur.baselineTotal += 1;
      cur.label = label; // last-write-wins on label is fine: callers iterate analyzed rows in time-desc order, so the most recent casing wins
      map.set(key, cur);
    }
  }
  return map;
}

// Builds a deep-link to the dashboard with the conversations overlay
// pre-opened, matching the URL shape the dashboard's overlay restoration
// reads (ov_filters JSON + ov_title). The overlay drill-down is what the
// dashboard's tile/row clicks already use, so we get the same behaviour.
//
// Pass an empty `extra` object to land on yesterday's full conversation list.
function makeOverlayHref(
  baseUrl: string,
  targetISO: string,
  extra: Record<string, string | string[]>,
  title: string,
): string {
  // pending_age is a "global" drill (current state, ignores date) — match the
  // dashboard's navToConversations behaviour by NOT including the date in
  // ov_filters when pending_age is present.
  const isGlobalDrill = 'pending_age' in extra;
  const filters: Record<string, string | string[]> = isGlobalDrill
    ? { ...extra }
    : { dateFrom: targetISO, dateTo: targetISO, ...extra };

  const sp = new URLSearchParams();
  sp.set('ov_filters', JSON.stringify(filters));
  sp.set('ov_title', title);
  return `${baseUrl}/dashboard?${sp.toString()}`;
}

function getDashboardBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return `https://${vercelProd}`;
  const vercelDeploy = process.env.VERCEL_URL;
  if (vercelDeploy) return `https://${vercelDeploy}`;
  return ''; // links will be relative — works only when opened from same host
}

// ── Public API ────────────────────────────────────────────────────────────

export interface BuildOptions {
  targetDateISO?: string;
  nowOverride?: Date;
  // Min issue count required to land in Top Issues / Movers — defaults to 1.
  // We mostly use the default; the constant exists so admin tools can crank
  // it up to silence very-low-volume noise during testing.
  minIssueCount?: number;
}

export async function buildSnapshot(opts: BuildOptions = {}): Promise<SnapshotData> {
  const now = opts.nowOverride ?? new Date();
  const w = computeWindows(opts.targetDateISO, now);

  // Floor check: if the entire baseline window starts before the analysis
  // cutoff, we don't have a comparable history yet. The pills render as "—".
  const cutoff = new Date(ANALYSIS_MIN_DATE_ISO);
  const hasFullBaseline = w.baselineStart >= cutoff;

  const [rawRows, pending] = await Promise.all([
    fetchRows(w.baselineStart, w.targetEnd),
    fetchPendingNow(now),
  ]);
  const parsed = parseRows(rawRows, w.targetStart, w.targetEnd);

  // ── Bucket into target / baseline ──
  const targetRows   = parsed.filter((p) => p.inTarget);
  const baselineRows = parsed.filter((p) => !p.inTarget);

  // ── Top-line counts ──
  const conversations = targetRows.length;
  const escalations = targetRows.filter((p) => p.isEscalation).length;
  const resolvedEsc = targetRows.filter((p) => p.isResolvedEscalation).length;
  const closureRate = escalations > 0 ? Math.round((resolvedEsc / escalations) * 100) : 0;
  const analyzed   = targetRows.filter((p) => p.isAnalyzed).length;
  const unanalyzed = conversations - analyzed;

  // Baseline averages
  const baselineConversations = baselineRows.length / BASELINE_DAYS;
  const baselineEscalations = baselineRows.filter((p) => p.isEscalation).length / BASELINE_DAYS;
  const baselineAnalyzed = baselineRows.filter((p) => p.isAnalyzed).length / BASELINE_DAYS;
  const baselineUnanalyzed = baselineRows.filter((p) => !p.isAnalyzed).length / BASELINE_DAYS;

  // Closure rate: average per-day closure rate across the baseline. Days with
  // zero escalations are excluded from the average so an empty day doesn't
  // drag the rate to 0% artificially. If every baseline day was empty we have
  // no usable baseline → pill becomes "—".
  const baselineByDay = new Map<string, { esc: number; resolved: number }>();
  for (const p of baselineRows) {
    if (!p.isEscalation || !p.iso) continue;
    const day = p.iso.slice(0, 10);
    const cur = baselineByDay.get(day) ?? { esc: 0, resolved: 0 };
    cur.esc += 1;
    if (p.isResolvedEscalation) cur.resolved += 1;
    baselineByDay.set(day, cur);
  }
  const baselineClosureSamples: number[] = [];
  for (const v of baselineByDay.values()) {
    if (v.esc > 0) baselineClosureSamples.push((v.resolved / v.esc) * 100);
  }
  const baselineClosureRate = baselineClosureSamples.length > 0
    ? baselineClosureSamples.reduce((a, b) => a + b, 0) / baselineClosureSamples.length
    : 0;
  const closureBaselineUsable = hasFullBaseline && baselineClosureSamples.length > 0;

  // ── Deep-link helper bound to the target ISO ──
  const baseUrl = getDashboardBaseUrl();
  const link = (extra: Record<string, string | string[]>, title: string) =>
    makeOverlayHref(baseUrl, w.targetISO, extra, title);

  // ── Glance tiles ──
  const targetLabel = formatHumanDate(w.targetStart);
  const glanceTop: GlanceTile[] = [
    {
      label: 'Conversations',
      value: String(conversations),
      delta: formatPill(conversations, baselineConversations, METRIC_DIRECTION.conversations, hasFullBaseline),
      href: link({}, `Conversations on ${w.targetISO}`),
    },
    {
      label: 'Escalations',
      value: String(escalations),
      delta: formatPill(escalations, baselineEscalations, METRIC_DIRECTION.escalations, hasFullBaseline),
      href: link({ asana_ticketed: 'true' }, `Escalations on ${w.targetISO}`),
    },
    {
      label: 'Pending < 24h',
      value: String(pending.under24),
      // No baseline stored historically — pill stays "—" until we add a daily
      // pending-snapshots table (see file header). Passing hasFullBaseline=false
      // forces the "—" path regardless of values.
      delta: formatPill(0, 0, METRIC_DIRECTION.pendingUnder, false),
      href: link({ pending_age: 'under_24h' }, 'Pending Action <24h'),
    },
    {
      label: 'Pending > 24h',
      value: String(pending.over24),
      delta: formatPill(0, 0, METRIC_DIRECTION.pendingOver, false),
      href: link({ pending_age: 'over_24h' }, 'Pending Action >24h'),
    },
    {
      label: 'Closure Rate',
      value: `${closureRate}%`,
      delta: formatPpPill(closureRate, baselineClosureRate, METRIC_DIRECTION.closureRate, closureBaselineUsable),
      href: link({ asana_ticketed: 'true' }, `Escalations on ${w.targetISO}`),
    },
  ];
  const glanceBottom: GlanceTile[] = [
    {
      label: 'Analyzed',
      value: `${analyzed}${conversations > 0 ? ` · ${Math.round((analyzed / conversations) * 100)}% of total` : ''}`,
      delta: formatPill(analyzed, baselineAnalyzed, METRIC_DIRECTION.analyzed, hasFullBaseline),
      href: link({ analyzed: 'true' }, 'Analyzed Conversations'),
    },
    {
      label: 'Unanalyzed',
      value: String(unanalyzed),
      delta: formatPill(unanalyzed, baselineUnanalyzed, METRIC_DIRECTION.unanalyzed, hasFullBaseline),
      href: link({ analyzed: 'false' }, 'Unanalyzed Conversations'),
    },
  ];

  // ── Top Issues / Movers ──
  // Issues are computed off ANALYZED rows only — same as the dashboard.
  const issueAgg = tally(parsed.filter((p) => p.isAnalyzed), (p) => p.issues);
  const allIssues = [...issueAgg.values()].map((v) => ({
    label: v.label,
    target: v.target,
    baselineAvg: v.baselineTotal / BASELINE_DAYS,
  }));

  const issuesByTargetDesc = [...allIssues]
    .filter((x) => x.target > 0)
    .sort((a, b) => b.target - a.target || a.label.localeCompare(b.label));

  const topIssuesSorted = issuesByTargetDesc
    .filter((x) => x.target >= (opts.minIssueCount ?? 1))
    .slice(0, 5);
  const topIssueLabels = new Set(topIssuesSorted.map((x) => x.label));
  const topIssues: IssueRow[] = topIssuesSorted.map((x, i) => ({
    rank: String(i + 1).padStart(2, '0'),
    label: x.label,
    count: x.target,
    delta: formatPill(x.target, x.baselineAvg, METRIC_DIRECTION.issue, hasFullBaseline),
    href: link({ issue_item: x.label }, `${x.label} on ${w.targetISO}`),
  }));

  // Issues Breakdown: full ordered list of yesterday's issues (mirrors the
  // dashboard widget). Same row format as topIssues, no slice — recipients
  // get the long tail, with deep-links to drill into any of them.
  const issuesBreakdown: IssueRow[] = issuesByTargetDesc.map((x, i) => ({
    rank: String(i + 1).padStart(2, '0'),
    label: x.label,
    count: x.target,
    delta: formatPill(x.target, x.baselineAvg, METRIC_DIRECTION.issue, hasFullBaseline),
    href: link({ issue_item: x.label }, `${x.label} on ${w.targetISO}`),
  }));

  const moverCandidates = allIssues
    .filter((x) => !topIssueLabels.has(x.label))
    // Volume floor — the noise from 1→2 (+100%) flips dominate movers without this.
    .filter((x) => x.target >= MOVER_MIN_VOLUME || x.baselineAvg >= 2);
  const topMoversSorted = moverCandidates
    .map((x) => ({
      ...x,
      // Compute a sortable "movement magnitude". When baselineAvg=0 we treat
      // movement as max so brand-new spikes still surface. Otherwise it's
      // |delta%| with target as a tiebreaker.
      magnitude: x.baselineAvg === 0 ? Number.POSITIVE_INFINITY : Math.abs((x.target - x.baselineAvg) / x.baselineAvg) * 100,
    }))
    .sort((a, b) => b.magnitude - a.magnitude || b.target - a.target)
    .slice(0, 5);
  const topMovers: IssueRow[] = topMoversSorted.map((x) => {
    const pill = formatPill(x.target, x.baselineAvg, METRIC_DIRECTION.mover, hasFullBaseline);
    return {
      rank: pill.state === 'up' ? '↑' : pill.state === 'down' ? '↓' : '·',
      label: x.label,
      count: x.target,
      delta: pill,
      href: link({ issue_item: x.label }, `${x.label} on ${w.targetISO}`),
    };
  });

  // ── Resolution breakdown ──
  type ResLabel = 'Resolved' | 'Partially Resolved' | 'Unresolved';
  const resTarget: Record<ResLabel, number> = { 'Resolved': 0, 'Partially Resolved': 0, 'Unresolved': 0 };
  const resBaseline: Record<ResLabel, number> = { 'Resolved': 0, 'Partially Resolved': 0, 'Unresolved': 0 };
  for (const p of parsed) {
    if (!p.isAnalyzed) continue;
    if (p.inTarget) resTarget[p.resolution] += 1;
    else            resBaseline[p.resolution] += 1;
  }
  const resTotal = resTarget.Resolved + resTarget['Partially Resolved'] + resTarget.Unresolved;
  const resolutionDirections: Record<ResLabel, MetricKey> = {
    'Resolved': 'resolved',
    'Partially Resolved': 'partial',
    'Unresolved': 'unresolved',
  };
  const resolutions: ResolutionRow[] = (['Resolved', 'Partially Resolved', 'Unresolved'] as ResLabel[]).map((k) => {
    const tgt = resTarget[k];
    const baseAvg = resBaseline[k] / BASELINE_DAYS;
    const dirKey = resolutionDirections[k];
    const direction = METRIC_DIRECTION[dirKey];
    return {
      label: k,
      count: tgt,
      pct: resTotal > 0 ? Math.round((tgt / resTotal) * 100) : 0,
      delta: formatPill(tgt, baseAvg, direction, hasFullBaseline),
      direction,
    };
  });

  // ── Severity breakdown ──
  const sevTarget = [0, 0, 0, 0];
  const sevBaseline = [0, 0, 0, 0];
  for (const p of parsed) {
    if (!p.isAnalyzed || p.severityLevel == null) continue;
    if (p.inTarget) sevTarget[p.severityLevel] += 1;
    else            sevBaseline[p.severityLevel] += 1;
  }
  const severities: SeverityRow[] = ([0, 1, 2, 3] as const).map((lvl) => {
    const dirKey: MetricKey = (`severity${lvl}` as MetricKey);
    const direction = METRIC_DIRECTION[dirKey];
    return {
      level: lvl,
      count: sevTarget[lvl],
      delta: formatPill(sevTarget[lvl], sevBaseline[lvl] / BASELINE_DAYS, direction, hasFullBaseline),
      direction,
    };
  });

  // ── Brand breakdown (analyzed rows only, exclude rooster partners) ──
  const brandAgg = tally(parsed.filter((p) => p.isAnalyzed), (p) => {
    if (!p.brand || p.brand.trim().toLowerCase() === BRAND_EXCLUDE_LOWER) return [];
    return [{ key: p.brand.trim().toLowerCase(), label: p.brand.trim() }];
  });
  const brands = topNBreakdown(
    [...brandAgg.values()],
    10,
    targetRows.filter((p) => p.isAnalyzed && p.brand && p.brand.trim().toLowerCase() !== BRAND_EXCLUDE_LOWER).length,
    METRIC_DIRECTION.brand,
    hasFullBaseline,
    (label) => link({ brand: label }, `${label} on ${w.targetISO}`),
  );

  // ── Language breakdown ──
  // Display format per the mockup: "🇬🇧 English" (flag + full name, no rank
  // prefix). The underlying `label` stays as the ISO code so the deep-link
  // filter still matches the dashboard's language filter.
  const langAgg = tally(parsed.filter((p) => p.isAnalyzed), (p) => {
    if (!p.languageUpper) return [];
    return [{ key: p.languageUpper, label: p.languageUpper }];
  });
  const languages = topNBreakdown(
    [...langAgg.values()],
    10,
    targetRows.filter((p) => p.isAnalyzed && p.languageUpper).length,
    METRIC_DIRECTION.language,
    hasFullBaseline,
    (label) => link({ language: label }, `${label} on ${w.targetISO}`),
  ).map((r) => ({ ...r, displayLabel: formatLanguageDisplay(r.label) }));

  // ── Agent volume (all agents, ranked) ──
  const agentAgg = tally(parsed.filter((p) => p.isAnalyzed), (p) => [{ key: p.agent.toLowerCase(), label: p.agent }]);
  const agents: AgentRow[] = [...agentAgg.values()]
    .sort((a, b) => b.target - a.target || a.label.localeCompare(b.label))
    .map((v, i) => ({
      rank: String(i + 1).padStart(2, '0'),
      name: v.label,
      count: v.target,
      delta: formatPill(v.target, v.baselineTotal / BASELINE_DAYS, METRIC_DIRECTION.agent, hasFullBaseline),
      href: link({ agent_name: v.label }, `${v.label} on ${w.targetISO}`),
    }));

  return {
    targetDateISO: w.targetISO,
    targetDateLabel: targetLabel,
    baselineDays: BASELINE_DAYS,
    hasFullBaseline,
    totals: {
      conversations,
      escalations,
      pendingUnder24h: pending.under24,
      pendingOver24h: pending.over24,
      closureRate,
      analyzed,
      unanalyzed,
    },
    glanceTop,
    glanceBottom,
    topIssues,
    topMovers,
    resolutions,
    severities,
    brands,
    languages,
    agents,
    issuesBreakdown,
  };
}

function topNBreakdown(
  entries: BreakdownAgg[],
  n: number,
  totalForPct: number,
  direction: Direction,
  hasFullBaseline: boolean,
  hrefFor: (label: string) => string,
): BreakdownRow[] {
  return entries
    .sort((a, b) => b.target - a.target || a.label.localeCompare(b.label))
    .slice(0, n)
    .map((v, i) => ({
      rank: String(i + 1).padStart(2, '0'),
      label: v.label,
      count: v.target,
      pct: totalForPct > 0 ? Math.round((v.target / totalForPct) * 100) : 0,
      delta: formatPill(v.target, v.baselineTotal / BASELINE_DAYS, direction, hasFullBaseline),
      href: hrefFor(v.label),
    }));
}

function formatHumanDate(d: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ISO-639-1 → { flag, full English name } for the languages we see in this
// project's data. The Arabic entry uses the GCC qualifier the dashboard's
// language column carries; the flag is Saudi Arabia by convention since
// there's no flag for the Arabic language itself. Unknown ISO codes fall
// through to the bare code so the row still renders.
const LANGUAGE_DISPLAY: Record<string, { flag: string; name: string }> = {
  EN: { flag: '🇬🇧', name: 'English' },
  DE: { flag: '🇩🇪', name: 'German' },
  FR: { flag: '🇫🇷', name: 'French' },
  IT: { flag: '🇮🇹', name: 'Italian' },
  ES: { flag: '🇪🇸', name: 'Spanish' },
  PT: { flag: '🇵🇹', name: 'Portuguese' },
  NL: { flag: '🇳🇱', name: 'Dutch' },
  SV: { flag: '🇸🇪', name: 'Swedish' },
  NO: { flag: '🇳🇴', name: 'Norwegian' },
  DA: { flag: '🇩🇰', name: 'Danish' },
  FI: { flag: '🇫🇮', name: 'Finnish' },
  PL: { flag: '🇵🇱', name: 'Polish' },
  CS: { flag: '🇨🇿', name: 'Czech' },
  EL: { flag: '🇬🇷', name: 'Greek' },
  TR: { flag: '🇹🇷', name: 'Turkish' },
  RU: { flag: '🇷🇺', name: 'Russian' },
  HU: { flag: '🇭🇺', name: 'Hungarian' },
  RO: { flag: '🇷🇴', name: 'Romanian' },
  BG: { flag: '🇧🇬', name: 'Bulgarian' },
  AR: { flag: '🇸🇦', name: 'Arabic (GCC)' },
  JA: { flag: '🇯🇵', name: 'Japanese' },
  ZH: { flag: '🇨🇳', name: 'Chinese' },
};

function formatLanguageDisplay(iso: string): string {
  const v = LANGUAGE_DISPLAY[iso.toUpperCase()];
  return v ? `${v.flag} ${v.name}` : iso;
}

// ── HTML rendering ────────────────────────────────────────────────────────

// Email-safe HTML: tables for layout, all styles inlined, no CSS variables,
// no flex / grid / gradients / pseudo-elements. Tested mentally against
// Outlook-Word, Gmail web, Apple Mail. No client-specific shims yet — if
// rendering quirks turn up during QA we'll add targeted fixes.
//
// Color palette is a desaturated dark theme close to the mockup. Pills use
// solid pastel backgrounds with high-contrast text so they survive Outlook's
// auto-darkening passes.

const COLORS = {
  bgOuter: '#0a0b0f',
  bgCard: '#14161c',
  bgTile: '#1a1d26',
  border: '#23262f',
  text1: '#f5f6fa',
  text2: '#a1a4ae',
  text3: '#6b6e78',
  link: '#cbd5ff',
  // Pill palette — pastel bg + dark text reads consistently across clients
  pillRedBg: '#3a1a1f',  pillRedText: '#fca5a5',
  pillGreenBg: '#13301f', pillGreenText: '#86efac',
  pillGreyBg: '#22252e',  pillGreyText: '#9aa0a8',
  // Severity bar colors
  sev0: '#22c55e',
  sev1: '#f59e0b',
  sev2: '#f97316',
  sev3: '#ef4444',
} as const;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pillHtml(p: DeltaPill): string {
  const bg =
    p.color === 'red'   ? COLORS.pillRedBg :
    p.color === 'green' ? COLORS.pillGreenBg : COLORS.pillGreyBg;
  const fg =
    p.color === 'red'   ? COLORS.pillRedText :
    p.color === 'green' ? COLORS.pillGreenText : COLORS.pillGreyText;
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;letter-spacing:0.01em;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(p.label)}</span>`;
}

function tile(t: GlanceTile, width: string): string {
  const inner = `
    <div style="font-size:10px;color:${COLORS.text3};text-transform:uppercase;letter-spacing:0.08em;font-weight:600;font-family:Arial,Helvetica,sans-serif;margin-bottom:8px;">${escapeHtml(t.label)}</div>
    <div style="font-size:22px;font-weight:600;color:${COLORS.text1};font-family:Arial,Helvetica,sans-serif;line-height:1.1;">${escapeHtml(t.value)}</div>
    <div style="margin-top:8px;">${pillHtml(t.delta)}</div>
  `;
  const cell = `<td width="${width}" valign="top" style="background:${COLORS.bgTile};border:1px solid ${COLORS.border};border-radius:8px;padding:14px 14px 12px;">${inner}</td>`;
  if (t.href) {
    // Wrapping a <td> in <a> isn't valid HTML; instead we color the inner
    // text via the parent <a> and let the whole tile area visually act as a
    // link via an <a> wrapping the inner div. In practice email clients
    // won't make the *cell padding* clickable — only the wrapped text — but
    // the link text is visually distinctive enough.
    return `<td width="${width}" valign="top" style="background:${COLORS.bgTile};border:1px solid ${COLORS.border};border-radius:8px;padding:0;"><a href="${escapeHtml(t.href)}" style="display:block;padding:14px 14px 12px;text-decoration:none;color:inherit;">${inner}</a></td>`;
  }
  return cell;
}

function issueRowHtml(r: IssueRow): string {
  // Fixed widths on rank/count/pill so every row's columns align across the
  // section. Without these, each row's nested table sized its own columns
  // and the count column drifted left/right by issue-name length.
  return `
    <tr>
      <td style="background:${COLORS.bgTile};border:1px solid ${COLORS.border};border-radius:8px;padding:0;">
        <a href="${escapeHtml(r.href)}" style="display:block;text-decoration:none;color:inherit;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;table-layout:fixed;">
            <tr>
              <td width="36" style="padding:12px 0 12px 16px;font-size:12px;font-weight:600;color:${COLORS.text3};">${escapeHtml(r.rank)}</td>
              <td style="padding:12px 14px;font-size:14px;color:${COLORS.text1};">${escapeHtml(r.label)}</td>
              <td align="right" width="60" style="padding:12px 14px;font-size:15px;font-weight:600;color:${COLORS.text1};white-space:nowrap;">${r.count}</td>
              <td align="right" width="110" style="padding:12px 16px 12px 0;white-space:nowrap;">${pillHtml(r.delta)}</td>
            </tr>
          </table>
        </a>
      </td>
    </tr>`;
}

function breakdownRowHtml(r: BreakdownRow): string {
  // 3 fixed columns so count and pill columns share the same right edge across
  // every row, instead of wavering with content width. Label flex column gets
  // (100% - 130 - 100). The displayLabel override lets languages drop the
  // rank prefix in favour of "🇬🇧 English" formatting.
  const shown = r.displayLabel ?? `${r.rank} · ${r.label}`;
  return `
    <tr>
      <td style="padding:0;border-bottom:1px solid ${COLORS.border};font-family:Arial,Helvetica,sans-serif;">
        <a href="${escapeHtml(r.href)}" style="text-decoration:none;color:inherit;display:block;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
            <tr>
              <td style="padding:9px 0;font-size:13px;color:${COLORS.text2};">${escapeHtml(shown)}</td>
              <td align="right" width="130" style="padding:9px 12px 9px 0;font-size:13px;color:${COLORS.text1};font-weight:500;white-space:nowrap;">${r.count} (${r.pct}%)</td>
              <td align="right" width="100" style="padding:9px 0;white-space:nowrap;">${pillHtml(r.delta)}</td>
            </tr>
          </table>
        </a>
      </td>
    </tr>`;
}

function agentRowHtml(r: AgentRow): string {
  // Cells go directly in the outer Agent Volume table so column widths line
  // up with the header row. (The earlier nested-table pattern made the data
  // rows size independently of the header, which split them visually — the
  // header sat to the right while the data clustered to the left.)
  // The same href is repeated on each cell's <a> so any click on any cell
  // navigates correctly; visually this reads as a single clickable row.
  const linkStyle = `text-decoration:none;color:inherit;display:block;`;
  const cellBase = `border-bottom:1px solid ${COLORS.border};font-family:Arial,Helvetica,sans-serif;`;
  return `
    <tr>
      <td width="40" style="padding:10px 14px;font-size:13px;color:${COLORS.text3};${cellBase}"><a href="${escapeHtml(r.href)}" style="${linkStyle}">${escapeHtml(r.rank)}</a></td>
      <td style="padding:10px 14px;font-size:13px;font-weight:500;color:${COLORS.text1};${cellBase}"><a href="${escapeHtml(r.href)}" style="${linkStyle}">${escapeHtml(r.name)}</a></td>
      <td align="right" width="80" style="padding:10px 14px;font-size:13px;font-weight:600;color:${COLORS.text1};white-space:nowrap;${cellBase}"><a href="${escapeHtml(r.href)}" style="${linkStyle}">${r.count}</a></td>
      <td align="right" width="120" style="padding:10px 14px;white-space:nowrap;${cellBase}"><a href="${escapeHtml(r.href)}" style="${linkStyle}">${pillHtml(r.delta)}</a></td>
    </tr>`;
}

function severityBarHtml(severities: SeverityRow[]): string {
  const total = severities.reduce((s, x) => s + x.count, 0) || 1;
  const labels = ['L0', 'L1', 'L2', 'L3'];
  const colors = [COLORS.sev0, COLORS.sev1, COLORS.sev2, COLORS.sev3];
  // We give every nonzero level a min visual share so single-digit buckets
  // are still legible (L2 · 1 shouldn't be a hairline). Levels with 0 count
  // are omitted entirely.
  const segs = severities
    .map((s) => ({ label: `${labels[s.level]} · ${s.count}`, count: s.count, color: colors[s.level] }))
    .filter((s) => s.count > 0);
  if (segs.length === 0) {
    return `<div style="height:32px;background:${COLORS.bgTile};border:1px solid ${COLORS.border};border-radius:6px;"></div>`;
  }
  const segTotal = segs.reduce((s, x) => s + x.count, 0);
  const minSharePct = 8;
  const cells = segs.map((s) => {
    const naturalPct = (s.count / segTotal) * 100;
    const widthPct = Math.max(naturalPct, minSharePct);
    return `<td width="${widthPct.toFixed(2)}%" style="background:${s.color};font-size:11px;font-weight:700;color:#0a0b0f;text-align:center;padding:8px 4px;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(s.label)}</td>`;
  }).join('');
  // Touch up: with min-share rebalancing, the row may sum to >100%; tables
  // tolerate this fine — browsers/clients distribute proportionally — but
  // we still set a fixed table layout so we don't get reflow surprises.
  void total;
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:6px;overflow:hidden;border:1px solid ${COLORS.border};table-layout:fixed;"><tr>${cells}</tr></table>`;
}

function sectionHeader(title: string, sub?: string, icon?: string): string {
  // The icon span has its own font-size + line-height so the emoji doesn't
  // inherit the section-header's letter-spacing (which can space colour
  // characters of compound flags weirdly). Sized slightly larger than the
  // title text so it reads as a leading bullet, matching the mockup.
  const iconHtml = icon
    ? `<span style="font-size:14px;letter-spacing:0;margin-right:8px;vertical-align:-2px;">${icon}</span>`
    : '';
  return `
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:${COLORS.text2};margin-bottom:14px;font-family:Arial,Helvetica,sans-serif;">
      ${iconHtml}${escapeHtml(title)}${sub ? ` <span style="font-size:10px;font-weight:400;color:${COLORS.text3};text-transform:none;letter-spacing:0.02em;margin-left:6px;">${escapeHtml(sub)}</span>` : ''}
    </div>`;
}

export function renderSnapshotHTML(data: SnapshotData): string {
  const baseUrl = getDashboardBaseUrl();
  const dashboardLink = baseUrl ? `${baseUrl}/dashboard` : '/dashboard';

  const baselineNote = data.hasFullBaseline
    ? 'All comparisons vs 7-day average'
    : `Limited baseline (${data.baselineDays} days requested, history starts 2026-04-27)`;

  // Glance Top: 5 columns. We use a fixed 5-col table so Outlook's table
  // layout doesn't shrink the last cell; gaps come from cellspacing.
  const glanceTopCells = data.glanceTop.map((t) => tile(t, '20%')).join('');
  const glanceBottomCells = data.glanceBottom.map((t) => tile(t, '50%')).join('');

  const issueRowsHtml = data.topIssues.map(issueRowHtml).join('');
  const moverRowsHtml = data.topMovers.map(issueRowHtml).join('');
  const brandRowsHtml = data.brands.map(breakdownRowHtml).join('');
  const langRowsHtml  = data.languages.map(breakdownRowHtml).join('');
  const agentRowsHtml = data.agents.map(agentRowHtml).join('');
  const issuesBreakdownRowsHtml = data.issuesBreakdown.map(issueRowHtml).join('');

  // Resolution rows — laid out as a mini table similar to language/brand but
  // without the deep-link (resolution_status drill is supported by the overlay
  // but adds little value over scanning the row).
  const resolutionRowsHtml = data.resolutions.map((r) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid ${COLORS.border};font-family:Arial,Helvetica,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-size:13px;color:${COLORS.text2};">${escapeHtml(r.label)}</td>
            <td align="right" style="font-size:13px;color:${COLORS.text1};font-weight:500;white-space:nowrap;">${r.count} (${r.pct}%) <span style="margin-left:6px;">${pillHtml(r.delta)}</span></td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  // Severity rows beneath the bar
  const severityRowsHtml = data.severities.map((s) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid ${COLORS.border};font-family:Arial,Helvetica,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-size:13px;color:${COLORS.text2};">${escapeHtml(`L${s.level} ${labelForSeverity(s.level)}`)}</td>
            <td align="right" style="font-size:13px;color:${COLORS.text1};font-weight:500;white-space:nowrap;">${s.count} <span style="margin-left:6px;">${pillHtml(s.delta)}</span></td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Daily Snapshot · ${escapeHtml(data.targetDateISO)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bgOuter};">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.bgOuter};padding:32px 12px;">
  <tr><td align="center">
    <table cellpadding="0" cellspacing="0" border="0" width="800" style="max-width:800px;background:${COLORS.bgCard};border:1px solid ${COLORS.border};border-radius:12px;">

      <!-- HEADER -->
      <!-- background-color is the solid fallback (matches the rest of the
           card); background-image layers a radial blue glow at the top-left
           per the mockup. Outlook desktop strips the gradient and falls
           back to the solid color, which is fine. -->
      <tr><td style="padding:32px 36px 24px;background-color:${COLORS.bgCard};background-image:radial-gradient(ellipse 60% 100% at 0% 0%, rgba(99,102,241,0.18), transparent 60%);font-family:Arial,Helvetica,sans-serif;">
        <div style="font-size:22px;font-weight:600;color:${COLORS.text1};letter-spacing:-0.02em;">QA Daily Snapshot</div>
        <div style="font-size:13px;color:${COLORS.text2};margin-top:6px;">${escapeHtml(data.targetDateLabel)} · Yesterday's data</div>
        <div style="margin-top:12px;"><span style="display:inline-block;font-size:11px;font-weight:500;color:#60a5fa;background:#1a2540;padding:4px 10px;border-radius:999px;border:1px solid #2a3960;letter-spacing:0.02em;">${escapeHtml(baselineNote)}</span></div>
      </td></tr>

      <!-- HEADER GLOW LINE -->
      <!-- 1px row that replaces the header's bottom border with a glowing
           blue gradient. background-color falls back to the standard border
           color in clients that strip linear-gradient. The &nbsp; gives the
           cell content so the row reliably renders at 1px in all clients. -->
      <tr><td style="padding:0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="36" style="line-height:1px;font-size:1px;">&nbsp;</td>
            <td style="height:1px;line-height:1px;font-size:1px;background-color:${COLORS.border};background-image:linear-gradient(90deg, transparent 0%, rgba(99,102,241,0.55) 50%, transparent 100%);">&nbsp;</td>
            <td width="36" style="line-height:1px;font-size:1px;">&nbsp;</td>
          </tr>
        </table>
      </td></tr>

      <!-- GLANCE -->
      <tr><td style="padding:24px 36px;border-bottom:1px solid ${COLORS.border};">
        ${sectionHeader('Yesterday at a Glance', undefined, '📊')}
        <table width="100%" cellpadding="0" cellspacing="6" border="0" style="border-collapse:separate;"><tr>${glanceTopCells}</tr></table>
        <table width="100%" cellpadding="0" cellspacing="6" border="0" style="border-collapse:separate;margin-top:0;"><tr>${glanceBottomCells}</tr></table>
      </td></tr>

      <!-- TOP 5 ISSUES -->
      <tr><td style="padding:24px 36px;border-bottom:1px solid ${COLORS.border};">
        ${sectionHeader('Top 5 Issues Yesterday', 'vs 7-day average', '🔥')}
        <table width="100%" cellpadding="0" cellspacing="6" border="0" style="border-collapse:separate;">
          ${issueRowsHtml || `<tr><td style="padding:12px 16px;font-size:13px;color:${COLORS.text3};font-family:Arial,Helvetica,sans-serif;">No analyzed issues yesterday.</td></tr>`}
        </table>
      </td></tr>

      <!-- TOP 5 MOVERS -->
      <tr><td style="padding:24px 36px;border-bottom:1px solid ${COLORS.border};">
        ${sectionHeader('Top 5 Movers', 'biggest difference vs 7-day average · excludes Top 5 Issues', '📈')}
        <table width="100%" cellpadding="0" cellspacing="6" border="0" style="border-collapse:separate;">
          ${moverRowsHtml || `<tr><td style="padding:12px 16px;font-size:13px;color:${COLORS.text3};font-family:Arial,Helvetica,sans-serif;">No movers above the volume threshold.</td></tr>`}
        </table>
      </td></tr>

      <!-- RESOLUTION + SEVERITY -->
      <tr><td style="padding:24px 36px;border-bottom:1px solid ${COLORS.border};">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="50%" valign="top" style="padding-right:14px;">
              ${sectionHeader('Resolution Status', undefined, '✅')}
              <table width="100%" cellpadding="0" cellspacing="0" border="0">${resolutionRowsHtml}</table>
            </td>
            <td width="50%" valign="top" style="padding-left:14px;">
              ${sectionHeader('Severity Breakdown', undefined, '⚠️')}
              ${severityBarHtml(data.severities)}
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">${severityRowsHtml}</table>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- VOLUME PER BRAND -->
      <tr><td style="padding:24px 36px;border-bottom:1px solid ${COLORS.border};">
        ${sectionHeader('Volume per Brand', 'vs 7-day average', '🏷️')}
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          ${brandRowsHtml || `<tr><td style="padding:12px 0;font-size:13px;color:${COLORS.text3};font-family:Arial,Helvetica,sans-serif;">No brand data.</td></tr>`}
        </table>
      </td></tr>

      <!-- VOLUME PER LANGUAGE -->
      <tr><td style="padding:24px 36px;border-bottom:1px solid ${COLORS.border};">
        ${sectionHeader('Volume per Language', 'vs 7-day average', '🌐')}
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          ${langRowsHtml || `<tr><td style="padding:12px 0;font-size:13px;color:${COLORS.text3};font-family:Arial,Helvetica,sans-serif;">No language data.</td></tr>`}
        </table>
      </td></tr>

      <!-- AGENT VOLUME -->
      <tr><td style="padding:24px 36px;border-bottom:1px solid ${COLORS.border};">
        ${sectionHeader('Agent Volume', 'vs 7-day average', '👥')}
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.bgTile};border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;table-layout:fixed;">
          <tr>
            <td width="40" style="padding:10px 14px;background:${COLORS.bgCard};color:${COLORS.text3};font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;border-bottom:1px solid ${COLORS.border};">#</td>
            <td style="padding:10px 14px;background:${COLORS.bgCard};color:${COLORS.text3};font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;border-bottom:1px solid ${COLORS.border};">Agent</td>
            <td align="right" width="80" style="padding:10px 14px;background:${COLORS.bgCard};color:${COLORS.text3};font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;border-bottom:1px solid ${COLORS.border};">Yesterday</td>
            <td align="right" width="120" style="padding:10px 14px;background:${COLORS.bgCard};color:${COLORS.text3};font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;border-bottom:1px solid ${COLORS.border};">vs 7d avg</td>
          </tr>
          ${agentRowsHtml || `<tr><td colspan="4" style="padding:12px 14px;font-size:13px;color:${COLORS.text3};">No agent data.</td></tr>`}
        </table>
      </td></tr>

      <!-- ISSUES BREAKDOWN -->
      <tr><td style="padding:24px 36px;">
        ${sectionHeader('Issues Breakdown', 'full ordered list of yesterday\'s issues · vs 7-day average', '📋')}
        <table width="100%" cellpadding="0" cellspacing="6" border="0" style="border-collapse:separate;">
          ${issuesBreakdownRowsHtml || `<tr><td style="padding:12px 16px;font-size:13px;color:${COLORS.text3};font-family:Arial,Helvetica,sans-serif;">No analyzed issues yesterday.</td></tr>`}
        </table>
      </td></tr>

      <!-- FOOTER -->
      <tr><td style="padding:18px 36px;background:${COLORS.bgOuter};border-top:1px solid ${COLORS.border};font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${COLORS.text3};text-align:center;">
        Roosterpartners QA · Generated 07:00 UTC · Data scope: 00:00–23:59 UTC ${escapeHtml(data.targetDateISO)} · <a href="${escapeHtml(dashboardLink)}" style="color:${COLORS.link};text-decoration:none;">Open dashboard</a>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function labelForSeverity(level: 0 | 1 | 2 | 3): string {
  switch (level) {
    case 0: return '(none)';
    case 1: return '(mild)';
    case 2: return '(notable)';
    case 3: return '(severe)';
  }
}

export function renderSnapshotSubject(data: SnapshotData): string {
  return `QA Daily Snapshot · ${data.targetDateISO} · ${data.totals.conversations} convos, ${data.totals.escalations} escalations`;
}
