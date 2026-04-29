// Asana integration — pushes a ticket into the configured Asana project when
// the AI flags a conversation with dissatisfaction severity Level 3. Called
// from lib/analyze-sync.ts after a successful analysis. Failures are logged
// and swallowed so a flaky Asana API never breaks the analysis pipeline.
//
// Routing: each ticket lands in the project section (board column) whose name
// matches the conversation's agent_name. Matching is case-insensitive exact
// first, then first-word (so "Becka VIP" still matches a column named "Becka").
// If no column matches, a new column named after the agent is auto-created
// and the ticket lands there. If creation itself fails (rate limit, perms),
// ASANA_SECTION_GID is used as a last-resort fallback; otherwise the ticket
// goes to the project default.
//
// Required env:
//   ASANA_ACCESS_TOKEN           Service-account Personal Access Token
//   ASANA_PROJECT_GID            Destination project GID (e.g. 1214387668872283)
// Optional env:
//   ASANA_SECTION_GID            Fallback section GID for tickets whose agent
//                                doesn't match any board column
//   NEXT_PUBLIC_APP_URL          Base URL used for the QA-tool back-link
//   NEXT_PUBLIC_INTERCOM_APP_ID  Used for the Intercom inbox back-link
//
// Required Supabase migration (run once in the dashboard):
//
//   ALTER TABLE conversations ADD COLUMN IF NOT EXISTS asana_task_gid TEXT;
//   CREATE INDEX IF NOT EXISTS conversations_asana_task_gid_idx
//     ON conversations (asana_task_gid)
//     WHERE asana_task_gid IS NOT NULL;

const ASANA_API = 'https://app.asana.com/api/1.0';

// In-memory cache of the project's section list — lowercased section name → gid.
// Refreshed every SECTIONS_TTL_MS so newly-added agent columns get picked up
// without a redeploy. Stale on cold start (serverless), which is fine.
const SECTIONS_TTL_MS = 10 * 60 * 1000;
let sectionsCache: { fetchedAt: number; map: Map<string, string> } | null = null;

// In-flight section creation promises keyed by lowercased agent name.
// Prevents two concurrent severity-3 analyses for the same new agent from
// racing and creating two duplicate columns within the same invocation.
const sectionCreatesInFlight = new Map<string, Promise<string | null>>();

export function isAsanaConfigured(): boolean {
  return !!(process.env.ASANA_ACCESS_TOKEN && process.env.ASANA_PROJECT_GID);
}

async function getProjectSections(): Promise<Map<string, string>> {
  if (sectionsCache && Date.now() - sectionsCache.fetchedAt < SECTIONS_TTL_MS) {
    return sectionsCache.map;
  }
  if (!isAsanaConfigured()) return new Map();

  const token = process.env.ASANA_ACCESS_TOKEN!;
  const projectGid = process.env.ASANA_PROJECT_GID!;

  try {
    const res = await fetch(`${ASANA_API}/projects/${projectGid}/sections`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[asana] list sections failed (${res.status}): ${body.slice(0, 300)}`);
      // Reuse stale cache rather than returning empty — better than mis-routing.
      return sectionsCache?.map ?? new Map();
    }
    const json = await res.json();
    const map = new Map<string, string>();
    for (const s of (json?.data ?? []) as Array<{ gid?: string; name?: string }>) {
      if (s?.gid && typeof s?.name === 'string') {
        map.set(s.name.trim().toLowerCase(), s.gid);
      }
    }
    sectionsCache = { fetchedAt: Date.now(), map };
    return map;
  } catch (e) {
    console.error('[asana] list sections exception:', (e as Error).message);
    return sectionsCache?.map ?? new Map();
  }
}

// Resolves an agent name to a section gid using exact-match then first-word.
// Returns null when no column matches — the caller decides the fallback.
async function resolveSectionForAgent(agentName: string | null): Promise<string | null> {
  if (!agentName) return null;
  const sections = await getProjectSections();
  if (sections.size === 0) return null;

  const normalized = agentName.trim().toLowerCase();
  const exact = sections.get(normalized);
  if (exact) return exact;

  const firstWord = normalized.split(/\s+/)[0];
  if (firstWord && firstWord !== normalized) {
    const fw = sections.get(firstWord);
    if (fw) return fw;
  }
  return null;
}

// Resolves an agent's section gid; creates the section if it doesn't exist.
// Refreshes the cache once on miss to catch sections created by another
// invocation, then deduplicates concurrent creates within this invocation
// via sectionCreatesInFlight so we don't make two columns named "Allen".
async function ensureSectionForAgent(agentName: string | null): Promise<string | null> {
  if (!agentName) return null;
  const trimmed = agentName.trim();
  if (!trimmed) return null;

  const existing = await resolveSectionForAgent(trimmed);
  if (existing) return existing;

  const key = trimmed.toLowerCase();
  const inFlight = sectionCreatesInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    // Force a cache refresh in case a parallel cron tick or another serverless
    // instance just created this section for the same agent.
    sectionsCache = null;
    const afterRefresh = await resolveSectionForAgent(trimmed);
    if (afterRefresh) return afterRefresh;
    return createSectionForAgent(trimmed);
  })().finally(() => {
    sectionCreatesInFlight.delete(key);
  });

  sectionCreatesInFlight.set(key, promise);
  return promise;
}

async function createSectionForAgent(name: string): Promise<string | null> {
  if (!isAsanaConfigured()) return null;
  const token = process.env.ASANA_ACCESS_TOKEN!;
  const projectGid = process.env.ASANA_PROJECT_GID!;

  try {
    const res = await fetch(`${ASANA_API}/projects/${projectGid}/sections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: { name } }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[asana] create section "${name}" failed (${res.status}): ${body.slice(0, 300)}`);
      return null;
    }
    const json = await res.json();
    const gid: string | undefined = json?.data?.gid;
    if (!gid) return null;

    // Backfill the cache so the next ticket for this agent hits without a network round trip.
    if (sectionsCache) {
      sectionsCache.map.set(name.toLowerCase(), gid);
    } else {
      sectionsCache = { fetchedAt: Date.now(), map: new Map([[name.toLowerCase(), gid]]) };
    }
    console.log(`[asana] auto-created section "${name}" (gid=${gid})`);
    return gid;
  } catch (e) {
    console.error('[asana] create section exception:', (e as Error).message);
    return null;
  }
}

export interface AsanaTaskInput {
  conversationId: string;
  intercomId: string | null;
  playerName: string | null;
  playerEmail: string | null;
  agentName: string | null;
  agentEmail: string | null;
  brand: string | null;
  severity: string;             // e.g. "Level 3"
  resolutionStatus: string | null;
  issueCategories: string[];    // collected from results[]
  summaryText: string;          // raw AI JSON / rendered summary
}

function buildTaskName(input: AsanaTaskInput): string {
  const who = input.playerName ?? 'Unknown player';
  const brand = input.brand ? ` · ${input.brand}` : '';
  const cat = input.issueCategories[0] ? ` — ${input.issueCategories[0]}` : '';
  const sevDigit = input.severity.match(/\d/)?.[0] ?? '?';
  // Asana caps task names at 1024 chars but anything past ~250 wraps badly in
  // list views — trim defensively.
  return `[Sev ${sevDigit}] ${who}${brand}${cat}`.slice(0, 250);
}

function buildTaskNotes(input: AsanaTaskInput): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const intercomAppId = process.env.NEXT_PUBLIC_INTERCOM_APP_ID ?? '';

  const lines: string[] = [];
  lines.push(`Severity: ${input.severity}`);
  if (input.resolutionStatus) lines.push(`Resolution: ${input.resolutionStatus}`);
  if (input.issueCategories.length > 0) {
    lines.push(`Categories: ${input.issueCategories.join(', ')}`);
  }
  lines.push('');
  lines.push(
    `Agent: ${input.agentName ?? 'Unknown'}${input.agentEmail ? ` <${input.agentEmail}>` : ''}`,
  );
  lines.push(
    `Player: ${input.playerName ?? 'Unknown'}${input.playerEmail ? ` <${input.playerEmail}>` : ''}`,
  );
  if (input.brand) lines.push(`Brand: ${input.brand}`);
  lines.push('');
  if (appUrl) {
    lines.push(`QA Tool: ${appUrl}/conversations/${input.conversationId}`);
  }
  if (input.intercomId && intercomAppId) {
    lines.push(
      `Intercom: https://app.intercom.com/a/apps/${intercomAppId}/conversations/${input.intercomId}`,
    );
  }
  lines.push('');
  lines.push('--- AI Analysis ---');
  lines.push(input.summaryText);
  return lines.join('\n');
}

export async function createAsanaTaskForConversation(
  input: AsanaTaskInput,
): Promise<string | null> {
  if (!isAsanaConfigured()) return null;

  const token = process.env.ASANA_ACCESS_TOKEN!;
  const projectGid = process.env.ASANA_PROJECT_GID!;

  // Per-ticket routing: find or auto-create the column matching the agent.
  // ASANA_SECTION_GID is only used as a last-resort fallback when ensure
  // fails (rate limit / perms / no agent name).
  const ensuredSection = await ensureSectionForAgent(input.agentName);
  const sectionGid = ensuredSection ?? process.env.ASANA_SECTION_GID ?? null;
  if (!ensuredSection && input.agentName) {
    console.warn(`[asana] could not ensure section for agent: ${input.agentName}`);
  }

  const payload = {
    data: {
      name: buildTaskName(input),
      notes: buildTaskNotes(input),
      projects: [projectGid],
      ...(sectionGid
        ? { memberships: [{ project: projectGid, section: sectionGid }] }
        : {}),
    },
  };

  try {
    const res = await fetch(`${ASANA_API}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[asana] create task failed (${res.status}): ${body.slice(0, 300)}`);
      return null;
    }

    const json = await res.json();
    const gid: string | undefined = json?.data?.gid;
    return gid ?? null;
  } catch (e) {
    console.error('[asana] create task exception:', (e as Error).message);
    return null;
  }
}
