-- analyzed_at indexes (2026-11-24, follow-up to disk_io_indexes.sql)
--
-- Why: two app queries still sort by analyzed_at with no index behind them.
-- Measured on 2026-11-24 15:20 UTC:
--   * Analysis History page (lib/db.ts loadAnalysisRuns): ORDER BY analyzed_at
--     DESC over all ~183k analysis_runs rows -> 57014 statement timeout on
--     every load.
--   * Dashboard "pending under/over 24h" counters (app/api/dashboard/route.ts):
--     open Asana tickets ORDER BY analyzed_at DESC -> 7.3s, right at the 8s
--     timeout, and it runs on every dashboard refresh.
-- Every timeout is logged as a Postgres error and burns Disk IO.
--
-- HOW TO RUN (Supabase dashboard -> SQL Editor), same as disk_io_indexes.sql:
--   * Open a NEW query tab for EACH statement, paste only that one statement,
--     and Run. CONCURRENTLY cannot run inside a transaction, and the editor
--     wraps a multi-statement run in one.
--   * IF NOT EXISTS makes each statement safe to re-run.
-- Nothing here changes data, RLS policies or table structure.

-- 1. Analysis History page.
create index concurrently if not exists analysis_runs_analyzed_at_idx
  on public.analysis_runs (analyzed_at desc);

-- 2. Dashboard pending-by-age counters. Partial: only open, live tickets.
create index concurrently if not exists conversations_open_asana_analyzed_at_idx
  on public.conversations (analyzed_at desc)
  where asana_task_gid is not null
    and asana_task_deleted_at is null
    and asana_completed_at is null;

-- 3. Open Asana tickets by id (added 2026-11-26). Serves the Asana sync's AM
--    re-derive pass (lib/db.ts dbListOpenTicketsForAmRederive), which every
--    15 min lists open tickets ORDER BY id. Through the live-ticket index it
--    had to read all ~16k ticketed rows to find the ~26 open ones, and timed
--    out a few times a day. Now about 0.15-0.8s.
create index concurrently if not exists conversations_open_asana_id_idx
  on public.conversations (id)
  where asana_task_gid is not null
    and asana_task_deleted_at is null
    and asana_completed_at is null;


-- ── Check (read-only): all three should appear, and the second query should be empty ──
-- select indexname from pg_indexes
-- where indexname in ('analysis_runs_analyzed_at_idx', 'conversations_open_asana_analyzed_at_idx',
--                     'conversations_open_asana_id_idx');
--
-- select c.relname from pg_index i join pg_class c on c.oid = i.indexrelid
-- where not i.indisvalid;
