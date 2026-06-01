'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';

export default function AppInitializer({ children }: { children: React.ReactNode }) {
  const { loadState, isLoaded, setCurrentUser, setCurrentRole } = useStore();

  useEffect(() => {
    loadState();
    // Identity now comes from the login session (qa_auth cookie) rather than a
    // typed-in name. Pull it from /api/auth/me and seed the store so the avatar,
    // note attribution, and admin-only UI all reflect the real account.
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((me: { username?: string; role?: 'admin' | 'standard' } | null) => {
        if (me?.username) setCurrentUser(me.username);
        if (me?.role) setCurrentRole(me.role);
      })
      .catch(() => {/* stay logged-out; middleware will redirect protected pages */});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f6f7fb]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 text-sm">Loading QA Tool…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
