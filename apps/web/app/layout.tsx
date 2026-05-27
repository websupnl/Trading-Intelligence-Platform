import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { PinGate } from '@/components/auth/PinGate';

export const metadata: Metadata = {
  title: 'Trading OS',
  description: 'Trading Intelligence Platform',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
        <PinGate>
          <TopBar />
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar: hidden on mobile, visible md+ */}
            <div className="hidden md:flex">
              <Sidebar />
            </div>
            <main className="flex-1 overflow-auto p-3 md:p-4">
              {children}
            </main>
          </div>
          <ChatPanel />
        </PinGate>
      </body>
    </html>
  );
}
