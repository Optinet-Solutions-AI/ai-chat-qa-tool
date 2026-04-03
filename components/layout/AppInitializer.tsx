'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import WelcomeModal from '@/components/setup/WelcomeModal';

export default function AppInitializer({ children }: { children: React.ReactNode }) {
  const { loadState, isLoaded, currentUser } = useStore();
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    loadState().then(() => {
      const storedUser = localStorage.getItem('qa_user') || '';
      if (!storedUser) {
        setShowWelcome(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWelcomeComplete = () => {
    setShowWelcome(false);
  };

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

  return (
    <>
      {showWelcome && <WelcomeModal onComplete={handleWelcomeComplete} />}
      {children}
    </>
  );
}
