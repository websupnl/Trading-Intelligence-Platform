'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot, Brain, ChartCandlestick, Database, Play, ShieldCheck, Target } from 'lucide-react';

const flow = [
  {
    id: 'data',
    title: 'Data',
    detail: 'Nieuws, social en marktdata',
    icon: Database,
    taskKeys: ['ingest_news', 'fetch_reddit', 'fetch_market_data'],
    trigger: 'fetch_market_data',
    idleAction: 'Wacht op volgende data-run',
  },
  {
    id: 'ai',
    title: 'AI Analyse',
    detail: 'Sentiment, tickers, rumours',
    icon: Brain,
    taskKeys: ['analyze_content', 'detect_rumours'],
    trigger: 'analyze_content',
    idleAction: 'Wacht op analyseerbare items',
  },
  {
    id: 'signals',
    title: 'Signalen',
    detail: 'Bull/bear debate en setup',
    icon: Target,
    taskKeys: ['generate_signals'],
    trigger: 'generate_signals',
    idleAction: 'Wacht op genoeg edge-context',
  },
  {
    id: 'risk',
    title: 'Risk Gate',
    detail: 'Kill switch, mode, approval',
    icon: ShieldCheck,
    taskKeys: ['auto_trade'],
    trigger: 'auto_trade',
    idleAction: 'Wacht op uitvoerbaar signaal',
  },
  {
    id: 'outcomes',
    title: 'Leren',
    detail: 'Trades, P&L en outcomes',
    icon: ChartCandlestick,
    taskKeys: ['sync_closed_trades', 'evaluate_signal_outcomes'],
    trigger: 'sync_closed_trades',
    idleAction: 'Wacht op trades/outcomes',
  },
];

function StepStatus({ active, blocked }: { active: boolean; blocked: boolean }) {
  if (active) return <Badge variant="success" className="flow-pulse">draait</Badge>;
  if (blocked) return <Badge variant="warning">gepauzeerd</Badge>;
  return <Badge variant="muted">wacht</Badge>;
}

export function OperationsFlow() {
  const { data: pipeline, reload: reloadPipeline } = useApi(() => api.getPipelineStatus(), []);
  const { data: botHealth, reload: reloadBot } = useApi(() => api.getBotHealth(), []);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [triggeringFlow, setTriggeringFlow] = useState(false);
  const [, setLiveTick] = useState(0);

  const tasks = pipeline?.tasks ?? [];
  const taskByKey = useMemo(() => {
    return new Map(tasks.map((task: any) => [task.key, task]));
  }, [tasks]);
  const running = useMemo(() => {
    return new Set(tasks.filter((task: any) => task.is_running).map((task: any) => task.key));
  }, [tasks]);

  const blockers: string[] = botHealth?.blockers ?? [];
  const marketSession = pipeline?.market_session || botHealth?.market_session;
  const autoBlocked = blockers.length > 0;
  const [requested, setRequested] = useState<Record<string, number>>({});
  const flowTriggers = useMemo(() => flow.map(step => step.trigger), []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (cancelled) return;
      await Promise.all([reloadPipeline(), reloadBot()]);
      setLiveTick(tick => tick + 1);
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reloadPipeline, reloadBot]);

  async function trigger(key: string) {
    setTriggering(key);
    setRequested(prev => ({ ...prev, [key]: Date.now() }));
    try {
      await api.triggerTask(key);
      await Promise.all([reloadPipeline(), reloadBot()]);
    } finally {
      setTriggering(null);
    }
  }

  async function triggerCycle() {
    setTriggeringFlow(true);
    try {
      for (const key of flowTriggers) {
        setRequested(prev => ({ ...prev, [key]: Date.now() }));
        await api.triggerTask(key);
        await new Promise(resolve => window.setTimeout(resolve, 350));
      }
      await Promise.all([reloadPipeline(), reloadBot()]);
    } finally {
      setTriggeringFlow(false);
    }
  }

  return (
    <Card className="md:col-span-3 overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bot size={16} />
          <CardTitle>Live Operation Flow</CardTitle>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button variant="outline" size="sm" onClick={triggerCycle} disabled={triggeringFlow}>
            <Play size={13} />
            {triggeringFlow ? 'Cyclus aangevraagd' : 'Run cyclus'}
          </Button>
          <Badge variant="muted">Realtime</Badge>
          <Badge variant={marketSession?.crypto_only ? 'warning' : 'success'}>
            {marketSession?.crypto_only ? 'Crypto-focus' : 'Aandelen + crypto'}
          </Badge>
          <Badge variant={autoBlocked ? 'warning' : 'success'}>
            {autoBlocked ? 'Auto-trade uit' : 'Auto-trade klaar'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          <div className="rounded-md bg-muted/40 border border-border px-3 py-2">
            <p className="font-medium">Nu</p>
            <p className="mt-0.5 text-muted-foreground">{marketSession?.message || 'Status laden...'}</p>
          </div>
          <div className="rounded-md bg-muted/40 border border-border px-3 py-2">
            <p className="font-medium">AI</p>
            <p className="mt-0.5 text-muted-foreground">
              {botHealth?.anthropic_configured ? 'AI analyse kan draaien' : 'AI key ontbreekt voor echte analyse'}
            </p>
          </div>
          <div className="rounded-md bg-muted/40 border border-border px-3 py-2">
            <p className="font-medium">Orders</p>
            <p className="mt-0.5 text-muted-foreground">
              {botHealth?.require_manual_confirmation
                ? 'Handmatige bevestiging blokkeert auto-orders'
                : botHealth?.trading_mode === 'paper'
                  ? 'Alle uitvoering staat in paper mode'
                  : 'Live mode vereist extra controle'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          {flow.map((step, index) => {
            const Icon = step.icon;
            const active = step.taskKeys.some((key) => running.has(key));
            const blocked = step.id === 'risk' && autoBlocked;
            const cryptoNote = marketSession?.crypto_only && step.id === 'data';
            const activeTasks = step.taskKeys
              .map((key) => taskByKey.get(key))
              .filter((task: any) => task?.is_running);
            const requestedRecently = step.taskKeys.some((key) => {
              const ts = requested[key];
              return ts && Date.now() - ts < 10000;
            });
            const anyFlowRequested = flowTriggers.some(key => {
              const ts = requested[key];
              return ts && Date.now() - ts < 10000;
            });
            const firstUnrequestedIndex = flow.findIndex(item => !item.taskKeys.some(key => {
              const ts = requested[key];
              return ts && Date.now() - ts < 10000;
            }));
            const isNextInRequestedFlow = anyFlowRequested && firstUnrequestedIndex === index;
            return (
              <div key={step.id} className="relative">
                {index > 0 && <div className="hidden lg:block absolute -left-3 top-9 h-px w-3 bg-border" />}
                <div className={cn(
                  'flow-step rounded-md border bg-card p-3 min-h-[132px] transition-colors',
                  active && 'border-primary/50 bg-accent/45',
                  blocked && 'border-amber-200 bg-amber-50/80'
                )}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-muted text-foreground">
                      <Icon size={16} />
                    </span>
                    <StepStatus active={active} blocked={blocked} />
                  </div>
                  <p className="mt-3 text-sm font-semibold">{step.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground min-h-[32px]">{step.detail}</p>
                  {cryptoNote && <p className="mt-1 text-xs text-amber-700">Buiten US markturen alleen crypto.</p>}
                  <div className="mt-3 min-h-[44px] rounded-md border border-border/70 bg-muted/30 px-2 py-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Actie nu</p>
                    {activeTasks.length > 0 ? (
                      <div className="mt-1 space-y-1">
                        {activeTasks.map((task: any) => (
                          <div key={task.key} className="flex items-center gap-1.5 text-[11px] text-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-500 flow-pulse shrink-0" />
                            <span className="truncate">{task.label}</span>
                          </div>
                        ))}
                      </div>
                    ) : requestedRecently ? (
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        <span>In cyclus aangevraagd</span>
                      </div>
                    ) : isNextInRequestedFlow ? (
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                        <span>Volgende stap</span>
                      </div>
                    ) : blocked ? (
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        <span className="truncate">Geblokkeerd door safeguards</span>
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] text-muted-foreground">{step.idleAction}</p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => trigger(step.trigger)}
                    disabled={triggering === step.trigger}
                  >
                    <Play size={13} />
                    {triggering === step.trigger ? 'Aangevraagd' : 'Start'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {blockers.length > 0 && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span className="font-medium">Waarom auto-trade nu niets doet:</span> {blockers.join(' | ')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
