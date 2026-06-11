import { supabase } from '@/lib/supabase';
import { GROUP_TO_AM } from '@/lib/utils';
import { fetchOpenProjectTasks } from '@/lib/asana';

// Built once at module load from GROUP_TO_AM so both maps stay in sync with
// the routing matrix automatically:
//   AM_PORTFOLIO — descriptor shown in parens after the AM name (e.g.
//     "Niklas (Christian NON-VIP)") to disambiguate cross-segment routing.
//   AM_SEGMENT   — classification used to group rows in the snapshot so VIP
//     AMs come first, then NON-VIP, then OTHER (SoftSwiss/Unassigned). AMs
//     that handle both halves of a base (e.g. Nik covers VIP+NON-VIP Ada)
//     land in VIP since "any VIP responsibility → VIP block".
type AmSegment = 'VIP' | 'NON-VIP' | 'OTHER';
const { AM_PORTFOLIO, AM_SEGMENT } = (() => {
  const groupsByAm = new Map<string, string[]>();
  for (const [group, am] of Object.entries(GROUP_TO_AM)) {
    const list = groupsByAm.get(am) ?? [];
    list.push(group);
    groupsByAm.set(am, list);
  }
  const portfolio: Record<string, string> = {};
  const segment:   Record<string, AmSegment> = {};
  for (const [am, groups] of groupsByAm) {
    const bases     = new Set(groups.map((g) => g.replace(/^(non-)?vip_/, '')));
    const hasVip    = groups.some((g) => g.startsWith('vip_'));
    const hasNonVip = groups.some((g) => g.startsWith('non-vip_'));

    // Portfolio descriptor
    if (bases.size !== 1) {
      portfolio[am] = [...bases].map(capitalise).join(', ');
    } else {
      const baseDisplay = capitalise([...bases][0]);
      if (hasVip && hasNonVip)      portfolio[am] = baseDisplay;             // Nik → "Ada"
      else if (hasVip)              portfolio[am] = `${baseDisplay} VIP`;    // Christian → "Christian VIP"
      else if (hasNonVip)           portfolio[am] = `${baseDisplay} NON-VIP`;// Niklas → "Christian NON-VIP"
      else                          portfolio[am] = baseDisplay;             // SoftSwiss
    }

    // Segment classification
    if (hasVip)        segment[am] = 'VIP';
    else if (hasNonVip) segment[am] = 'NON-VIP';
    else                segment[am] = 'OTHER';
  }
  return { AM_PORTFOLIO: portfolio, AM_SEGMENT: segment };
})();

const SEGMENT_ORDER: Record<AmSegment, number> = { 'VIP': 0, 'NON-VIP': 1, 'OTHER': 2 };

function capitalise(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

// Returns the parenthetical to show after the AM name, or null when redundant
// (SoftSwiss, Unassigned, exact duplicates). Trims the leading "<am> " from
// the descriptor so "Christian (Christian VIP)" collapses to "Christian (VIP)".
function descriptorForAm(am: string): string | null {
  const desc = AM_PORTFOLIO[am];
  if (!desc) return null;
  if (desc.toLowerCase() === am.toLowerCase()) return null;
  const prefix = `${am} `;
  if (desc.toLowerCase().startsWith(prefix.toLowerCase())) {
    return desc.slice(prefix.length);
  }
  return desc;
}

// Builds and posts the "Pending Action Cases Snapshot" the cron sends to
// Telegram. "Pending" = open on the Asana board right now.
//
// Source of truth is the live Asana board, NOT the asana_completed_at column.
// We pull the project's open (incomplete) tasks straight from Asana and group
// each by the section (board column) it physically sits in, so every row
// matches the column an AM sees on the board 1:1. Management reads this Telegram
// post instead of opening Asana, so it has to agree with the board exactly.
//
// Two earlier mismatches this design removes:
//   - Inflation: reading asana_completed_at meant any completion the */15 sync
//     hadn't written back still counted as pending (108 posted vs ~34 on the
//     board). Asking Asana directly can't go stale.
//   - Per-AM scatter: the old code re-derived the AM live from the player's
//     current Intercom groups, so a player who changed segment landed under a
//     different name than the column the ticket was created in. Grouping by the
//     actual section fixes that.
//
// Age still uses intercom_created_at (looked up from the DB by gid) rather than
// analyzed_at: analyzed_at gets re-stamped on every re-analysis (e.g. the gpt-4o
// sweeps), which would reset open tickets to "<24h"; intercom_created_at is
// stable and biases slightly old, which is the safe direction for an SLA view.

const DAY_MS = 24 * 60 * 60 * 1000;

export type AmCounts = { under24: number; over24: number };

export type Snapshot = {
  total: number;
  byAm: Map<string, AmCounts>;
  message: string;
};

export async function buildPendingSnapshot(now: Date = new Date()): Promise<Snapshot> {
  // 1. The board truth: which tasks are open right now, and in which column.
  const openTasks = await fetchOpenProjectTasks();

  // 2. Look up intercom_created_at for those gids (for the <24h / >24h split).
  const gids = openTasks.map((t) => t.gid);
  const createdByGid = await fetchCreatedAtByGid(gids);

  // 3. Group by section name (= board column = AM); bucket by age. A task with
  //    no section in our project, or a section we don't recognise, lands under
  //    "Unassigned" so the total still equals the board total.
  const nowMs = now.getTime();
  const byAm = new Map<string, AmCounts>();
  for (const t of openTasks) {
    const am = t.section?.trim() || 'Unassigned';
    const created = createdByGid.get(t.gid) ?? null;
    const ageMs = created ? nowMs - new Date(created).getTime() : Infinity;
    const bucket = byAm.get(am) ?? { under24: 0, over24: 0 };
    if (ageMs < DAY_MS) bucket.under24 += 1;
    else                bucket.over24  += 1;
    byAm.set(am, bucket);
  }

  return { total: openTasks.length, byAm, message: formatSnapshot(byAm, openTasks.length, now) };
}

// Returns gid → intercom_created_at for the given Asana task gids. Chunked IN
// query so a large open set can't blow the URL/param limit. Tickets always
// originate from a conversation, so a gid normally resolves; one that doesn't
// just gets no age (→ >24h bucket) and is still counted.
async function fetchCreatedAtByGid(gids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const CHUNK = 200;
  for (let i = 0; i < gids.length; i += CHUNK) {
    const slice = gids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('conversations')
      .select('asana_task_gid, intercom_created_at')
      .in('asana_task_gid', slice);
    if (error) throw new Error(`[telegram-snapshot] ${error.message}`);
    for (const r of (data ?? []) as Array<{ asana_task_gid: string | null; intercom_created_at: string | null }>) {
      if (r.asana_task_gid) out.set(r.asana_task_gid, r.intercom_created_at);
    }
  }
  return out;
}

function formatSnapshot(byAm: Map<string, AmCounts>, total: number, now: Date): string {
  const hh = now.getUTCHours().toString().padStart(2, '0');
  const mm = now.getUTCMinutes().toString().padStart(2, '0');
  const TOP = '▔'.repeat(20);
  const BOT = '▁'.repeat(20);

  let totalUnder24 = 0;
  let totalOver24  = 0;
  for (const c of byAm.values()) {
    totalUnder24 += c.under24;
    totalOver24  += c.over24;
  }

  const lines: string[] = [];
  lines.push(`📊 Pending Action Cases Snapshot | 🕒 ${hh}:${mm} UTC`);
  lines.push(TOP);
  lines.push(`Total Pending: ${total}`);
  lines.push(`Total Pending 🟢<24h: ${totalUnder24}`);
  lines.push(`Total Pending 🔴>24h: ${totalOver24}`);
  lines.push(BOT);
  lines.push('');

  // Sort: VIP block → NON-VIP block → OTHER (SoftSwiss / Unassigned), then
  // alphabetical by AM name within each block. AMs not in our routing map
  // (e.g. legacy values, "Unassigned") land in OTHER.
  const sorted = [...byAm.entries()].sort((a, b) => {
    const sa = SEGMENT_ORDER[AM_SEGMENT[a[0]] ?? 'OTHER'];
    const sb = SEGMENT_ORDER[AM_SEGMENT[b[0]] ?? 'OTHER'];
    if (sa !== sb) return sa - sb;
    return a[0].localeCompare(b[0]);
  });

  if (sorted.length === 0) {
    lines.push('No pending cases — nothing on the board right now.');
  } else {
    for (const [am, c] of sorted) {
      const subTotal = c.under24 + c.over24;
      const totalStr = String(subTotal);
      const desc = descriptorForAm(am);
      const namePart = desc ? `${am} (${desc})` : am;
      // Visual padding: dashes fill the gap so the count sits at a roughly
      // consistent column. Telegram renders in a proportional font so this
      // won't be pixel-aligned, but it keeps the rows tidy. Floor bumped to
      // 30 chars to accommodate longer "<am> (<portfolio>)" labels.
      const dashes = '—'.repeat(Math.max(3, 30 - namePart.length - totalStr.length));
      lines.push(`👤 ${namePart} ${dashes} ${subTotal}`);
      lines.push(`   🟢 ${c.under24} pending <24h  |  🔴 ${c.over24} pending >24h`);
      lines.push('');
    }
  }

  lines.push(BOT);
  lines.push('🔄 Live from the Asana board');
  return lines.join('\n');
}

export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage ${res.status}: ${body}`);
  }
}
