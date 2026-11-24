-- Lock down the public (anon) API (2026-11-24)
--
-- Why: the app only talks to Supabase server-side with the service_role key
-- (lib/supabase.ts; Vercel Production has SUPABASE_SERVICE_ROLE_KEY). The anon
-- key is never needed, but most tables had RLS off, so anyone holding the anon
-- key could read (and likely write) them through the REST API.
--
-- service_role bypasses RLS, so Production keeps working unchanged. Anything
-- running WITHOUT the service_role key (it falls back to the anon key) will see
-- empty tables after this. That's intended.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste the whole block -> Run.
-- Plain ALTER/REVOKE, no CONCURRENTLY, so running it all at once is fine.
-- It is safe to re-run. It does not touch data or the service_role grants.

-- 1. RLS on, no policies = anon/authenticated get nothing.
alter table public.conversations      enable row level security;
alter table public.analysis_runs      enable row level security;
alter table public.ai_queries         enable row level security;
alter table public.prompts            enable row level security;
alter table public.batch_jobs         enable row level security;
alter table public.sync_jobs          enable row level security;
alter table public.questions          enable row level security;
alter table public.conversation_notes enable row level security;
alter table public.messages           enable row level security;
alter table public.stages             enable row level security;
alter table public.app_users          enable row level security;

-- 2. Belt and braces: take the table/function grants away from the public roles.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated;

-- 3. Stop new tables/functions from getting anon grants by default.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;


-- ── Check (read-only): every row should show rls_enabled = true ──────────────
-- select relname as table_name, relrowsecurity as rls_enabled
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relkind = 'r'
-- order by relname;
