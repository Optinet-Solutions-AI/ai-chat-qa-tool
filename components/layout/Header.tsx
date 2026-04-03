'use client';

import { usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';

interface HeaderProps {
  onMenuToggle: () => void;
  onAddConversation?: () => void;
}

const PAGE_TITLES: Record<string, string> = {
  '/': 'Conversations',
  '/prompts': 'Prompt Library',
};

export default function Header({ onMenuToggle, onAddConversation }: HeaderProps) {
  const pathname = usePathname();
  const { currentUser } = useStore();

  const title = PAGE_TITLES[pathname] ?? 'QA Tool';

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center px-4 gap-4 flex-shrink-0">
      {/* Hamburger (mobile) */}
      <button
        onClick={onMenuToggle}
        className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
        aria-label="Toggle sidebar"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Page title */}
      <h1 className="text-lg font-semibold text-slate-900 flex-1">{title}</h1>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {pathname === '/' && onAddConversation && (
          <button
            onClick={onAddConversation}
            className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <span>+</span>
            <span className="hidden sm:inline">Add Conversation</span>
          </button>
        )}

        {/* User avatar */}
        <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold uppercase">
          {currentUser ? currentUser.charAt(0) : '?'}
        </div>
      </div>
    </header>
  );
}
