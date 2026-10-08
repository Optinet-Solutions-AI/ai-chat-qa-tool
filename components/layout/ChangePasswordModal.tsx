'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { useToast } from '@/components/layout/ToastProvider';
import { MIN_PASSWORD_LEN } from '@/lib/users';

interface Props {
  // 'welcome' — first visit after an admin issued a temporary password; offers
  //             "Skip for now" (see FirstLoginPasswordPrompt).
  // 'change'  — the header's self-service "Change password" dialog.
  mode: 'welcome' | 'change';
  // `changed` is true when the password was actually updated, false on
  // Cancel / Skip.
  onClose: (changed: boolean) => void;
}

const inputCls =
  'w-full rounded-lg px-3 py-2 text-sm bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:border-blue-400 focus:ring-blue-400/20';

export default function ChangePasswordModal({ mode, onClose }: Props) {
  const { currentUser, setMustChangePassword } = useStore();
  const { toast } = useToast();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isWelcome = mode === 'welcome';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    // Mirror the server rules so the common mistakes get instant feedback.
    if (next.length < MIN_PASSWORD_LEN) {
      setError(`New password must be at least ${MIN_PASSWORD_LEN} characters.`);
      return;
    }
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    if (next === current) {
      setError('New password must be different from the current one.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Could not update password.');
        return;
      }
      setMustChangePassword(false);
      toast('Password updated', 'success');
      onClose(true);
    } catch {
      setError('Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !!current && !!next && !!confirm;
  const inputType = show ? 'text' : 'password';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col">
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-base font-semibold text-slate-900">
            {isWelcome ? `Welcome${currentUser ? `, ${currentUser}` : ''}!` : 'Change password'}
          </h2>
          <p className="mt-1 text-sm text-slate-600 leading-relaxed">
            {isWelcome
              ? 'You signed in with a temporary password. Choose your own password now to keep your account secure.'
              : 'Enter your current password, then choose a new one.'}
          </p>

          <div className="mt-4 space-y-3">
            <input
              type={inputType}
              placeholder={isWelcome ? 'Temporary password' : 'Current password'}
              autoComplete="current-password"
              autoFocus
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputCls}
            />
            <input
              type={inputType}
              placeholder={`New password (min ${MIN_PASSWORD_LEN} characters)`}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputCls}
            />
            <input
              type={inputType}
              placeholder="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputCls}
            />
            <label className="flex items-center gap-2 text-xs text-slate-500 select-none">
              <input
                type="checkbox"
                checked={show}
                onChange={(e) => setShow(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
              />
              Show passwords
            </label>
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => onClose(false)}
            className="text-sm font-medium text-slate-600 px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors"
          >
            {isWelcome ? 'Skip for now' : 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={submitting || !canSubmit}
            className="text-sm font-medium text-white px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Saving…' : isWelcome ? 'Set password' : 'Update password'}
          </button>
        </div>
      </form>
    </div>
  );
}
