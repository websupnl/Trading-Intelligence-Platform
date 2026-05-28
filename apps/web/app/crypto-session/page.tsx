'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AlertTriangle, Bot, Clock, Coins, Gauge, Moon, Play, ShieldCheck, Square, Zap } from 'lucide-react';

function minutesLeft(expiresAt?: string | null) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60000));
}

export default function CryptoSessionPage() {
  const { data: session, reload } = useApi(() => api.getCryptoSession(), [], { pollIntervalMs: 4000 });
  const { data: botHealth, reload: reloadBot } = useApi(() => api.getBotHealth(), [], { pollIntervalMs: 4000 });
  const [duration, setDuration] = useState(120);
  const [notional, setNotional] = useState(250);
  const [maxTrades, setMaxTrades] = useState(5);
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const [now, setNow] = useState(Date.now());
  const { toast } = useToast();

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const active = !!session?.active;
  const cryptoOnly = !!session?.market_session?.crypto_only;
  const allowed = !!session?.autonomous_allowed_now;
  const remaining = useMemo(() => minutesLeft(session?.expires_at), [session?.expires_at, now]);
  const blockers: string[] = botHealth?.blockers ?? [];

  async function start() {
    setBusy('start');
    try {
      await api.startCryptoSession({
        duration_minutes: duration,
        max_notional_per_trade: notional,
        max_trades: maxTrades,
        note: 'Away-mode crypto session',
      });
      await Promise.all([reload(), reloadBot()]);
      toast('Crypto-sessie gestart', 'success');
    } catch (e: any) {
      toast(e?.detail || 'Sessie starten mislukt', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy('stop');
    try {
      await api.stopCryptoSession();
      await Promise.all([reload(), reloadBot()]);
      toast('Crypto-sessie gestopt', 'info');
    } catch (e: any) {
      toast(e?.detail || 'Sessie stoppen mislukt', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-base font-semibold">Crypto Away Session</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Voor momenten waarop je weg bent en de US markt dicht is: crypto-only, paper mode, begrensd en auditbaar.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/live">
            <Button variant="outline" size="sm">Open Live View</Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => { reload(); reloadBot(); }}>Vernieuwen</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="md:col-span-2 overflow-hidden">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Moon size={16} />
              <CardTitle>Sessie Status</CardTitle>
            </div>
            <Badge variant={active ? 'success' : 'muted'}>{active ? 'Actief' : 'Uit'}</Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-border bg-muted/35 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock size={13} /> Resterend</div>
                <p className="mt-1 text-lg font-semibold tabular-nums">{active ? `${remaining} min` : '-'}</p>
              </div>
              <div className="rounded-md border border-border bg-muted/35 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Coins size={13} /> Per trade</div>
                <p className="mt-1 text-lg font-semibold tabular-nums">${session?.max_notional_per_trade ?? notional}</p>
              </div>
              <div className="rounded-md border border-border bg-muted/35 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Gauge size={13} /> Max trades</div>
                <p className="mt-1 text-lg font-semibold tabular-nums">{session?.max_trades ?? maxTrades}</p>
              </div>
              <div className="rounded-md border border-border bg-muted/35 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={13} /> Autonomie</div>
                <p className={cn('mt-1 text-lg font-semibold', allowed ? 'text-green-400' : 'text-amber-400')}>
                  {allowed ? 'Aan' : 'Wacht'}
                </p>
              </div>
            </div>

            <div className="mt-3 rounded-md border border-border bg-card p-3 text-xs">
              <p className="font-medium">Wat gebeurt er bij start?</p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-2">
                {['Crypto data ophalen', 'Signalen maken', 'Risk gate checken', 'Paper orders plaatsen'].map((label, i) => (
                  <div key={label} className="relative rounded-md bg-muted/35 border border-border px-2 py-2">
                    {i > 0 && <div className="hidden sm:block absolute -left-2 top-1/2 h-px w-2 bg-border" />}
                    <span className="text-[10px] text-muted-foreground">Stap {i + 1}</span>
                    <p className="mt-0.5 font-medium">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Play size={16} />
              <CardTitle>Start Away Mode</CardTitle>
            </div>
            <Badge variant={cryptoOnly ? 'success' : 'warning'}>{cryptoOnly ? 'US markt dicht' : 'US markt open'}</Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs">
                <span className="text-muted-foreground">Duur</span>
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="mt-1 w-full h-9 rounded-md border border-border bg-card px-2 text-sm">
                  <option value={60}>1 uur</option>
                  <option value={120}>2 uur</option>
                  <option value={240}>4 uur</option>
                  <option value={480}>8 uur</option>
                </select>
              </label>
              <label className="text-xs">
                <span className="text-muted-foreground">Max per trade</span>
                <input value={notional} onChange={(e) => setNotional(Number(e.target.value))} type="number" min={25} max={2500} className="mt-1 w-full h-9 rounded-md border border-border bg-card px-2 text-sm" />
              </label>
              <label className="text-xs">
                <span className="text-muted-foreground">Max trades</span>
                <input value={maxTrades} onChange={(e) => setMaxTrades(Number(e.target.value))} type="number" min={1} max={25} className="mt-1 w-full h-9 rounded-md border border-border bg-card px-2 text-sm" />
              </label>
            </div>

            {!cryptoOnly && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <div className="flex items-center gap-2 font-medium"><AlertTriangle size={14} /> Sessie kan alvast klaarstaan</div>
                <p className="mt-1">Autonome uitvoering gaat pas aan als de US markt dicht is. Tot die tijd blijft dit een crypto-plan, geen away-mode execution.</p>
              </div>
            )}

            {blockers.length > 0 && (
              <div className="mt-3 rounded-md border border-border bg-muted/35 px-3 py-2 text-xs">
                <p className="font-medium">Huidige bot blockers</p>
                <p className="mt-1 text-muted-foreground">{blockers.join(' | ')}</p>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <Button onClick={start} disabled={busy === 'start'} className="flex-1">
                {busy === 'start' ? <Zap size={14} className="animate-spin" /> : <Play size={14} />}
                Start crypto-sessie
              </Button>
              <Button variant="outline" onClick={stop} disabled={!active || busy === 'stop'}>
                <Square size={14} />
                Stop
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot size={16} />
            <CardTitle>Wat Mist Nog Voor Een Ultra-Setup</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="font-medium">Design & Flow</p>
              <p className="mt-1 text-muted-foreground">Sessie-timeline met candles, AI decisions, risk rejects en orders als één verhaal.</p>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="font-medium">AI Brein</p>
              <p className="mt-1 text-muted-foreground">Regime-detectie: trend/range/news shock/liquidity. Niet elk signaal door dezelfde lens behandelen.</p>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="font-medium">Money Potential</p>
              <p className="mt-1 text-muted-foreground">Edge meten per crypto, tijdstip, setup-type en modelversie voordat live geld logisch is.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
