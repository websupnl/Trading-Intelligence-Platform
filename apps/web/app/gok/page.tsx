'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { cn, fmtUSD, fmtPrice } from '@/lib/utils';
import { Dice5, AlertTriangle, Brain, Flame } from 'lucide-react';

const MEME_COINS = [
  { symbol: 'DOGE', name: 'Dogecoin', emoji: '🐕', vol: 'Hoog' },
  { symbol: 'ALGO', name: 'Algorand', emoji: '🔺', vol: 'Hoog' },
  { symbol: 'BAT', name: 'Basic Attention', emoji: '🦇', vol: 'Hoog' },
  { symbol: 'CRV', name: 'Curve DAO', emoji: '〽️', vol: 'Hoog' },
  { symbol: 'SUSHI', name: 'SushiSwap', emoji: '🍣', vol: 'Extreem' },
  { symbol: 'YFI', name: 'Yearn Finance', emoji: '🏦', vol: 'Extreem' },
  { symbol: 'UNI', name: 'Uniswap', emoji: '🦄', vol: 'Gemiddeld' },
  { symbol: 'LINK', name: 'Chainlink', emoji: '⛓️', vol: 'Gemiddeld' },
  { symbol: 'AVAX', name: 'Avalanche', emoji: '🏔️', vol: 'Gemiddeld' },
  { symbol: 'SOL', name: 'Solana', emoji: '☀️', vol: 'Hoog' },
];

const MEME_COIN_SET = new Set(MEME_COINS.map(c => c.symbol));
const STAKES = [10, 25, 50, 100];

export default function GokPage() {
  const [stake, setStake] = useState(50);
  const [customStake, setCustomStake] = useState('');
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiPicking, setAiPicking] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [aiPick, setAiPick] = useState<any | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [rolling, setRolling] = useState(false);
  const { toast } = useToast();

  const { data: account } = useApi(() => api.getAccount(), []);
  const { data: signals } = useApi(() => api.getSignals(20), []);
  const { data: pnl } = useApi(() => api.getPnlSummary(), []);
  const { data: rumours } = useApi(() => api.getRumours(10), []);
  const { data: positions } = useApi(() => api.getPositions(), []);

  const buyingPower = account?.buying_power ? parseFloat(account.buying_power) : null;
  const effectiveStake = customStake ? Math.max(5, parseFloat(customStake) || 0) : stake;

  // Batch price fetch
  useEffect(() => {
    const symbols = MEME_COINS.map(c => c.symbol).join(',');
    api.getQuotes(symbols).then((data: any) => {
      if (data && typeof data === 'object') {
        const p: Record<string, number> = {};
        for (const [sym, v] of Object.entries(data)) {
          p[sym] = (v as any).price;
        }
        setPrices(p);
      }
    }).catch(() => {});
  }, []);

  // Pre-select coin from URL param (e.g. /gok?symbol=DOGE)
  useEffect(() => {
    const sym = new URLSearchParams(window.location.search).get('symbol');
    if (sym) setSelectedCoin(sym.toUpperCase());
  }, []);

  // Stats
  const totalTrades = (pnl as any)?.total_trades ?? 0;
  const wins = (pnl as any)?.wins ?? 0;
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : null;
  const totalPnl = (pnl as any)?.total_pnl ?? 0;

  // Rumour tips: top 2 non-avoid tips with a gok-compatible asset
  const rumourTips = Array.isArray(rumours)
    ? (rumours as any[])
        .filter(r => r.recommendation === 'watch' || r.recommendation === 'paper_trade_only')
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 2)
    : [];

  // Open positions for meme coins
  const openGokPositions = Array.isArray(positions)
    ? (positions as any[]).filter(p => MEME_COIN_SET.has((p.symbol || '').replace('/USD', '')))
    : [];

  function findAiPick() {
    if (!signals || !Array.isArray(signals)) return null;
    const pending = (signals as any[]).filter(s => !s.status || s.status === 'pending');
    if (!pending.length) return null;
    const sorted = [...pending].sort((a, b) => {
      const rrA = a.risk_reward || 0;
      const rrB = b.risk_reward || 0;
      if (rrB !== rrA) return rrB - rrA;
      return b.confidence - a.confidence;
    });
    const best = sorted[0];
    return {
      symbol: best.asset,
      reason: best.reason?.slice(0, 150) || 'Beste R/R setup op dit moment',
      confidence: best.confidence,
      rr: best.risk_reward,
    };
  }

  async function handleAiKiest() {
    setAiPicking(true);
    setAiPick(null);
    try {
      await api.triggerTask('generate_signals');
      toast('AI analyseert de markt…', 'info');
      await new Promise(r => setTimeout(r, 8000));
      const fresh = await api.getSignals(20) as any[];
      if (Array.isArray(fresh)) {
        const pending = fresh.filter((s: any) => !s.status || s.status === 'pending');
        if (pending.length > 0) {
          const best = [...pending].sort((a: any, b: any) => (b.risk_reward || 0) - (a.risk_reward || 0))[0];
          setAiPick({ symbol: best.asset, reason: best.reason?.slice(0, 200) || 'Sterkste technische setup', confidence: best.confidence });
          setSelectedCoin(best.asset);
          toast(`🎯 AI kiest: ${best.asset}`, 'success');
        } else {
          toast('AI vindt nu geen goede gok-setup — probeer later', 'info');
        }
      }
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'AI fout'}`, 'error');
    }
    setAiPicking(false);
  }

  async function handleGok(sym?: string) {
    const target = sym || selectedCoin;
    if (!target) { toast('Kies een coin', 'error'); return; }
    if (effectiveStake < 5) { toast('Minimaal $5', 'error'); return; }
    if (buyingPower !== null && effectiveStake > buyingPower) { toast('Onvoldoende buying power', 'error'); return; }

    setLoading(true);
    setResult(null);
    try {
      const r = await api.submitPaperOrder({
        symbol: target,
        side: 'buy',
        notional: effectiveStake,
        order_type: 'market',
      });
      setResult({ symbol: target, stake: effectiveStake, status: r.status, success: true });
      toast(`🎲 ${target} gok geplaatst voor $${effectiveStake}!`, 'success');
    } catch (e: any) {
      const msg = e?.detail?.reasons?.join(', ') || e?.detail || 'Order mislukt';
      setResult({ symbol: target, stake: effectiveStake, error: msg, success: false });
      toast(`❌ ${msg}`, 'error');
    }
    setLoading(false);
  }

  async function handleRandom() {
    setRolling(true);
    setTimeout(() => setRolling(false), 600);
    const random = MEME_COINS[Math.floor(Math.random() * MEME_COINS.length)];
    setSelectedCoin(random.symbol);
    await handleGok(random.symbol);
  }

  async function handleClosePosition(symbol: string) {
    try {
      await api.closePosition(symbol);
      toast(`✅ ${symbol} positie gesloten`, 'success');
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'Sluiten mislukt'}`, 'error');
    }
  }

  const currentAiPick = aiPick || findAiPick() as any;

  return (
    <div className="max-w-xl mx-auto space-y-5 py-1">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-amber-500/10 flex items-center justify-center">
          <Dice5 size={22} className="text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Gok Modus</h1>
          <p className="text-sm text-muted-foreground">AI of jijzelf — risicovolle crypto plays</p>
        </div>
        <div className="ml-auto text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full font-semibold">
          📄 Paper
        </div>
      </div>

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
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Gokken</p>
            <p className="text-lg font-bold font-num text-amber-400">{totalTrades}</p>
          </div>
        </div>
      )}

      {/* Buying power */}
      {buyingPower !== null && (
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Beschikbaar om te gokken</p>
            <p className="text-2xl font-bold font-num">{fmtUSD(buyingPower)}</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>Paper trading</p>
            <p className="text-amber-400 font-semibold">Geen echt geld</p>
          </div>
        </div>
      )}

      {/* AI Pick banner */}
      {currentAiPick && (
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-purple-400" />
            <p className="text-sm font-bold text-purple-400">AI Aanbeveling</p>
            <span className="text-xs text-muted-foreground ml-auto">{(currentAiPick.confidence * 100).toFixed(0)}% conf</span>
          </div>
          <p className="text-sm font-bold">{currentAiPick.symbol}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{currentAiPick.reason}</p>
          <button
            onClick={() => { setSelectedCoin(currentAiPick.symbol); handleGok(currentAiPick.symbol); }}
            disabled={loading}
            className="w-full h-9 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
          >
            {loading ? '…' : `🎲 Gok $${effectiveStake} op AI-keuze (${currentAiPick.symbol})`}
          </button>
        </div>
      )}

      {/* Rumour Radar Tips */}
      {rumourTips.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Flame size={14} className="text-orange-400" /> Radar Tips
          </p>
          {rumourTips.map((r: any) => {
            const gokTarget = r.related_assets?.find((a: string) => MEME_COIN_SET.has(a));
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
                    onClick={() => { setSelectedCoin(gokTarget); toast(`📡 ${gokTarget} geselecteerd via Radar`, 'info'); }}
                    className="shrink-0 text-[11px] font-bold bg-orange-500 hover:bg-orange-400 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    🎲 Kies
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Stake */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold">Inzet</p>
        <div className="flex gap-2 flex-wrap">
          {STAKES.map(s => (
            <button key={s} onClick={() => { setStake(s); setCustomStake(''); }}
              className={cn('h-9 px-4 rounded-lg text-sm font-bold transition-all',
                stake === s && !customStake ? 'bg-amber-500 text-black' : 'bg-muted hover:bg-accent text-foreground')}>
              ${s}
            </button>
          ))}
          <input
            type="number" placeholder="Eigen" value={customStake}
            onChange={e => setCustomStake(e.target.value)}
            className="h-9 w-28 px-3 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:border-primary font-num"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Inzet: <span className="font-bold text-foreground font-num">${effectiveStake}</span>
        </p>
      </div>

      {/* Coin grid */}
      <div>
        <p className="text-sm font-semibold mb-3">Kies je coin</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {MEME_COINS.map(coin => (
            <button
              key={coin.symbol}
              onClick={() => setSelectedCoin(p => p === coin.symbol ? null : coin.symbol)}
              className={cn(
                'relative rounded-xl border p-2.5 text-left transition-all hover:shadow-md',
                selectedCoin === coin.symbol
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
          onClick={() => handleGok()}
          disabled={loading || !selectedCoin}
          className={cn('h-11 rounded-xl text-sm font-bold transition-all disabled:opacity-50',
            selectedCoin ? 'bg-amber-500 hover:bg-amber-400 text-black' : 'bg-muted text-muted-foreground')}>
          {loading ? '…' : '🎲 Gok'}
        </button>
        <button
          onClick={handleAiKiest}
          disabled={aiPicking || loading}
          className="h-11 rounded-xl border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 text-sm font-bold transition-all disabled:opacity-50">
          {aiPicking ? '🧠 …' : '🧠 AI kiest'}
        </button>
        <button
          onClick={handleRandom}
          disabled={loading}
          className="h-11 rounded-xl border border-border text-muted-foreground hover:bg-accent text-sm font-bold transition-all disabled:opacity-50">
          <Dice5 size={14} className={cn('inline mr-1 transition-transform duration-500', rolling && 'animate-spin')} />
          Random
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={cn('rounded-xl border p-4',
          result.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5')}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">{result.success ? '✅' : '❌'}</span>
            <p className="font-bold text-sm">{result.success ? `${result.symbol} order geplaatst!` : 'Gok mislukt'}</p>
          </div>
          {result.success ? (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>💰 <span className="font-bold text-foreground font-num">${result.stake}</span> ingezet op <span className="font-bold">{result.symbol}</span></p>
              <p>📊 Status: <span className="text-green-400 font-bold">{result.status}</span></p>
            </div>
          ) : (
            <p className="text-xs text-red-400">{result.error}</p>
          )}
        </div>
      )}

      {/* Open gok posities */}
      {openGokPositions.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold">Open posities</p>
          </div>
          {openGokPositions.map((pos: any) => {
            const sym = (pos.symbol || '').replace('/USD', '');
            const plVal = parseFloat(pos.unrealized_pl || '0');
            return (
              <div key={pos.symbol} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0">
                <p className="font-bold text-sm w-14">{sym}</p>
                <p className="text-xs text-muted-foreground font-num flex-1">{fmtUSD(parseFloat(pos.market_value || '0'))}</p>
                <p className={cn('text-xs font-bold font-num', plVal >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {plVal >= 0 ? '+' : ''}{fmtUSD(plVal)}
                </p>
                <button
                  onClick={() => handleClosePosition(pos.symbol)}
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
        <p>• <strong>Zelf kiezen</strong>: selecteer een coin, kies inzet, klik Gok</p>
        <p>• <strong>AI kiest</strong>: AI analyseert en kiest de beste risicovolle setup</p>
        <p>• <strong>Random</strong>: willekeurige coin, puur geluk (dobbelsteen draait 🎲)</p>
        <p>• <strong>Radar Tips</strong>: geruchten uit Rumour Radar met Gok knop</p>
        <p>• Positie sluit automatisch na 24 uur of bij SL/TP</p>
        <p>• Alles is paper trading — geen echt geld</p>
      </div>
    </div>
  );
}
