'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { cn, fmtUSD, fmtPrice } from '@/lib/utils';
import { Dice5, Zap, AlertTriangle, TrendingUp, Brain } from 'lucide-react';

// Meme/volatiele coins op Alpaca
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

const STAKES = [10, 25, 50, 100];

export default function GokPage() {
  const [stake, setStake] = useState(50);
  const [customStake, setCustomStake] = useState('');
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiPicking, setAiPicking] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [aiPick, setAiPick] = useState<{ symbol: string; reason: string; confidence: number } | null>(null);
  const { toast } = useToast();

  const { data: account } = useApi(() => api.getAccount(), []);
  const { data: signals } = useApi(() => api.getSignals(20), []);
  const buyingPower = account?.buying_power ? parseFloat(account.buying_power) : null;
  const effectiveStake = customStake ? Math.max(5, parseFloat(customStake) || 0) : stake;

  // Find AI's most aggressive pending signal
  function findAiPick() {
    if (!signals || !Array.isArray(signals)) return null;
    const pending = (signals as any[]).filter(s => !s.status || s.status === 'pending');
    if (!pending.length) return null;
    // Sort by: risk_reward DESC, then confidence
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
      entry: best.suggested_entry,
      sl: best.suggested_stop,
      tp: best.suggested_take_profit,
      id: best.id,
    };
  }

  async function handleAiKiest() {
    setAiPicking(true);
    setAiPick(null);
    try {
      // Trigger signal generation first
      await api.triggerTask('generate_signals');
      toast('AI analyseert de markt…', 'info');
      // Wait then check signals
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
    if (buyingPower && effectiveStake > buyingPower) { toast('Onvoldoende buying power', 'error'); return; }

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
    const random = MEME_COINS[Math.floor(Math.random() * MEME_COINS.length)];
    setSelectedCoin(random.symbol);
    await handleGok(random.symbol);
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

      {/* Stake */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold">Inzet</p>
        <div className="flex gap-2 flex-wrap">
          {STAKES.map(s => (
            <button key={s} onClick={() => { setStake(s); setCustomStake(''); }}
              className={cn('h-9 px-4 rounded-lg text-sm font-bold transition-all', stake === s && !customStake ? 'bg-amber-500 text-black' : 'bg-muted hover:bg-accent text-foreground')}>
              ${s}
            </button>
          ))}
          <input type="number" placeholder="Eigen" value={customStake} onChange={e => setCustomStake(e.target.value)}
            className="h-9 w-28 px-3 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:border-primary font-num" />
        </div>
        <p className="text-xs text-muted-foreground">Inzet: <span className="font-bold text-foreground font-num">${effectiveStake}</span></p>
      </div>

      {/* Coin grid */}
      <div>
        <p className="text-sm font-semibold mb-3">Kies je coin</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {MEME_COINS.map(coin => (
            <button key={coin.symbol} onClick={() => setSelectedCoin(p => p === coin.symbol ? null : coin.symbol)}
              className={cn(
                'relative rounded-xl border p-2.5 text-left transition-all hover:shadow-md',
                selectedCoin === coin.symbol ? 'border-amber-500 bg-amber-500/10 shadow-md' : 'border-border bg-card hover:border-amber-500/40',
              )}>
              <div className="text-xl mb-1">{coin.emoji}</div>
              <p className="font-bold text-xs">{coin.symbol}</p>
              <p className={cn('text-[9px] mt-0.5', coin.vol === 'Extreem' ? 'text-red-400' : coin.vol === 'Hoog' ? 'text-amber-400' : 'text-muted-foreground')}>
                {coin.vol}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => handleGok()} disabled={loading || !selectedCoin}
          className={cn('h-11 rounded-xl text-sm font-bold transition-all col-span-1 disabled:opacity-50',
            selectedCoin ? 'bg-amber-500 hover:bg-amber-400 text-black' : 'bg-muted text-muted-foreground')}>
          {loading ? '…' : `🎲 Gok`}
        </button>
        <button onClick={handleAiKiest} disabled={aiPicking || loading}
          className="h-11 rounded-xl border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 text-sm font-bold transition-all disabled:opacity-50">
          {aiPicking ? '🧠 …' : '🧠 AI kiest'}
        </button>
        <button onClick={handleRandom} disabled={loading}
          className="h-11 rounded-xl border border-border text-muted-foreground hover:bg-accent text-sm font-bold transition-all disabled:opacity-50">
          <Dice5 size={14} className="inline mr-1" />Random
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={cn('rounded-xl border p-4', result.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5')}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">{result.success ? '✅' : '❌'}</span>
            <p className="font-bold text-sm">{result.success ? `${result.symbol} order geplaatst!` : 'Gok mislukt'}</p>
          </div>
          {result.success ? (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>💰 <span className="font-bold text-foreground font-num">${result.stake}</span> ingezet op <span className="font-bold">{result.symbol}</span></p>
              <p>📊 Status: <span className="text-green-400 font-bold">{result.status}</span></p>
              <p className="text-amber-400/80">Positie zichtbaar op Live pagina → Posities tab</p>
            </div>
          ) : (
            <p className="text-xs text-red-400">{result.error}</p>
          )}
        </div>
      )}

      {/* Info */}
      <div className="bg-muted/20 rounded-xl p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-foreground flex items-center gap-1.5"><AlertTriangle size={12} className="text-amber-400" /> Hoe werkt het?</p>
        <p>• <strong>Zelf kiezen</strong>: selecteer een coin, kies inzet, klik Gok</p>
        <p>• <strong>AI kiest</strong>: AI analyseert en kiest de beste risicovolle setup</p>
        <p>• <strong>Random</strong>: willekeurige coin, puur geluk</p>
        <p>• Positie sluit automatisch na 24 uur of bij SL/TP</p>
        <p>• Alles is paper trading — geen echt geld</p>
      </div>
    </div>
  );
}
