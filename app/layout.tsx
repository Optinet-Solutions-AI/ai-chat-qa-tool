import type { Metadata } from 'next';
import './globals.css';
import RootShell from '@/components/layout/RootShell';

export const metadata: Metadata = {
  title: 'AI Chat QA Tool',
  description: 'AI-powered QA analysis for iGaming customer support',
};

const noFlashTheme = `(function(){try{var t=localStorage.getItem('qa_theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body className="bg-[#f6f7fb] text-[#0f1419]">
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
