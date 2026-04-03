'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import ToastProvider from './ToastProvider';
import AppInitializer from './AppInitializer';
import Sidebar from './Sidebar';
import Header from './Header';
import AddConversationModal from '@/components/conversations/AddConversationModal';

export default function RootShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAddConv, setShowAddConv] = useState(false);
  const pathname = usePathname();

  return (
    <ToastProvider>
      <AppInitializer>
        <div className="flex h-screen overflow-hidden">
          <Sidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
          <div className="flex flex-col flex-1 overflow-hidden lg:ml-0">
            <Header
              onMenuToggle={() => setSidebarOpen((v) => !v)}
              onAddConversation={pathname === '/' ? () => setShowAddConv(true) : undefined}
            />
            <main className="flex-1 overflow-y-auto p-4 sm:p-6">
              {children}
            </main>
          </div>
        </div>

        {showAddConv && (
          <AddConversationModal onClose={() => setShowAddConv(false)} />
        )}
      </AppInitializer>
    </ToastProvider>
  );
}
