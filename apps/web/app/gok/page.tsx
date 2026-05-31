'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { cn, fmtUSD, fmtPrice } from '@/lib/utils';
import { Dice5, AlertTriangle, Brain, Flame } from 'lucide-react';

const GOK_COINS = [
  { symbol: 'BTC',  name: 'Bitcoin',          emoji: '₿',   vol: 'Gemiddeld' },
  { symbol: 'ETH',  name: 'Ethereum',          emoji: '💎',  vol: 'Gemiddeld' },
  { symbol: 'SOL',  name: 'Solana',            emoji: '☀️',  vol: 'Hoog' },
  { symbol: 'DOGE', name: 'Dogecoin',          emoji: '🐕',  vol: 'Hoog' },
  { symbol: 'AVAX', name: 'Avalanche',         emoji: '🏔️', vol: 'Gemiddeld' },
  { symbol: 'LINK', name: 'Chainlink',         emoji: '⛓️', vol: 'Gemiddeld' },
  { symbol: 'ALGO', name: 'Algorand',          emoji: '🔺',  vol: 'Hoog' },
  { symbol: 'BAT',  name: 'Basic Attention',   emoji: '🦇',  vol: 'Hoog' },
  { symbol: 'CRV',  name: 'Curve DAO',         emoji: '〽️', vol: 'Hoog' },
  { symbol: 'AAVE', name: 'Aave',              emoji: '👻',  vol: 'Hoog' },
];

const STAKES = [10, 25, 50, 100];

export default function GokPage() {
  const [stake, setStake] = useState(50);
  const [customStake, setCustomStake] = useState('');
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [gokStatus, setGokStatus] = useState<{ can_start: boolean; reason: string } | null>(null);
  const { toast } = useToast();

  const { data: account } = useApi(() => api.getAccount(), []);
  const { data: pnl } = useApi(() => api.getPnlSummary(), []);
  const { data: trades } = useApi(() => api.getTrades(50), []);
  const { data: rumours } = useApi(() => api.getRumours(10), []);

  const effectiveStake = customStake ? Math.max(10, parseFloat(customStake) || 0) : stake;
  const buyingPower = account?.buying_power ? parseFloat(account.buying_power) : null;

  // Open gok trades from our own DB (mode=gok, status=open)
  const openGokTrades = Array.isArray(trades)
    ? (trades as any[]).filter((t: any) => t.mode === 'gok' && t.status === 'open')
    : [];

  const totalTrades = (pnl as any)?.total_trades ?? 0;
  const wins = (pnl as any)?.wins ?? 0;
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : null;
  const totalPnl = (pnl as any)?.total_pnl ?? 0;

  const rumourTips = Array.isArray(rumours)
    ? (rumours as any[])
        .filter((r: any) => r.recommendation === 'watch' || r.recommendation === 'paper_trade_only')
        .sort((a: any, b: any) => b.confidence - a.confidence)
        .slice(0, 2)
    : [];

  useEffect(() => {
    const symbols = GOK_COINS.map(c => c.symbol).join(',');
    api.getQuotes(symbols).then((data: any) => {
      if (data && typeof data === 'object') {
        const p: Record<string, number> = {};
        for (const [sym, v] of Object.entries(data)) p[sym] = (v as any).price;
        setPrices(p);
      }
    }).catch(() => {});
    api.getGokStatus().then(setGokStatus).catch(() => {});
  }, []);

  useEffect(() => {
    const sym = new URLSearchParams(window.location.search).get('symbol');
    if (sym) setSelectedCoin(sym.toUpperCase());
  }, []);

  const canGok = gokStatus?.can_start ?? true;

  async function handleAiScan() {
    if (!canGok) { toast(gokStatus?.reason || 'Gok niet mogelijk nu', 'error'); return; }
    setScanning(true);
    setScanResult(null);
    setResult(null);
    try {
      const r = await api.scanGokOpportunity(effectiveStake);
      setScanResult(r);
      if (r.status === 'opportunity_found') {
        setSelectedCoin(r.asset);
        toast(`🎯 AI kiest: ${r.asset} (score ${r.score})`, 'success');
      } else {
        toast(r.message || 'Geen kans gevonden op dit moment', 'info');
      }
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'Scan mislukt'}`, 'error');
    }
    setScanning(false);
  }

  async function handleConfirmGok() {
    if (!scanResult || scanResult.status !== 'opportunity_found') return;
    if (!canGok) { toast(gokStatus?.reason || 'Niet mogelijk', 'error'); return; }
    setLoading(true);
    try {
      const r = await api.executeGok({ asset: scanResult.asset, budget_eur: effectiveStake, price: scanResult.price });
      setResult({ asset: r.asset, stake: effectiveStake, entry_price: r.entry_price, tp: r.take_profit, sl: r.stop_loss, success: true });
      setScanResult(null);
      toast(`🎲 ${r.asset} gok gestart!`, 'success');
      api.getGokStatus().then(setGokStatus).catch(() => {});
    } catch (e: any) {
      setResult({ success: false, error: e?.detail || 'Execute mislukt' });
      toast(`❌ ${e?.detail || 'Execute mislukt'}`, 'error');
    }
    setLoading(false);
  }

  async function handleManualGok() {
    if (!selectedCoin) { toast('Kies een coin', 'error'); return; }
    if (!canGok) { toast(gokStatus?.reason || 'Gok niet mogelijk nu', 'error'); return; }
    const price = prices[selectedCoin];
    if (!price) { toast('Prijs niet beschikbaar, vernieuw de pagina', 'error'); return; }
    setLoading(true);
    setResult(null);
    try {
      const r = await api.executeGok({ asset: selectedCoin, budget_eur: effectiveStake, price });
      setResult({ asset: r.asset, stake: effectiveStake, entry_price: r.entry_price, tp: r.take_profit, sl: r.stop_loss, success: true });
      toast(`🎲 ${r.asset} gok geplaatst!`, 'success');
      api.getGokStatus().then(setGokStatus).catch(() => {});
    } catch (e: any) {
      const msg = e?.detail || 'Order mislukt';
      setResult({ success: false, error: msg });
      toast(`❌ ${msg}`, 'error');
    }
    setLoading(false);
  }

  function handleRandom() {
    const random = GOK_COINS[Math.floor(Math.random() * GOK_COINS.length)];
    setSelectedCoin(random.symbol);
    setScanResult(null);
    toast(`🎲 ${random.symbol} geselecteerd — klik Gok om te bevestigen`, 'info');
  }

  async function handleClosePosition(symbol: string) {
    try {
      await api.closePosition(symbol);
      toast(`✅ ${symbol} positie gesloten`, 'success');
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'Sluiten mislukt'}`, 'error');
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-5 py-1">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-amber-500/10 flex items-center justify-center">
          <Dice5 size={22} className="text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Gok Modus</h1>
          <p className="text-sm text-muted-foreground">AI-gedreven speculatieve one-shot trades</p>
        </div>
        <div className="ml-auto">
          {gokStatus && (
            canGok ? (
              <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full font-semibold">Beschikbaar</span>
            ) : (
              <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-full font-semibold">Geblokkeerd</span>
            )
          )}
        </div>
      </div>

      {/* Blocked banner */}
      {gokStatus && !canGok && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
          🚫 {gokStatus.reason}
        </div>
      )}

      {/* Stats strip */}
      {totalTrades > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-card border border-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Win rate</p>
            <p className={cn('text-lg font-bold font-num', winRate !== null && winRate >= 50 ? 'text-green-400' : 'text-red-400')}>
              {winRate !== null ? `${winRate}%` : '–'}
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">P&L totaal</p>
            <p className={cn('text-lg font-bold font-num', totalPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
              {totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Open gokken</p>
            <p className="text-lg font-bold font-num text-amber-400">{openGokTrades.length}</p>
          </div>
        </div>
      )}

      {/* Buying power */}
      {buyingPower !== null && (
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Beschikbaar kapitaal</p>
            <p className="text-2xl font-bold font-num">{fmtUSD(buyingPower)}</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>TP: +15% | SL: -5%</p>
            <p className="text-amber-400 font-semibold">Max 4 uur hold</p>
          </div>
        </div>
      )}

      {/* AI Scan Result — confirmation card */}
      {scanResult?.status === 'opportunity_found' && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-purple-400" />
            <p className="text-sm font-bold text-purple-400">AI Aanbeveling</p>
            <span className="text-xs text-muted-foreground ml-auto">Score: {scanResult.score}</span>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-2xl font-bold">{scanResult.asset}</p>
            <p className="text-sm font-num text-muted-foreground">@ {fmtPrice(scanResult.price)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2 text-center">
              <p className="text-muted-foreground">Take Profit (+{scanResult.tp_pct}%)</p>
              <p className="font-bold text-green-400 font-num">{fmtPrice(scanResult.take_profit)}</p>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center">
              <p className="text-muted-foreground">Stop Loss (-{scanResult.sl_pct}%)</p>
              <p className="font-bold text-red-400 font-num">{fmtPrice(scanResult.stop_loss)}</p>
            </div>
          </div>
          {scanResult.reason && (
            <p className="text-xs text-muted-foreground leading-relaxed">{scanResult.reason}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setScanResult(null)}
              className="h-10 rounded-xl border border-border text-muted-foreground hover:bg-accent text-sm font-bold transition-colors"
            >
              Annuleer
            </button>
            <button
              onClick={handleConfirmGok}
              disabled={loading}
              className="h-10 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
            >
              {loading ? '…' : `🎲 Bevestig €${effectiveStake}`}
            </button>
          </div>
        </div>
      )}

      {/* Rumour Radar Tips */}
      {rumourTips.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Flame size={14} className="text-orange-400" /> Radar Tips
          </p>
          {rumourTips.map((r: any) => {
            const gokTarget = r.related_assets?.find((a: string) => GOK_COINS.some(c => c.symbol === a));
            return (
              <div key={r.id} className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium leading-snug">
                    {r.title?.slice(0, 70)}{r.title?.length > 70 ? '…' : ''}
                  </p>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
                    {r.related_assets?.slice(0, 3).map((a: string) => (
                      <span key={a} className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-bold">{a}</span>
                    ))}
                    <span className="text-[10px] text-orange-400 font-semibold">{(r.confidence * 100).toFixed(0)}% conf</span>
                  </div>
                </div>
                {gokTarget && (
                  <button
                    onClick={() => { setSelectedCoin(gokTarget); setScanResult(null); toast(`📡 ${gokTarget} geselecteerd`, 'info'); }}
                    className="shrink-0 text-[11px] font-bold bg-orange-500 hover:bg-orange-400 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    Kies
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Budget */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold">Budget (EUR)</p>
        <div className="flex gap-2 flex-wrap">
          {STAKES.map(s => (
            <button key={s} onClick={() => { setStake(s); setCustomStake(''); setScanResult(null); }}
              className={cn('h-9 px-4 rounded-lg text-sm font-bold transition-all',
                stake === s && !customStake ? 'bg-amber-500 text-black' : 'bg-muted hover:bg-accent text-foreground')}>
              €{s}
            </button>
          ))}
          <input
            type="number" placeholder="Eigen" value={customStake}
            onChange={e => { setCustomStake(e.target.value); setScanResult(null); }}
            className="h-9 w-28 px-3 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:border-primary font-num"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Budget: <span className="font-bold text-foreground font-num">€{effectiveStake}</span> — TP +15% / SL -5% / max 4 uur
        </p>
      </div>

      {/* Coin grid — manual pick */}
      <div>
        <p className="text-sm font-semibold mb-3">Handmatig kiezen</p>
        <div className="grid grid-cols-5 gap-2">
          {GOK_COINS.map(coin => (
            <button
              key={coin.symbol}
              onClick={() => { setSelectedCoin(p => p === coin.symbol ? null : coin.symbol); setScanResult(null); }}
              className={cn(
                'relative rounded-xl border p-2.5 text-left transition-all hover:shadow-md',
                selectedCoin === coin.symbol && !scanResult
                  ? 'border-amber-500 bg-amber-500/10 shadow-md'
                  : 'border-border bg-card hover:border-amber-500/40',
              )}
            >
              <div className="text-xl mb-1">{coin.emoji}</div>
              <p className="font-bold text-xs">{coin.symbol}</p>
              <p className={cn('text-[9px] mt-0.5',
                coin.vol === 'Extreem' ? 'text-red-400' : coin.vol === 'Hoog' ? 'text-amber-400' : 'text-muted-foreground')}>
                {coin.vol}
              </p>
              {prices[coin.symbol] != null && (
                <p className="text-[9px] text-muted-foreground font-num mt-0.5 tabular-nums">
                  {fmtPrice(prices[coin.symbol])}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={handleManualGok}
          disabled={loading || !selectedCoin || !canGok || scanning}
          className={cn('h-11 rounded-xl text-sm font-bold transition-all disabled:opacity-50',
            selectedCoin && canGok ? 'bg-amber-500 hover:bg-amber-400 text-black' : 'bg-muted text-muted-foreground')}>
          {loading ? '…' : '🎲 Gok'}
        </button>
        <button
          onClick={handleAiScan}
          disabled={scanning || loading || !canGok}
          className="h-11 rounded-xl border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 text-sm font-bold transition-all disabled:opacity-50">
          {scanning ? '🧠 Scant…' : '🧠 AI kiest'}
        </button>
        <button
          onClick={handleRandom}
          disabled={loading || scanning}
          className="h-11 rounded-xl border border-border text-muted-foreground hover:bg-accent text-sm font-bold transition-all disabled:opacity-50">
          <Dice5 size={14} className="inline mr-1" />
          Random
        </button>
      </div>

      {/* Execution result */}
      {result && (
        <div className={cn('rounded-xl border p-4',
          result.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5')}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">{result.success ? '✅' : '❌'}</span>
            <p className="font-bold text-sm">{result.success ? `${result.asset} gok gestart!` : 'Gok mislukt'}</p>
          </div>
          {result.success ? (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>💰 <span className="font-bold text-foreground font-num">€{result.stake}</span> ingezet op <span className="font-bold">{result.asset}</span> @ {fmtPrice(result.entry_price)}</p>
              <p>🎯 TP: <span className="text-green-400 font-bold font-num">{fmtPrice(result.tp)}</span> — 🛑 SL: <span className="text-red-400 font-bold font-num">{fmtPrice(result.sl)}</span></p>
              <p className="text-amber-400">⏱ Automatisch gesloten bij SL/TP of na 4 uur</p>
            </div>
          ) : (
            <p className="text-xs text-red-400">{result.error}</p>
          )}
        </div>
      )}

      {/* Open gok posities */}
      {openGokTrades.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold">Open gok posities</p>
          </div>
          {openGokTrades.map((trade: any) => {
            const currentPrice = prices[trade.symbol] || trade.entry_price;
            const pnlEst = trade.quantity ? (currentPrice - trade.entry_price) * trade.quantity : null;
            return (
              <div key={trade.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0">
                <p className="font-bold text-sm w-14">{trade.symbol}</p>
                <div className="flex-1 text-xs text-muted-foreground font-num">
                  <p>@ {fmtPrice(trade.entry_price)}</p>
                  <p className="text-[10px]">TP {fmtPrice(trade.take_profit)} / SL {fmtPrice(trade.stop_loss)}</p>
                </div>
                {pnlEst !== null && (
                  <p className={cn('text-xs font-bold font-num', pnlEst >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {pnlEst >= 0 ? '+' : ''}{fmtUSD(pnlEst)}
                  </p>
                )}
                <button
                  onClick={() => handleClosePosition(trade.symbol)}
                  className="text-[11px] font-bold text-muted-foreground hover:text-red-400 border border-border hover:border-red-400/40 px-2 py-1 rounded-lg transition-colors"
                >
                  Sluit
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Info */}
      <div className="bg-muted/20 rounded-xl p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-foreground flex items-center gap-1.5">
          <AlertTriangle size={12} className="text-amber-400" /> Hoe werkt het?
        </p>
        <p>• <strong>AI kiest</strong>: scant nieuws, social hype & TA — toont beste kans met TP/SL — jij bevestigt</p>
        <p>• <strong>Zelf kiezen</strong>: selecteer coin, klik Gok — TP +15% en SL -5% automatisch ingesteld</p>
        <p>• <strong>Random</strong>: willekeurige coin selecteren, dan handmatig bevestigen via Gok</p>
        <p>• Max 2 gok sessies per dag — max 1 tegelijk open</p>
        <p>• Positie sluit automatisch na 4 uur of bij SL/TP hit</p>
      </div>
    </div>
  );
}
