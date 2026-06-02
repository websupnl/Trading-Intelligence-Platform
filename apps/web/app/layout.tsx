import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { PinGate } from '@/components/auth/PinGate';
import { ToastProvider } from '@/contexts/toast';
import { RegisterSW } from '@/components/pwa/RegisterSW';

export const metadata: Metadata = {
  title: 'Trading OS',
  description: 'Autonome trading intelligence platform',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Trading OS',
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0f1117',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body className="flex flex-col h-[100dvh] overflow-hidden bg-background text-foreground pt-safe">
        <RegisterSW />
        <PinGate>
          <ToastProvider>
            <TopBar />
            <div className="flex flex-1 overflow-hidden">
              <Sidebar />
              {/* pb-nav accounts for bottom nav + safe area on iPhone */}
              <main className="flex-1 overflow-y-auto overscroll-none p-3 md:p-4 pb-nav md:pb-4">
                {children}
              </main>
            </div>
            <ChatPanel />
          </ToastProvider>
        </PinGate>
      </body>
    </html>
  );
}
