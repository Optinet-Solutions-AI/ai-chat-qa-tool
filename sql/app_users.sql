-- app_users — the login roster, moved out of the hardcoded lib/users.ts list
-- and the APP_USERS env var into the database.
--
-- Run this once in the Supabase SQL editor (or via the CLI). Then hit
-- POST /api/admin/seed-users (Bearer CRON_SECRET) once to import the 26
-- legacy users as already-approved, hashing their current APP_USERS passwords.
--
-- Access model (unchanged from before):
--   role 'admin'    — Management team. Full access + may edit the Prompt Library.
--   role 'standard' — everyone else. No Prompt Library.
-- role is DERIVED from team (Management → admin) by the app; it is stored here
-- too so queries/reads don't have to recompute it.
--
-- status lifecycle:
--   'pending'  — self-registered, awaiting admin approval (cannot log in)
--   'approved' — active account (can log in)
--   'rejected' — admin declined the request (cannot log in)
--   'disabled' — admin revoked an existing account (cannot log in)

create extension if not exists pgcrypto;  -- for gen_random_uuid()

create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  username      text        not null,
  email         text        not null,
  password_hash text        not null,
  team          text        not null,
  role          text        not null default 'standard' check (role in ('admin', 'standard')),
  status        text        not null default 'pending'  check (status in ('pending', 'approved', 'rejected', 'disabled')),
  snapshot      boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  approved_at   timestamptz,
  approved_by   text
);

-- Usernames are matched case-insensitively at login, so enforce uniqueness on
-- the lowercased value (blocks "Val" vs "val" duplicate registrations).
create unique index if not exists app_users_username_lower_idx
  on app_users (lower(username));
