'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';

interface WelcomeModalProps {
  onComplete: () => void;
}

export default function WelcomeModal({ onComplete }: WelcomeModalProps) {
  const [name, setName] = useState('');
  const setCurrentUser = useStore((s) => s.setCurrentUser);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCurrentUser(trimmed);
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
        <div className="text-center mb-6">
          <div className="text-5xl mb-4">👋</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome to AI Chat QA Tool</h1>
          <p className="text-slate-500 text-sm">
            Your iGaming customer support QA platform. Enter your name to get started.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
              Your Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sarah Johnson"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            Get Started
          </button>
        </form>
      </div>
    </div>
  );
}
