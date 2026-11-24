-- Disk IO indexes (2026-11-24)
--
-- Why: Supabase warned the project was exhausting its Disk IO budget.
-- `conversations` (~185k rows, wide rows with transcripts + AI summaries) had
-- no index on intercom_created_at, the column nearly every dashboard, cron and
-- list query filters and orders by. Each of those queries was a full-table
-- scan + sort, and the dashboard's offset pagination repeated that scan for
-- every 1,000-row page. Measured before this change: `ORDER BY
-- intercom_created_at DESC LIMIT 1` hit the 8s statement timeout, while
-- primary-key and intercom_id lookups returned in ~1-2s.
--
-- HOW TO RUN (Supabase dashboard -> SQL Editor):
--   * Run each CREATE INDEX statement ON ITS OWN (select just that statement,
--     then Run). CONCURRENTLY cannot run inside a transaction, and the editor
--     wraps a multi-statement run in one.
--   * CONCURRENTLY builds the index without blocking the crons' inserts and
--     updates. Each build reads the table once, so expect it to take a few
--     minutes while the IO budget is depleted.
--   * IF NOT EXISTS makes every statement safe to re-run.
--   * If a build is interrupted it can leave an INVALID index behind; the
--     check at the bottom lists those. Drop it (DROP INDEX CONCURRENTLY <name>;)
--     and re-run its CREATE statement.
--
-- Nothing here changes data, RLS policies or table structure.

-- 1. Date range + ordering on conversations.
--    Serves: dashboard scoped/global slices (all the paginated 30-day / date
--    range loops, overview counts, spike + heatmap fetches), the conversations
--    list (ORDER BY intercom_created_at DESC), drill-downs, the collect cron's
--    reconcile pass, the daily snapshot. A DESC index is also scanned
--    backwards for the ascending queries.
create index concurrently if not exists conversations_intercom_created_at_id_idx
  on public.conversations (intercom_created_at desc, id desc);

-- 2. Unanalyzed backlog.
--    Serves: analyze-daily cron every 15 min (summary IS NULL, oldest first,
--    LIMIT 16) and the unanalyzed counts on the batch-analysis page. Partial,
--    so it only holds the small set of rows still waiting for analysis.
create index concurrently if not exists conversations_unanalyzed_idx
  on public.conversations (intercom_created_at, id)
  where summary is null;

-- 3. Live Asana tickets.
--    Serves: sync-asana-statuses cron every 15 min (list all live tickets
--    ORDER BY id), the dashboard's inline Asana sync, the AM re-derive sweep
--    and the pending-escalation counters. Partial: only ticketed rows.
create index concurrently if not exists conversations_live_asana_idx
  on public.conversations (id)
  where asana_task_gid is not null and asana_task_deleted_at is null;

-- 4. analysis_runs by conversation.
--    Serves: the collect cron's reconcile deletes, cleanup admin routes and
--    single-conversation deletes (all DELETE ... WHERE conversation_id IN ...),
--    which otherwise scan all ~183k analysis_runs rows each time.
create index concurrently if not exists analysis_runs_conversation_id_idx
  on public.analysis_runs (conversation_id);


-- ── Checks (safe, read-only) ──────────────────────────────────────────────

-- Indexes now on the two tables (should list the four above):
-- select tablename, indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public' and tablename in ('conversations', 'analysis_runs')
-- order by tablename, indexname;

-- Any index left INVALID by an interrupted build (should return no rows):
-- select c.relname as index_name
-- from pg_index i join pg_class c on c.oid = i.indexrelid
-- where not i.indisvalid;

-- Confirm the planner uses index 1 (look for "Index Scan" rather than "Seq Scan"):
-- explain select id from public.conversations
-- order by intercom_created_at desc, id desc limit 1;

-- Heaviest queries by disk reads, if pg_stat_statements is enabled. Run before
-- and a day after to compare:
-- select calls, shared_blks_read, round(total_exec_time) as total_ms,
--        left(query, 160) as query
-- from pg_stat_statements
-- order by shared_blks_read desc
-- limit 15;
