import type { Metadata } from 'next';
import './globals.css';
import RootShell from '@/components/layout/RootShell';

export const metadata: Metadata = {
  title: 'AI Chat QA Tool',
  description: 'AI-powered QA analysis for iGaming customer support',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#f6f7fb] text-[#0f1419]">
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
