// Escalation rule table — decides whether an analysed conversation should be
// pushed into Asana for the responsible Account Manager.
//
// Source of truth: "Player Dissatisfaction (Severity x Resolution Status x
// Player Type)" spreadsheet (see docs/Escalations - Player Dissatisfaction -
// Severity x Resolution Status x Player Type.pdf, captured 2026-05-07). The
// matrix is keyed on (issue, severity, resolution_status, segment):
//
//   Severity ∈ {0, 1, 2, 3} — note severity 2 and 3 use identical rules.
//   Resolution ∈ {Resolved, Partially Resolved, Unresolved}.
//   Segment ∈ {SoftSwiss, NON-VIP, VIP}; SoftSwiss never escalates.
//
// Rather than store 12 cells per issue we group issues into seven patterns:
//
//   Pattern A — Account Closure & Self-Exclusion. NON-VIP and VIP escalate
//               in every (severity, resolution) cell.
//   Pattern B — Payments + Winnings Decision Disputes. NON-VIP and VIP
//               escalate everywhere except the (sev 0, Resolved) cell. At
//               (sev 1, Resolved) only VIP escalates.
//   Pattern C — Withdrawal Delays / Rejections + Unclear Verification + all
//               of Bonus Codes & Promotions + all of Sportsbook. VIP escalates
//               from sev 0 (PR/UR) onward; NON-VIP escalates from sev 1
//               (PR/UR) onward.
//   Pattern D — Player Experience strict (most of cat 4). VIP same as C,
//               NON-VIP escalates from sev 1 (Resolved) onward.
//   Pattern E — Lack of VIP Attention / Reopen Delays / Scam Accusations.
//               NON-VIP and VIP both escalate from sev 0 (PR/UR) onward.
//   Pattern F — KYC Document Rejections / Repeated Document Requests. VIP
//               always escalates; NON-VIP escalates from sev 1 (PR/UR) onward.
//   Pattern G — Technical issues (cat 7). VIP escalates from sev 0 (PR/UR)
//               onward EXCEPT (sev 1, Resolved); NON-VIP escalates from sev 2.
//
// SoftSwiss → never escalate (any severity, any resolution, any issue).
//
// Severity-2/3 fast path: every cell in the matrix is YES for both VIP and
// NON-VIP at severity ≥ 2, so we short-circuit the per-issue lookup. This
// also means a sev-3 finding without a recognised issue still escalates by
// segment alone — the same conservative behaviour as the previous matrix.
// Severity 0/1 with no recognised issue cannot be matrix-checked so it does
// NOT escalate; this errs on the side of fewer false-positives to AMs.
//
// Resolution status: nulls are treated as "Unresolved" (the most permissive
// cell, matching the dashboard's "Unknown → Unresolved" rollup).

import type { Segment } from './utils';
import { categoryNumPrefix, normalizeCategoryLabel, normalizeIssueLabel } from './analyticsFilters';

export type SeverityLevel = 0 | 1 | 2 | 3;
export type ResolutionStatus = 'Resolved' | 'Partially Resolved' | 'Unresolved';

export interface EscalationDecision {
  escalate: boolean;
  reason: string;
}

// Each pattern is encoded as 9 cells laid out in row-major order:
//   index = effectiveSeverity * 3 + resolutionIndex
//   effectiveSeverity ∈ {0, 1, 2}  (sev 3 collapses to sev 2)
//   resolutionIndex   ∈ {0=Resolved, 1=Partially Resolved, 2=Unresolved}
// Cell value: 0 = neither segment escalates, 1 = VIP only, 2 = VIP + NON-VIP.
type Pattern = readonly [number, number, number, number, number, number, number, number, number];

const PATTERN_A: Pattern = [2, 2, 2,  2, 2, 2,  2, 2, 2] as const;
const PATTERN_B: Pattern = [0, 2, 2,  1, 2, 2,  2, 2, 2] as const;
const PATTERN_C: Pattern = [0, 1, 1,  1, 2, 2,  2, 2, 2] as const;
const PATTERN_D: Pattern = [0, 1, 1,  2, 2, 2,  2, 2, 2] as const;
const PATTERN_E: Pattern = [0, 2, 2,  2, 2, 2,  2, 2, 2] as const;
const PATTERN_F: Pattern = [1, 1, 1,  1, 2, 2,  2, 2, 2] as const;
const PATTERN_G: Pattern = [0, 1, 1,  0, 2, 2,  2, 2, 2] as const;

// Canonical issue labels grouped by pattern. Keys are normalised at module
// load via normalizeIssueLabel so AI variants ("1. Account Closure Requests",
// "Account Closure Request", trailing whitespace, etc.) all hit the same row.
const PATTERN_BY_ISSUE_RAW: Record<string, readonly string[]> = {
  A: [
    'Account Closure Requests',
    'Self-Exclusion Requests',
  ],
  B: [
    'Deposit Declines',
    'Payment Method Unavailabilities',
    'Pending Deposits',
    'Refund Requests',
    'Limit Requests',
    'Winnings Decision Disputes (Cut / Voided)',
  ],
  C: [
    'Withdrawal Delays',
    'Withdrawal Rejections / Missing Payouts',
    'Unclear Verification Requirements',
    'Bonuses Not Credited',
    'Bonus Codes Not Working',
    'Bonus / Promotion Conditions Unclear',
    'Bets Not Placed',
    'Incorrectly Settled Bets',
    'Odds Issues',
  ],
  D: [
    'Not Enough Bonuses or Cashback',
    'Competitor Comparison Dissatisfactions',
    'Proactive Offers Not Satisfactory',
    'Withdrawal Limit Dissatisfactions',
    'Limit Changes Not Applied',
    'Trust / Fairness Concerns',
    'Issues Not Resolved',
    'Slow Response Times',
    'Lack of Clear Communication',
    'Delayed Follow-Ups',
  ],
  E: [
    'Lack of VIP Attention',
    'Reopen Delays (24h Restriction)',
    'Scam Accusations',
  ],
  F: [
    'KYC Document Rejections',
    'Repeated Document Requests',
  ],
  G: [
    'Login Issues',
    'Password Reset Issues',
    'Session Timeouts / Auto Logouts',
    'Game Performance Issues',
    'Unfinished Rounds',
    'Incorrect Game Results',
    'Website Outages',
    'Broken Links',
    'Website Feature Malfunctions',
    'Hard-to-Find Features (UX Issues)',
    'Website / Platform Slow / Lagging',
  ],
};

const PATTERNS: Record<string, Pattern> = {
  A: PATTERN_A, B: PATTERN_B, C: PATTERN_C, D: PATTERN_D,
  E: PATTERN_E, F: PATTERN_F, G: PATTERN_G,
};

const ISSUE_PATTERN: Map<string, { pattern: Pattern; key: string }> = (() => {
  const out = new Map<string, { pattern: Pattern; key: string }>();
  for (const [key, items] of Object.entries(PATTERN_BY_ISSUE_RAW)) {
    const pattern = PATTERNS[key];
    for (const raw of items) {
      const norm = normalizeIssueLabel(raw);
      if (norm) out.set(norm, { pattern, key });
    }
  }
  return out;
})();

const RESOLUTION_INDEX: Record<ResolutionStatus, number> = {
  'Resolved':            0,
  'Partially Resolved':  1,
  'Unresolved':          2,
};

function patternEscalates(
  pattern: Pattern,
  severity: SeverityLevel,
  resolution: ResolutionStatus,
  segment: 'VIP' | 'NON-VIP',
): boolean {
  const sevIdx = severity >= 2 ? 2 : severity;
  const resIdx = RESOLUTION_INDEX[resolution];
  const cell = pattern[sevIdx * 3 + resIdx];
  if (cell === 0) return false;       // neither escalates
  if (cell === 2) return true;        // both escalate
  return segment === 'VIP';           // cell === 1: VIP only
}

export function evaluateEscalation(
  segment: Segment | null,
  severity: SeverityLevel | null,
  resolution: ResolutionStatus | null,
  issueItems: string[],
): EscalationDecision {
  if (segment === 'SoftSwiss') {
    return { escalate: false, reason: 'softswiss-never-escalates' };
  }
  if (segment !== 'VIP' && segment !== 'NON-VIP') {
    return { escalate: false, reason: `unknown-segment:${segment ?? 'null'}` };
  }
  if (severity == null) {
    return { escalate: false, reason: 'no-severity-detected' };
  }

  // Sev 2 and Sev 3 are identical and YES across every cell, so segment alone
  // decides — including the case where the AI didn't emit any issue label.
  if (severity >= 2) {
    return { escalate: true, reason: `${segment.toLowerCase()}-severity-${severity}` };
  }

  // Severity 0 or 1 — need at least one recognised issue to look up the matrix.
  const effectiveResolution: ResolutionStatus = resolution ?? 'Unresolved';

  let firstUnknown: string | null = null;
  for (const item of issueItems) {
    const norm = normalizeIssueLabel(item);
    if (!norm) continue;
    const entry = ISSUE_PATTERN.get(norm);
    if (!entry) {
      if (firstUnknown == null) firstUnknown = norm;
      continue;
    }
    if (patternEscalates(entry.pattern, severity, effectiveResolution, segment)) {
      return {
        escalate: true,
        reason:
          `${segment.toLowerCase()}-severity-${severity}-` +
          `${effectiveResolution.toLowerCase().replace(/\s+/g, '-')}-pattern-${entry.key}`,
      };
    }
  }

  if (firstUnknown && !issueItems.some((it) => ISSUE_PATTERN.has(normalizeIssueLabel(it)))) {
    return {
      escalate: false,
      reason: `severity-${severity}-no-recognised-issue:${firstUnknown}`,
    };
  }
  return {
    escalate: false,
    reason:
      `${segment.toLowerCase()}-severity-${severity}-` +
      `${effectiveResolution.toLowerCase().replace(/\s+/g, '-')}-no-pattern-escalates`,
  };
}

export function severityToNumber(s: string | number | null | undefined): SeverityLevel | null {
  if (s == null) return null;
  const m = String(s).match(/[0123]/);
  if (!m) return null;
  return parseInt(m[0], 10) as SeverityLevel;
}

export function normalizeResolution(s: string | null | undefined): ResolutionStatus | null {
  if (s == null) return null;
  const t = String(s).trim().toLowerCase();
  if (!t) return null;
  if (t === 'resolved') return 'Resolved';
  if (t === 'partially resolved' || t === 'partial' || t === 'partially') return 'Partially Resolved';
  if (t === 'unresolved' || t === 'unknown' || t === 'not resolved') return 'Unresolved';
  return null;
}

// Maps a list of AI-emitted category labels (e.g. "1. Account Closure & Self-
// Exclusion Requests", "Category 6: Bonus Codes...") to their numeric prefixes
// 1-8. Kept exported for the diagnostic /api/admin/test-escalation-rules
// endpoint; the gate itself no longer keys on category numbers.
export function extractCategoryNumbers(rawCategories: string[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const c of rawCategories) {
    const n = categoryNumPrefix(normalizeCategoryLabel(c));
    if (n != null && n >= 1 && n <= 8 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}
