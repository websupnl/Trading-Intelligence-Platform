'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, TrendingUp, ShoppingCart, Zap, Radio,
  Newspaper, MessageSquare, Brain, Database, Settings, Activity
} from 'lucide-react';

const nav = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/portfolio', label: 'Portfolio', icon: TrendingUp },
  { href: '/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/signals', label: 'Signals', icon: Zap },
  { href: '/rumour-radar', label: 'Rumour Radar', icon: Radio },
  { href: '/news', label: 'Nieuws', icon: Newspaper },
  { href: '/social', label: 'Social', icon: MessageSquare },
  { href: '/ai-war-room', label: 'AI War Room', icon: Brain },
  { href: '/memory', label: 'Memory', icon: Database },
  { href: '/audit', label: 'Audit', icon: Activity },
  { href: '/settings', label: 'Instellingen', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 bg-card border-r border-border flex flex-col min-h-screen">
      <div className="px-4 py-5 border-b border-border">
        <span className="text-sm font-bold tracking-widest text-foreground/80 uppercase">Trading OS</span>
      </div>
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
              pathname === href
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
        v1.0.0 • Paper Mode
      </div>
    </aside>
  );
}
