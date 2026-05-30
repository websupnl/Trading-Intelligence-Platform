'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/contexts/toast';
import { cn, fmtUSD } from '@/lib/utils';
import { Zap, AlertTriangle, TrendingUp, Dice5 } from 'lucide-react';

// Meme coins beschikbaar op Alpaca paper trading
const MEME_COINS = [
  { symbol: 'DOGE', name: 'Dogecoin', emoji: '🐕', desc: 'De OG meme coin' },
  { symbol: 'ALGO', name: 'Algorand', emoji: '🔺', desc: 'Kleine cap, volatiel' },
  { symbol: 'BAT', name: 'Basic Attention', emoji: '🦇', desc: 'Hoge volatiliteit' },
  { symbol: 'CRV', name: 'Curve DAO', emoji: '〽️', desc: 'DeFi wild card' },
  { symbol: 'SUSHI', name: 'SushiSwap', emoji: '🍣', desc: 'Food coin klassiek' },
  { symbol: 'YFI', name: 'Yearn Finance', emoji: '🏦', desc: 'DeFi speculatie' },
  { symbol: 'UNI', name: 'Uniswap', emoji: '🦄', desc: 'DEX governance' },
  { symbol: 'LINK', name: 'Chainlink', emoji: '⛓️', desc: 'Oracle play' },
];

const STAKES = [25, 50, 100, 200];

function PriceTag({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
      <p className={cn('text-sm font-bold font-num tabular-nums', color)}>{value}</p>
    </div>
  );
}

export default function GokPage() {
  const [stake, setStake] = useState(50);
  const [customStake, setCustomStake] = useState('');
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const { toast } = useToast();

  const { data: account } = useApi(() => api.getAccount(), []);
  const buyingPower = account?.buying_power ? parseFloat(account.buying_power) : null;

  const effectiveStake = customStake ? parseFloat(customStake) || 0 : stake;

  async function handleGok(symbol?: string) {
    const target = symbol || selectedCoin;
    if (!target) { toast('Kies eerst een coin', 'error'); return; }
    if (effectiveStake < 5) { toast('Minimaal $5 inzet', 'error'); return; }
    if (buyingPower && effectiveStake > buyingPower) { toast('Onvoldoende buying power', 'error'); return; }

    setLoading(true);
    setLastResult(null);
    try {
      // Trigger signal generation for specific coin, then immediately trade
      const result = await api.submitPaperOrder({
        symbol: target,
        side: 'buy',
        notional: effectiveStake,
        order_type: 'market',
        override_risk: true,
      });
      setLastResult({ symbol: target, stake: effectiveStake, result, success: true });
      toast(`🎲 ${target} gok geplaatst voor $${effectiveStake}!`, 'success');
    } catch (e: any) {
      const msg = e?.detail?.reasons?.join(', ') || e?.detail || 'Gok mislukt';
      setLastResult({ symbol: target, stake: effectiveStake, error: msg, success: false });
      toast(`❌ ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRandomGok() {
    const random = MEME_COINS[Math.floor(Math.random() * MEME_COINS.length)];
    await handleGok(random.symbol);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-2">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <Dice5 size={20} className="text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Gok Modus</h1>
          <p className="text-sm text-muted-foreground">High-risk meme coin trades — alleen paper money</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-full">
          <AlertTriangle size={12} /> Paper Trading
        </div>
      </div>

      {/* Buying power */}
      {buyingPower !== null && (
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Beschikbaar</p>
            <p className="text-2xl font-bold font-num">{fmtUSD(buyingPower)}</p>
          </div>
          <div className="ml-auto text-xs text-muted-foreground text-right">
            <p>Paper account</p>
            <p className="text-amber-400">Geen echt geld</p>
          </div>
        </div>
      )}

      {/* Stake selector */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold">Inzet kiezen</p>
        <div className="flex gap-2 flex-wrap">
          {STAKES.map(s => (
            <button
              key={s}
              onClick={() => { setStake(s); setCustomStake(''); }}
              className={cn(
                'h-9 px-4 rounded-lg text-sm font-bold transition-all',
                stake === s && !customStake
                  ? 'bg-amber-500 text-black'
                  : 'bg-muted hover:bg-accent text-foreground',
              )}
            >
              ${s}
            </button>
          ))}
          <input
            type="number"
            placeholder="Eigen bedrag"
            value={customStake}
            onChange={e => setCustomStake(e.target.value)}
            className="h-9 w-32 px-3 rounded-lg text-sm bg-muted border border-border focus:outline-none focus:border-primary font-num"
          />
        </div>
        <p className={cn('text-xs', effectiveStake > 200 ? 'text-amber-400' : 'text-muted-foreground')}>
          {effectiveStake > 200
            ? `⚠️ Hoge inzet: $${effectiveStake} — weet je het zeker?`
            : `Inzet: $${effectiveStake} paper money`}
        </p>
      </div>

      {/* Coin grid */}
      <div>
        <p className="text-sm font-semibold mb-3">Kies een coin</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {MEME_COINS.map(coin => (
            <button
              key={coin.symbol}
              onClick={() => setSelectedCoin(prev => prev === coin.symbol ? null : coin.symbol)}
              className={cn(
                'relative rounded-xl border p-3 text-left transition-all hover:shadow-md',
                selectedCoin === coin.symbol
                  ? 'border-amber-500 bg-amber-500/10 shadow-md'
                  : 'border-border bg-card hover:border-amber-500/40',
              )}
            >
              <div className="text-2xl mb-1">{coin.emoji}</div>
              <p className="font-bold text-sm">{coin.symbol}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">{coin.name}</p>
              <p className="text-[9px] text-muted-foreground/60 mt-0.5 italic">{coin.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => handleGok()}
          disabled={loading || !selectedCoin}
          className={cn(
            'flex-1 h-12 rounded-xl font-bold text-sm transition-all disabled:opacity-50',
            selectedCoin
              ? 'bg-amber-500 hover:bg-amber-400 text-black'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {loading ? '⏳ Plaatsen…' : selectedCoin ? `🎲 Gok $${effectiveStake} op ${selectedCoin}` : 'Kies een coin'}
        </button>
        <button
          onClick={handleRandomGok}
          disabled={loading}
          className="h-12 px-5 rounded-xl border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-all disabled:opacity-50 font-bold text-sm"
        >
          <Dice5 size={16} className="inline mr-1.5" />
          Willekeurig
        </button>
      </div>

      {/* Result */}
      {lastResult && (
        <div className={cn(
          'rounded-xl border p-4 space-y-3',
          lastResult.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5',
        )}>
          <div className="flex items-center gap-2">
            <span className="text-xl">{lastResult.success ? '✅' : '❌'}</span>
            <div>
              <p className="font-bold text-sm">
                {lastResult.success ? `${lastResult.symbol} order geplaatst!` : 'Gok mislukt'}
              </p>
              <p className="text-xs text-muted-foreground">
                {lastResult.success ? `$${lastResult.stake} ingezet op ${lastResult.symbol}` : lastResult.error}
              </p>
            </div>
          </div>
          {lastResult.success && lastResult.result && (
            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border/50">
              <PriceTag label="Status" value={lastResult.result.status || '—'} color="text-green-400" />
              <PriceTag label="Ingezet" value={fmtUSD(lastResult.stake)} color="text-foreground" />
              <PriceTag label="Asset" value={lastResult.symbol} color="text-amber-400" />
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            💡 Positie is zichtbaar op de Live pagina onder &quot;Posities&quot;
          </p>
        </div>
      )}

      {/* Info */}
      <div className="bg-muted/30 rounded-xl p-4 space-y-2 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground flex items-center gap-2"><AlertTriangle size={13} className="text-amber-400" /> Hoe werkt het?</p>
        <ul className="space-y-1 list-none">
          <li>• Je koopt direct op marktprijs — geen AI analyse, pure gok</li>
          <li>• Positie wordt automatisch gesloten na 36 uur (via stop-loss of time)</li>
          <li>• Alles is paper trading — geen echt geld op het spel</li>
          <li>• Wil je AI de beste gok laten kiezen? Ga naar <strong>Live</strong> → Signalen</li>
        </ul>
      </div>
    </div>
  );
}
