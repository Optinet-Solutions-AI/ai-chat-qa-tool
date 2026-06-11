import {
  dbListAllAsanaTickets,
  dbBatchUpdateAsanaStatus,
} from '@/lib/db';
import { fetchOpenProjectTasks, fetchTasksCompletion } from '@/lib/asana';

// Shared body for both /api/cron/sync-asana-statuses and the admin manual
// trigger, so the two can't drift. Reconciles each ticketed conversation's
// asana_completed_at / asana_task_deleted_at against the live Asana board.
//
// Strategy (bounded, history-independent):
//   1. Pull the project's OPEN (incomplete) task gids — fetchOpenProjectTasks
//      uses completed_since=now, so this set stays small no matter how many
//      tasks were completed over the project's lifetime. This is what stops the
//      sweep from slowly outgrowing the cron timeout and silently dying.
//   2. A DB ticket whose gid is still open: ensure it isn't marked completed
//      (clears the flag if a task was reopened in Asana).
//   3. A DB ticket whose gid left the open set AND was still open in the DB is
//      a fresh close — we classify just those via per-task GETs (completed vs
//      deleted). Tickets already marked completed are left alone.
//
// Writes are idempotent and chunked, so a partial run self-heals next tick.

// Cap on how many fresh closes we classify per run. Steady state this is a
// handful; the only time it's large is the first run after deploy clearing a
// backlog, which still fits comfortably. Anything beyond the cap is deferred to
// the next tick (logged, not dropped).
const CLASSIFY_CAP = 500;

export interface AsanaSyncResult {
  total: number;      // ticketed conversations considered
  open: number;       // tasks open on the board right now
  reopened: number;   // were completed in DB, now open again on the board
  completed: number;  // newly marked completed
  deleted: number;    // gid no longer exists in Asana
  deferred: number;   // fresh closes beyond CLASSIFY_CAP, left for next tick
  failed: number;     // row updates that errored (retried next tick)
}

export async function reconcileAsanaStatuses(): Promise<AsanaSyncResult> {
  const tickets = await dbListAllAsanaTickets();
  if (tickets.length === 0) {
    return { total: 0, open: 0, reopened: 0, completed: 0, deleted: 0, deferred: 0, failed: 0 };
  }

  const openTasks = await fetchOpenProjectTasks();
  const openSet = new Set(openTasks.map((t) => t.gid));

  const updates: Array<{ id: string; completedAt?: string | null; deletedAt?: string | null }> = [];
  const freshCloses: Array<{ id: string; gid: string }> = [];
  let reopened = 0;

  for (const t of tickets) {
    if (openSet.has(t.asana_task_gid)) {
      // Open on the board. If we had it marked completed, it was reopened.
      if (t.completedAt != null) {
        updates.push({ id: t.id, completedAt: null });
        reopened += 1;
      }
      continue;
    }
    // Not in the open set. Only the ones still open in our DB are fresh closes
    // worth classifying; ones already completed stay as they are.
    if (t.completedAt == null) {
      freshCloses.push({ id: t.id, gid: t.asana_task_gid });
    }
  }

  const toClassify = freshCloses.slice(0, CLASSIFY_CAP);
  const deferred = freshCloses.length - toClassify.length;

  const now = new Date().toISOString();
  let completed = 0;
  let deleted = 0;
  if (toClassify.length > 0) {
    const statuses = await fetchTasksCompletion(toClassify.map((c) => c.gid));
    for (const c of toClassify) {
      const s = statuses.get(c.gid);
      if (!s) continue; // no verdict this run (e.g. transient) — retry next tick
      if (!s.exists) {
        updates.push({ id: c.id, deletedAt: now });
        deleted += 1;
      } else if (s.completed) {
        updates.push({ id: c.id, completedAt: s.completed_at ?? now });
        completed += 1;
      }
      // exists && !completed: open in Asana but not in our project's open
      // board (moved out, or a transient sweep miss). Leave it untouched rather
      // than risk permanently hiding a still-open ticket.
    }
  }

  const { failed } = await dbBatchUpdateAsanaStatus(updates);

  const result: AsanaSyncResult = {
    total: tickets.length,
    open: openSet.size,
    reopened,
    completed,
    deleted,
    deferred,
    failed,
  };

  console.log(
    `[asana-sync] total=${result.total} open=${result.open} reopened=${reopened} ` +
      `completed=${completed} deleted=${deleted} deferred=${deferred} failed=${failed}`,
  );
  return result;
}
