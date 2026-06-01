'use client';
import { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, Loader2, RefreshCw, Dice5, ScanSearch, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useGokWebSocket } from './components/useGokWebSocket';
import { OpportunityCard } from './components/OpportunityCard';
import { ActivePosition } from './components/ActivePosition';
import { ScoreBoard } from './components/ScoreBoard';
import { StrategyPicker } from './components/StrategyPicker';
import { HistoryTable } from './components/HistoryTable';
import { BacktestView } from './components/BacktestView';
import type { Opportunity } from './components/useGokWebSocket';

type Tab = 'arena' | 'strategies' | 'history' | 'backtest';

const BUDGET_OPTIONS = [10, 25, 50, 100];

export default function GokPage() {
  const [tab, setTab] = useState<Tab>('arena');
  const [budget, setBudget] = useState(50);
  const [customBudget, setCustomBudget] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState('NEWS_MOMENTUM');
  const [scanning, setScanning] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [status, setStatus] = useState<{ available: boolean; reason?: string; mode: string } | null>(null);
  const [strategies, setStrategies] = useState<unknown[]>([]);
  const [openPositions, setOpenPositions] = useState<unknown[]>([]);
  const [history, setHistory] = useState<unknown[]>([]);
  const [stats, setStats] = useState(null);
  const [scannedOpportunities, setScannedOpportunities] = useState<Opportunity[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const { connectionStatus, opportunities: liveOpportunities, positionUpdates, recentlyClosed, clearOpportunities } = useGokWebSocket();

  const effectiveBudget = customBudget ? Number(customBudget) : budget;

  const loadData = useCallback(async () => {
    try {
      const [statusData, strategiesData, positionsData, historyData, statsData] = await Promise.all([
        api.getGokStatus(),
        api.getGokStrategies(),
        api.getGokPositions(),
        api.getGokHistory(50),
        api.getGokStats(),
      ]);
      setStatus(statusData);
      setStrategies(strategiesData);
      setOpenPositions(positionsData);
      setHistory(historyData);
      setStats(statsData);
    } catch (e) {
      setError('Kon gok data niet laden.');
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Verversen als posities gesloten worden via WS
  useEffect(() => {
    if (recentlyClosed.length > 0) {
      loadData();
    }
  }, [recentlyClosed, loadData]);

  const handleManualScan = async () => {
    setScanning(true);
    setError('');
    setScannedOpportunities([]);
    clearOpportunities();
    try {
      const data = await api.scanGok(selectedStrategy, effectiveBudget);
      setScannedOpportunities(data);
      if (data.length === 0) {
        setError('Geen kansen gevonden voor deze strategie. Probeer later opnieuw.');
      }
    } catch (e: unknown) {
      const err = e as { detail?: string };
      setError(err?.detail || 'Scan mislukt.');
    } finally {
      setScanning(false);
    }
  };

  const handleConfirm = async (opp: Opportunity) => {
    const key = `${opp.asset}-${opp.strategy}`;
    setExecuting(key);
    setError('');
    try {
      await api.executeGok({
        asset: opp.asset,
        strategy: opp.strategy,
        budget_eur: effectiveBudget,
        entry_price: opp.entry_price,
        take_profit: opp.take_profit,
        stop_loss: opp.stop_loss,
        atr: opp.atr,
        opportunity_data: {
          score: opp.score,
          confidence: opp.confidence,
          reason: opp.reason,
          news_headlines: opp.news_headlines,
        },
      });
      setSuccessMsg(`${opp.asset} gok geplaatst! Paper trade actief.`);
      setTimeout(() => setSuccessMsg(''), 5000);
      // Verwijder uit feed
      setScannedOpportunities(s => s.filter(o => o !== opp));
      loadData();
    } catch (e: unknown) {
      const err = e as { detail?: string };
      setError(err?.detail || 'Trade mislukt.');
    } finally {
      setExecuting(null);
    }
  };

  const handleDismiss = (opp: Opportunity) => {
    const key = `${opp.asset}-${opp.strategy}-${opp.received_at}`;
    setDismissedIds(s => new Set([...s, key]));
    setScannedOpportunities(prev => prev.filter(o => o !== opp));
  };

  const handleClose = async (positionId: string) => {
    setClosingId(positionId);
    try {
      await api.closeGokPosition(positionId);
      loadData();
    } catch (e) {
      setError('Positie sluiten mislukt.');
    } finally {
      setClosingId(null);
    }
  };

  // Gecombineerde feed: handmatig gescan + live WS
  const allOpportunities = [
    ...scannedOpportunities,
    ...liveOpportunities.filter(o =>
      !scannedOpportunities.some(s => s.asset === o.asset && s.strategy === o.strategy) &&
      !dismissedIds.has(`${o.asset}-${o.strategy}-${o.received_at}`)
    ),
  ];

  const tabs: { id: Tab; label: string }[] = [
    { id: 'arena', label: 'Arena' },
    { id: 'strategies', label: 'Strategieën' },
    { id: 'history', label: 'History' },
    { id: 'backtest', label: 'Backtest' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Dice5 size={24} className="text-primary" />
          <div>
            <h1 className="text-xl font-bold">Gok Modus</h1>
            <p className="text-xs text-muted-foreground">Speculatieve AI-gestuurde trades met dynamisch risicobeheer</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* WS status */}
          <div className={cn(
            'flex items-center gap-1.5 text-xs px-2 py-1 rounded',
            connectionStatus === 'connected' ? 'text-green-400 bg-green-500/10' :
            connectionStatus === 'connecting' ? 'text-yellow-400 bg-yellow-500/10' :
            'text-muted-foreground bg-muted'
          )}>
            {connectionStatus === 'connected'
              ? <><Wifi size={12} /> Live</>
              : connectionStatus === 'connecting'
              ? <><Loader2 size={12} className="animate-spin" /> Verbinden</>
              : <><WifiOff size={12} /> Offline</>
            }
          </div>

          {/* Mode badge */}
          {status && (
            <div className={cn(
              'text-xs px-2 py-1 rounded',
              status.mode === 'live' ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-500'
            )}>
              {status.mode === 'live' ? 'Live' : 'Paper'}
            </div>
          )}

          <button onClick={loadData} className="p-2 rounded hover:bg-accent text-muted-foreground">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Status banner */}
      {status && !status.available && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertCircle size={16} />
          {status.reason}
        </div>
      )}

      {/* Score board */}
      <ScoreBoard stats={stats} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Error / success messages */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
          {successMsg}
        </div>
      )}

      {/* ===== ARENA TAB ===== */}
      {tab === 'arena' && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-4">
            {/* Budget */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Budget</label>
              <div className="flex gap-1">
                {BUDGET_OPTIONS.map((b) => (
                  <button
                    key={b}
                    onClick={() => { setBudget(b); setCustomBudget(''); }}
                    className={cn(
                      'px-3 py-1.5 text-sm rounded border transition-colors',
                      !customBudget && budget === b
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:bg-accent'
                    )}
                  >
                    €{b}
                  </button>
                ))}
                <input
                  type="number"
                  min={5}
                  max={500}
                  placeholder="Eigen"
                  value={customBudget}
                  onChange={(e) => setCustomBudget(e.target.value)}
                  className="w-20 px-2 py-1.5 text-sm rounded border border-border bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Strategy select */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Strategie</label>
              <select
                value={selectedStrategy}
                onChange={(e) => setSelectedStrategy(e.target.value)}
                className="bg-card border border-border rounded px-3 py-1.5 text-sm"
              >
                {(strategies as { name: string; display_name: string }[]).map((s) => (
                  <option key={s.name} value={s.name}>{s.display_name}</option>
                ))}
              </select>
            </div>

            {/* Scan button */}
            <button
              onClick={handleManualScan}
              disabled={scanning || !status?.available}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50 hover:bg-primary/90"
            >
              {scanning ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />}
              {scanning ? 'Scannen...' : 'AI Scan'}
            </button>
          </div>

          {/* Open positions */}
          {(openPositions as unknown[]).length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-3">Open posities</h3>
              <div className="space-y-3">
                {(openPositions as {
                  id: string;
                  asset: string;
                  strategy_name: string;
                  entry_price: number;
                  current_price?: number;
                  take_profit?: number;
                  stop_loss?: number;
                  budget_eur: number;
                  pnl?: number;
                  pnl_pct?: number;
                  mode: string;
                  opened_at?: string;
                }[]).map((pos) => (
                  <ActivePosition
                    key={pos.id}
                    position={pos}
                    liveUpdate={positionUpdates[pos.id]}
                    onClose={handleClose}
                    closing={closingId === pos.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Opportunity feed */}
          {allOpportunities.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">
                  Kansen {allOpportunities.length > 0 && `(${allOpportunities.length})`}
                </h3>
                <button
                  onClick={() => { setScannedOpportunities([]); clearOpportunities(); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Wis feed
                </button>
              </div>
              <div className="space-y-4">
                {allOpportunities.slice(0, 5).map((opp, i) => {
                  const key = `${opp.asset}-${opp.strategy}-${opp.received_at ?? i}`;
                  return (
                    <OpportunityCard
                      key={key}
                      opportunity={opp}
                      budget={effectiveBudget}
                      onConfirm={handleConfirm}
                      onDismiss={handleDismiss}
                      loading={executing === `${opp.asset}-${opp.strategy}`}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            !scanning && (openPositions as unknown[]).length === 0 && (
              <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-lg">
                <Dice5 size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">Klaar om te gokken</p>
                <p className="text-xs mt-1">Selecteer een strategie, stel je budget in en klik op AI Scan.</p>
                <p className="text-xs mt-0.5">Live kansen verschijnen ook automatisch via WebSocket.</p>
              </div>
            )
          )}
        </div>
      )}

      {/* ===== STRATEGIES TAB ===== */}
      {tab === 'strategies' && (
        <StrategyPicker
          strategies={strategies as {
            name: string;
            display_name: string;
            description: string;
            atr_multiplier_tp: number;
            atr_multiplier_sl: number;
            max_trades_per_day: number;
            max_hold_hours: number;
            total_trades: number;
            wins: number;
            win_rate: number;
            total_pnl: number;
          }[]}
          selected={selectedStrategy}
          onSelect={(name) => { setSelectedStrategy(name); setTab('arena'); }}
        />
      )}

      {/* ===== HISTORY TAB ===== */}
      {tab === 'history' && (
        <HistoryTable history={history as {
          id: string;
          asset: string;
          strategy_name: string;
          entry_price: number;
          current_price?: number;
          budget_eur: number;
          pnl?: number;
          pnl_pct?: number;
          mode: string;
          closed_reason?: string;
          opened_at?: string;
          closed_at?: string;
        }[]} />
      )}

      {/* ===== BACKTEST TAB ===== */}
      {tab === 'backtest' && (
        <BacktestView
          strategies={(strategies as { name: string; display_name: string }[]).map(s => ({
            name: s.name,
            display_name: s.display_name,
          }))}
        />
      )}
    </div>
  );
}
