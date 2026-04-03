'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { currentUser } = useStore();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const linkBase = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors';
  const activeLink = 'bg-blue-50 text-blue-600 border-l-2 border-blue-500 rounded-l-none pl-[10px]';
  const inactiveLink = 'text-slate-600 hover:bg-slate-50 hover:text-slate-900';

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-20 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-30
          w-64 bg-white border-r border-slate-200
          flex flex-col h-screen overflow-y-auto
          transition-transform duration-200
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-200">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            QA
          </div>
          <span className="font-semibold text-slate-900">AI Chat QA</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          <Link
            href="/"
            onClick={onClose}
            className={`${linkBase} ${isActive('/') ? activeLink : inactiveLink}`}
          >
            <span>💬</span>
            <span>Conversations</span>
          </Link>

          <Link
            href="/prompts"
            onClick={onClose}
            className={`${linkBase} ${isActive('/prompts') ? activeLink : inactiveLink}`}
          >
            <span>📝</span>
            <span>Prompt Library</span>
          </Link>
        </nav>

        {/* Bottom: user */}
        <div className="p-3 border-t border-slate-200">
          <div className="flex items-center gap-2 px-1">
            <div className="w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold uppercase">
              {currentUser ? currentUser.charAt(0) : '?'}
            </div>
            <p className="text-xs font-medium text-slate-700 truncate">
              {currentUser || 'Guest'}
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
