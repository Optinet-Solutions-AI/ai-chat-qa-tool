#!/usr/bin/env node
// Account roster maintenance for app_users — the bulk operations the admin UI
// does not cover. Dry run by default; nothing is written without --apply.
//
//   create   add approved accounts from a list of emails, each with a
//            temporary password
//   reissue  give existing approved accounts a fresh temporary password,
//            optionally moving their email to a new domain
//   disable  disable the approved accounts on an email domain
//
// Usage (from the repo root; reads SUPABASE_* from .env.local):
//   node scripts/accounts.mjs create  --emails tmp/new-accounts.txt [--team NON-VIP] [--username email|local] [--apply]
//   node scripts/accounts.mjs reissue --old-domain old.com --new-domain new.com [--only Val,Dror] [--apply]
//   node scripts/accounts.mjs reissue --only Val [--apply]
//   node scripts/accounts.mjs disable --domain old.com [--keep-admins] [--apply]
//
// Temporary passwords are stored with the `scrypt-temp` scheme (see
// lib/password.ts): the app greets the user with a "set your own password"
// prompt until they choose one. The hashing and the generator below mirror
// lib/password.ts exactly — keep them in sync.
//
// !!  Deploy code that understands `scrypt-temp` hashes BEFORE --apply on
//     create/reissue. Older builds reject that scheme at login, which would
//     lock the affected users out until the deploy lands.
//
// create/reissue print a username / team / email / temporary password table
// and write the same rows as CSV to tmp/ (gitignored) for emailing by hand.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes, randomInt, scryptSync } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Mirror of lib/users.ts (kept inline so the script has no TS imports).
const TEAMS = ['Management', 'CRM', 'NON-VIP', 'VIP English', 'VIP German', 'VIP Italian', 'GCC'];
const roleForTeam = (team) => (team === 'Management' ? 'admin' : 'standard');
const snapshotForTeam = (team) => team === 'Management' || team === 'CRM';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const USAGE = `usage:
  node scripts/accounts.mjs create  --emails <file> [--team NON-VIP] [--username email|local] [--apply]
  node scripts/accounts.mjs reissue --old-domain <old> --new-domain <new> [--only a,b] [--apply]
  node scripts/accounts.mjs reissue --only a,b [--apply]
  node scripts/accounts.mjs disable --domain <domain> [--keep-admins] [--apply]`;

// ── args ──
const [mode, ...args] = process.argv.slice(2);
function opt(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? '' : v;
}
const flag = (name) => args.includes(`--${name}`);
function usage(msg) {
  if (msg) console.error(msg);
  console.error(USAGE);
  return 1;
}
if (!['create', 'reissue', 'disable'].includes(mode ?? '')) {
  process.exit(usage());
}
const apply = flag('apply');

// ── env ──
function loadEnv(path) {
  const out = {};
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
const env = { ...loadEnv('.env.local'), ...process.env };
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (expected in .env.local).');
  process.exit(1);
}

// ── password helpers (mirror lib/password.ts) ──
const KEYLEN = 64;
function hashTempPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `scrypt-temp$${salt.toString('hex')}$${hash.toString('hex')}`;
}
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYMBOL = '!#$%&*?';
const TEMP_PASSWORD_LEN = 12;
const pick = (set) => set[randomInt(set.length)];
function generateTempPassword() {
  const all = LOWER + UPPER + DIGIT + SYMBOL;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < TEMP_PASSWORD_LEN) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
// Unique within a run — a collision is astronomically unlikely, but it is
// cheap to rule out outright.
function passwordFactory() {
  const seen = new Set();
  return () => {
    let p;
    do p = generateTempPassword();
    while (seen.has(p));
    seen.add(p);
    return p;
  };
}

// ── output helpers ──
const pad = (s, n) => String(s).padEnd(n);
function printTable(title, rows, lastHeader, lastCell) {
  const w = {
    u: Math.max(8, ...rows.map((r) => r.username.length)),
    t: Math.max(4, ...rows.map((r) => r.team.length)),
    e: Math.max(5, ...rows.map((r) => r.email.length)),
  };
  console.log(`${title}\n`);
  console.log(`${pad('username', w.u)}  ${pad('team', w.t)}  ${pad('email', w.e)}  ${lastHeader}`);
  console.log('-'.repeat(w.u + w.t + w.e + lastHeader.length + 6));
  for (const r of rows) {
    console.log(`${pad(r.username, w.u)}  ${pad(r.team, w.t)}  ${pad(r.email, w.e)}  ${lastCell(r)}`);
  }
}
function writeCsv(rows) {
  mkdirSync('tmp', { recursive: true });
  // Second-precision stamp so back-to-back runs never overwrite each other.
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const file = `tmp/temp-passwords-${stamp}.csv`;
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.username, r.team, r.email, r.password].map(q).join(','));
  writeFileSync(file, ['username,team,email,temporary_password', ...lines].join('\n') + '\n');
  return file;
}
// Shared tail for create/reissue: dry-run note, or CSV + failure summary.
function finishWithPasswords(plan, verb) {
  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply once the scrypt-temp-aware code is deployed.');
    return 0;
  }
  const done = plan.filter((p) => p.ok);
  const failed = plan.length - done.length;
  const file = done.length ? writeCsv(done) : null;
  console.log(`\n${verb} ${done.length} account(s).${file ? ` Wrote ${file} (gitignored).` : ''}`);
  if (failed) {
    console.error(`${failed} FAILED — see above. Those accounts were NOT changed.`);
    return 1;
  }
  return 0;
}
const passwordCell = (p) => (p.err ? `FAILED: ${p.err}` : apply ? p.password : '(generated on --apply)');

// ── create ──
async function create(sb) {
  const file = opt('emails');
  if (!file) return usage('create needs --emails <file> (one address per line).');
  const team = opt('team') || 'NON-VIP';
  if (!TEAMS.includes(team)) return usage(`--team must be one of: ${TEAMS.join(', ')}`);
  const usernameMode = opt('username') || 'email';
  if (!['email', 'local'].includes(usernameMode)) return usage('--username must be "email" (default) or "local".');

  const emails = [];
  const seen = new Set();
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const e = raw.trim();
    if (!e || e.startsWith('#')) continue;
    if (!EMAIL_RE.test(e)) {
      console.warn(`! not an email address, skipping: ${e}`);
      continue;
    }
    if (seen.has(e.toLowerCase())) {
      console.warn(`! duplicate in list, skipping: ${e}`);
      continue;
    }
    seen.add(e.toLowerCase());
    emails.push(e);
  }
  if (emails.length === 0) {
    console.log('No addresses to create.');
    return 0;
  }

  const { data: existing, error } = await sb.from('app_users').select('username, email');
  if (error) {
    console.error('Query failed:', error.message);
    return 1;
  }
  const takenUsers = new Set(existing.map((r) => r.username.toLowerCase()));
  const takenEmails = new Set(existing.map((r) => r.email.toLowerCase()));

  const nextPassword = passwordFactory();
  const plan = [];
  for (const email of emails) {
    const username = usernameMode === 'local' ? email.split('@')[0] : email;
    if (takenEmails.has(email.toLowerCase())) {
      console.warn(`! already has an account, skipping: ${email}`);
      continue;
    }
    if (takenUsers.has(username.toLowerCase())) {
      console.warn(`! username already taken, skipping: ${username}`);
      continue;
    }
    plan.push({ username, email, team, password: nextPassword(), ok: false });
  }
  if (plan.length === 0) {
    console.log('Nothing to create.');
    return 0;
  }

  if (apply) {
    const now = new Date().toISOString();
    for (const p of plan) {
      const { error: insErr } = await sb.from('app_users').insert({
        username: p.username,
        email: p.email,
        password_hash: hashTempPassword(p.password),
        team,
        role: roleForTeam(team),
        status: 'approved',
        snapshot: snapshotForTeam(team),
        approved_at: now,
        approved_by: 'bulk-import',
      });
      if (insErr) p.err = insErr.message;
      else p.ok = true;
    }
  }
  printTable(
    `${apply ? 'Created' : 'DRY RUN: would create'} ${plan.length} approved account(s) · team ${team} (${roleForTeam(team)})`,
    plan,
    'temporary password',
    passwordCell,
  );
  return finishWithPasswords(plan, 'Created');
}

// ── reissue ──
async function reissue(sb) {
  const oldDomain = opt('old-domain')?.toLowerCase() || undefined;
  const newDomain = opt('new-domain')?.toLowerCase() || undefined;
  const only = (opt('only') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!!oldDomain !== !!newDomain) return usage('--old-domain and --new-domain must be given together.');
  if (!oldDomain && only.length === 0) return usage('reissue needs --old-domain/--new-domain and/or --only a,b.');

  const { data: rows, error } = await sb
    .from('app_users')
    .select('id, username, email, team')
    .eq('status', 'approved')
    .order('team')
    .order('username');
  if (error) {
    console.error('Query failed:', error.message);
    return 1;
  }
  const targets = rows.filter((r) => {
    const domain = (r.email.split('@')[1] ?? '').toLowerCase();
    const domainHit = oldDomain ? domain === oldDomain : true;
    const onlyHit = only.length ? only.includes(r.username.toLowerCase()) : true;
    return domainHit && onlyHit;
  });
  if (only.length) {
    const found = new Set(targets.map((r) => r.username.toLowerCase()));
    for (const u of only) {
      if (!found.has(u)) console.warn(`! --only: no approved user "${u}"${oldDomain ? ` on @${oldDomain}` : ''}`);
    }
  }
  if (targets.length === 0) {
    console.log('No matching approved accounts.');
    return 0;
  }

  const nextPassword = passwordFactory();
  const plan = targets.map((r) => ({
    ...r,
    email: newDomain ? `${r.email.split('@')[0]}@${newDomain}` : r.email,
    password: nextPassword(),
    ok: false,
  }));
  if (apply) {
    for (const p of plan) {
      const { error: upErr } = await sb
        .from('app_users')
        .update({ email: p.email, password_hash: hashTempPassword(p.password), updated_at: new Date().toISOString() })
        .eq('id', p.id);
      if (upErr) p.err = upErr.message;
      else p.ok = true;
    }
  }
  printTable(
    `${apply ? 'Reissued' : 'DRY RUN: would reissue'} ${plan.length} approved account(s)` +
      (newDomain ? ` · @${oldDomain} -> @${newDomain}` : ''),
    plan,
    'temporary password',
    passwordCell,
  );
  return finishWithPasswords(plan, 'Reissued');
}

// ── disable ──
async function disable(sb) {
  const domain = opt('domain')?.toLowerCase();
  if (!domain) return usage('disable needs --domain <domain>.');
  const keepAdmins = flag('keep-admins');

  const { data: rows, error } = await sb
    .from('app_users')
    .select('id, username, email, team, role')
    .eq('status', 'approved')
    .order('team')
    .order('username');
  if (error) {
    console.error('Query failed:', error.message);
    return 1;
  }
  const targets = rows
    .filter((r) => (r.email.split('@')[1] ?? '').toLowerCase() === domain)
    .filter((r) => !keepAdmins || r.role !== 'admin');
  if (targets.length === 0) {
    console.log(`No approved accounts on @${domain}${keepAdmins ? ' (admins excluded)' : ''}.`);
    return 0;
  }
  const plan = targets.map((r) => ({ ...r, ok: false }));
  if (apply) {
    for (const p of plan) {
      const { error: upErr } = await sb
        .from('app_users')
        .update({ status: 'disabled', updated_at: new Date().toISOString() })
        .eq('id', p.id);
      if (upErr) p.err = upErr.message;
      else p.ok = true;
    }
  }
  printTable(
    `${apply ? 'Disabled' : 'DRY RUN: would disable'} ${plan.length} approved account(s) on @${domain}` +
      (keepAdmins ? ' (admins kept)' : ''),
    plan,
    'role / result',
    (p) => (p.err ? `${p.role} FAILED: ${p.err}` : apply ? `${p.role} -> disabled` : p.role),
  );
  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to disable them.');
    return 0;
  }
  const failed = plan.filter((p) => !p.ok).length;
  console.log(`\nDisabled ${plan.length - failed} account(s).`);
  if (failed) {
    console.error(`${failed} FAILED — see above.`);
    return 1;
  }
  return 0;
}

// Returns an exit code instead of calling process.exit() so keep-alive
// sockets can wind down cleanly (process.exit() with live handles trips a
// libuv assertion on Windows builds of Node).
async function main() {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  if (mode === 'create') return create(sb);
  if (mode === 'reissue') return reissue(sb);
  return disable(sb);
}
process.exitCode = await main();
