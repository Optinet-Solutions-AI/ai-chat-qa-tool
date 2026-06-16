'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/layout/ToastProvider';
import { useConfirm } from '@/components/layout/ConfirmProvider';
import { TEAMS, type AppUser, type UserStatus } from '@/lib/users';

const STATUS_STYLES: Record<UserStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300',
  disabled: 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300',
};

type Action =
  | { action: 'approve'; id: string; team: string }
  | { action: 'reject'; id: string }
  | { action: 'disable'; id: string }
  | { action: 'enable'; id: string }
  | { action: 'updateTeam'; id: string; team: string }
  | { action: 'setSnapshot'; id: string; snapshot: boolean }
  | { action: 'resetPassword'; id: string }
  | { action: 'delete'; id: string };

const inputCls =
  'rounded-lg px-3 py-1.5 text-sm bg-white border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:border-sky-400 focus:ring-sky-400/20 dark:bg-white/[0.06] dark:border-white/10 dark:text-white';

export default function AdminUsersPage() {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Per-pending-row team selection before approval.
  const [pendingTeam, setPendingTeam] = useState<Record<string, string>>({});
  // The most recent admin-reset password, shown in a persistent banner so it
  // can be copied and shared (toasts auto-dismiss in 3s — too short for this).
  const [resetInfo, setResetInfo] = useState<{ username: string; password: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch {
      toast('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(payload: Action, successMsg: string): Promise<void> {
    setBusyId(payload.id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error || 'Action failed', 'error');
        return;
      }
      if (payload.action === 'resetPassword' && data?.password) {
        // Surface the generated temp password in the banner so the admin can
        // copy + share it (no email sending yet — SMTP setup is pending).
        const u = users.find((x) => x.id === payload.id);
        setResetInfo({ username: u?.username ?? 'user', password: data.password });
        toast('Password reset', 'success');
      } else {
        toast(successMsg, 'success');
      }
      await load();
    } catch {
      toast('Network error', 'error');
    } finally {
      setBusyId(null);
    }
  }

  const pending = users.filter((u) => u.status === 'pending');
  const others = users.filter((u) => u.status !== 'pending');

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">User Management</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Approve new sign-ups, assign teams, reset passwords, and disable accounts. The Management
          team gets admin access (can edit the Prompt Library); every other team is standard.
        </p>

        {resetInfo && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm dark:border-cyan-400/30 dark:bg-cyan-400/10">
            <span className="text-slate-700 dark:text-slate-200">
              New temporary password for <strong>{resetInfo.username}</strong>:
            </span>
            <code className="rounded bg-white px-2 py-1 font-mono text-sky-700 dark:bg-slate-900 dark:text-cyan-300">
              {resetInfo.password}
            </code>
            <span className="text-xs text-slate-500 dark:text-slate-400">Share it with them securely.</span>
            <button
              onClick={() => setResetInfo(null)}
              className="ml-auto text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : (
          <>
            {/* ── Pending approvals ── */}
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Pending approval ({pending.length})
              </h2>
              {pending.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">No pending requests.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {pending.map((u) => {
                    const team = pendingTeam[u.id] ?? u.team ?? '';
                    return (
                      <div
                        key={u.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]"
                      >
                        <div className="min-w-[180px] flex-1">
                          <div className="font-semibold text-slate-900 dark:text-white">{u.username}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{u.email}</div>
                          <div className="text-xs text-slate-400 dark:text-slate-500">
                            requested: {u.team || '—'}
                          </div>
                        </div>
                        <select
                          value={team}
                          onChange={(e) => setPendingTeam((p) => ({ ...p, [u.id]: e.target.value }))}
                          className={inputCls}
                        >
                          <option value="" disabled>
                            Assign team…
                          </option>
                          {TEAMS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={busyId === u.id || !team}
                          onClick={() => run({ action: 'approve', id: u.id, team }, `Approved ${u.username}`)}
                          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          disabled={busyId === u.id}
                          onClick={async () => {
                            if (await confirm(`Reject ${u.username}'s request?`, { confirmLabel: 'Reject' }))
                              void run({ action: 'reject', id: u.id }, `Rejected ${u.username}`);
                          }}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/10"
                        >
                          Reject
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ── Existing accounts ── */}
            <section className="mt-10">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Accounts ({others.length})
              </h2>
              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/[0.04] dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Team</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Snapshot</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {others.map((u) => (
                      <tr key={u.id} className="text-slate-700 dark:text-slate-200">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">{u.username}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{u.email}</div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={u.team}
                            disabled={busyId === u.id}
                            onChange={(e) =>
                              run({ action: 'updateTeam', id: u.id, team: e.target.value }, `Updated ${u.username}'s team`)
                            }
                            className={inputCls}
                          >
                            {TEAMS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <span className={u.role === 'admin' ? 'font-semibold text-sky-600 dark:text-cyan-300' : ''}>
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[u.status]}`}>
                            {u.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={u.snapshot}
                            disabled={busyId === u.id}
                            onChange={(e) =>
                              run(
                                { action: 'setSnapshot', id: u.id, snapshot: e.target.checked },
                                `Updated ${u.username}'s snapshot setting`,
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 accent-sky-500"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              disabled={busyId === u.id}
                              onClick={async () => {
                                if (await confirm(`Reset ${u.username}'s password to a new temporary one?`, { confirmLabel: 'Reset' }))
                                  void run({ action: 'resetPassword', id: u.id }, '');
                              }}
                              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/10"
                            >
                              Reset password
                            </button>
                            {u.status === 'approved' ? (
                              <button
                                disabled={busyId === u.id}
                                onClick={async () => {
                                  if (await confirm(`Disable ${u.username}? They won't be able to sign in.`, { confirmLabel: 'Disable' }))
                                    void run({ action: 'disable', id: u.id }, `Disabled ${u.username}`);
                                }}
                                className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-40 dark:border-amber-400/30 dark:text-amber-300 dark:hover:bg-amber-400/10"
                              >
                                Disable
                              </button>
                            ) : (
                              <button
                                disabled={busyId === u.id}
                                onClick={() => run({ action: 'enable', id: u.id }, `Enabled ${u.username}`)}
                                className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:border-emerald-400/30 dark:text-emerald-300 dark:hover:bg-emerald-400/10"
                              >
                                Enable
                              </button>
                            )}
                            <button
                              disabled={busyId === u.id}
                              onClick={async () => {
                                if (await confirm(`Permanently delete ${u.username}? This cannot be undone.`, { confirmLabel: 'Delete', danger: true }))
                                  void run({ action: 'delete', id: u.id }, `Deleted ${u.username}`);
                              }}
                              className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-400/10"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
