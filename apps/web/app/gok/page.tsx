'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Brain, Search, Zap, Play, Loader2, AlertTriangle, Dice5 } from 'lucide-react';

const C = {
  bg: '#0b0e13', panel: '#12161c', panel2: '#171c24', line: '#1e2630',
  text: '#eaeef3', sub: '#7a8694', faint: '#4a5563',
  up: '#2ebd85', down: '#f6465d', gold: '#f0b90b',
};
const API = process.env.NEXT_PUBLIC_API_URL || '';

type Decision = {
  action?: string; conviction?: number; stake_pct?: number; stake_eur?: number;
  thesis?: string; catalyst?: string; stop_loss?: number; take_profit?: number;
  time_horizon?: string; key_risk?: string; cost_usd?: number; asset?: string; price?: number;
};

export default function GokWarRoom() {
  const [asset, setAsset] = useState('');
  const [bankroll, setBankroll] = useState('100');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [target, setTarget] = useState('');
  const [thoughts, setThoughts] = useState('');
  const [searches, setSearches] = useState<string[]>([]);
  const [sources, setSources] = useState<{ url: string; title: string }[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight }); }, [thoughts]);
  useEffect(() => () => { esRef.current?.close(); }, []);

  const go = useCallback(() => {
    esRef.current?.close();
    setRunning(true); setPhase('verbinden…'); setThoughts(''); setSearches([]); setSources([]);
    setDecision(null); setCost(null); setError(null); setTarget(asset.trim().toUpperCase());

    const pin = typeof window !== 'undefined' ? sessionStorage.getItem('dashboard_pin') || '' : '';
    const qs = new URLSearchParams();
    if (asset.trim()) qs.set('asset', asset.trim().toUpperCase());
    qs.set('bankroll', bankroll || '100');
    if (pin) qs.set('pin', pin);
    const es = new EventSource(`${API}/api/gok/think?${qs.toString()}`);
    esRef.current = es;

    es.onmessage = (e) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      switch (d.type) {
        case 'start': setTarget(d.asset); setPhase('het brein gaat aan de slag…'); break;
        case 'phase': setPhase(d.phase === 'research' ? `onderzoekt ${d.asset}…` : d.phase); break;
        case 'thinking': setThoughts(t => t + d.text); break;
        case 'text': setThoughts(t => t + d.text); break;
        case 'search': setSearches(s => [...s, d.query].slice(-12)); setPhase('zoekt op het web…'); break;
        case 'sources': setSources(d.items || []); break;
        case 'decision': setDecision(d); setPhase('beslist…'); break;
        case 'cost': setCost(d.usd); break;
        case 'error': setError(d.message || 'Onbekende fout'); break;
        case 'done': setPhase(''); setRunning(false); es.close(); break;
      }
    };
    es.onerror = () => { setRunning(false); es.close(); setError(prev => prev || 'Verbinding verbroken'); };
  }, [asset, bankroll]);

  const isBet = decision?.action === 'bet';
  const conv = decision?.conviction ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {/* Control bar */}
      <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
        <div className="mb-3 flex items-center gap-2">
          <Dice5 size={18} style={{ color: C.gold }} />
          <span className="font-semibold" style={{ color: C.text }}>Gok War-Room</span>
          <span className="text-[11px]" style={{ color: C.faint }}>— het brein gokt slim, jij kijkt mee</span>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[120px] flex-1">
            <span className="text-[10px] uppercase tracking-wide" style={{ color: C.sub }}>Asset (leeg = AI kiest)</span>
            <input value={asset} onChange={e => setAsset(e.target.value.toUpperCase())} placeholder="auto"
              className="mt-1 w-full rounded-lg px-3 py-2.5 text-sm uppercase outline-none"
              style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.text }} />
          </label>
          <label className="w-28">
            <span className="text-[10px] uppercase tracking-wide" style={{ color: C.sub }}>Bankroll €</span>
            <input value={bankroll} onChange={e => setBankroll(e.target.value)} type="number" min="10"
              className="mt-1 w-full rounded-lg px-3 py-2.5 text-sm font-num outline-none"
              style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.text }} />
          </label>
          <button onClick={go} disabled={running}
            className="flex h-[42px] items-center gap-2 rounded-lg px-6 text-sm font-bold disabled:opacity-60"
            style={{ background: C.gold, color: '#221a00' }}>
            {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {running ? 'Bezig…' : 'GO'}
          </button>
        </div>
      </div>

      {/* Status line */}
      {(running || phase) && (
        <div className="flex items-center gap-2 px-1 text-xs" style={{ color: C.gold }}>
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: C.gold }} /><span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: C.gold }} /></span>
          {target && <span className="font-semibold" style={{ color: C.text }}>{target}</span>}
          <span style={{ color: C.sub }}>{phase}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
        {/* Thought stream */}
        <div className="overflow-hidden rounded-2xl" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: `1px solid ${C.line}` }}>
            <Brain size={14} style={{ color: C.sub }} />
            <span className="text-xs font-semibold" style={{ color: C.text }}>Gedachten</span>
          </div>
          <div ref={streamRef} className="h-[340px] overflow-y-auto whitespace-pre-wrap px-4 py-3 font-mono text-[12px] leading-relaxed" style={{ color: C.sub }}>
            {thoughts}
            {!thoughts && !running && <span style={{ color: C.faint }}>Druk op GO — het brein begint te denken, onderzoekt het web, en kiest zelf een inzet.</span>}
            {running && <span className="ml-0.5 inline-block h-3.5 w-2 animate-pulse align-middle" style={{ background: C.gold }} />}
          </div>
          {searches.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 py-2.5" style={{ borderTop: `1px solid ${C.line}` }}>
              {searches.map((q, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px]" style={{ background: C.panel2, color: C.sub }}>
                  <Search size={9} /> {q.length > 36 ? q.slice(0, 36) + '…' : q}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Verdict */}
        <div className="space-y-3">
          {error && (
            <div className="rounded-2xl p-4 text-sm" style={{ background: C.down + '14', border: `1px solid ${C.down}44`, color: C.text }}>
              <div className="mb-1 flex items-center gap-2 font-semibold" style={{ color: C.down }}><AlertTriangle size={15} /> Brein-fout</div>
              <p style={{ color: C.sub }}>{error}</p>
              {/credit|balance/i.test(error) && <p className="mt-2 text-xs" style={{ color: C.gold }}>→ Anthropic-tegoed bijvullen op console.anthropic.com → Plans &amp; Billing.</p>}
            </div>
          )}

          {decision && (
            <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${isBet ? C.up : C.line}` }}>
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded-full px-3 py-1 text-sm font-bold" style={{ background: (isBet ? C.up : C.faint) + '1a', color: isBet ? C.up : C.sub }}>
                  {isBet ? '▲ BET' : '— PASS'}
                </span>
                <Gauge value={conv} />
              </div>
              {isBet && (
                <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                  <Cell label="Inzet" value={decision?.stake_eur != null ? `€${decision.stake_eur}` : '—'} tone={C.gold} sub={decision?.stake_pct != null ? `${decision.stake_pct}%` : ''} />
                  <Cell label="Stop" value={decision?.stop_loss != null ? `$${decision.stop_loss}` : '—'} tone={C.down} />
                  <Cell label="Target" value={decision?.take_profit != null ? `$${decision.take_profit}` : '—'} tone={C.up} />
                </div>
              )}
              {decision?.catalyst && <p className="mb-2 text-xs" style={{ color: C.gold }}>⚡ {decision.catalyst}</p>}
              {decision?.thesis && <p className="text-[13px] leading-relaxed" style={{ color: C.text }}>{decision.thesis}</p>}
              {decision?.key_risk && <p className="mt-2 text-xs" style={{ color: C.sub }}>Risico: {decision.key_risk}</p>}
              <div className="mt-3 flex items-center justify-between text-[11px]" style={{ color: C.faint }}>
                <span>{decision?.time_horizon ? `horizon: ${decision.time_horizon}` : ''}</span>
                {cost != null && <span className="font-num">kosten ${cost.toFixed(4)}</span>}
              </div>
            </div>
          )}

          {sources.length > 0 && (
            <div className="rounded-2xl p-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <div className="mb-1.5 text-[11px] font-semibold" style={{ color: C.sub }}>Bronnen ({sources.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {sources.map((s, i) => (
                  <a key={i} href={s.url} target="_blank" rel="noreferrer"
                    className="max-w-[180px] truncate rounded px-2 py-0.5 text-[10px]" style={{ background: C.panel2, color: C.sub }}>
                    {s.title || hostname(s.url)}
                  </a>
                ))}
              </div>
            </div>
          )}

          {!decision && !error && !running && (
            <div className="rounded-2xl p-6 text-center text-xs" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.faint }}>
              <Zap size={20} className="mx-auto mb-2" style={{ color: C.gold }} />
              De AI bepaalt zélf de inzet op basis van conviction. Hoe sterker de edge, hoe groter de gok (max 35% van je bankroll).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function hostname(u: string) { try { return new URL(u).hostname; } catch { return u; } }

function Gauge({ value }: { value: number }) {
  const hue = Math.round((value / 100) * 120);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-10 w-10">
        <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#1e2630" strokeWidth="3" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke={`hsl(${hue} 65% 50%)`} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(value / 100) * 97.4} 97.4`} />
        </svg>
        <span className="absolute inset-0 grid place-items-center font-num text-[11px] font-bold" style={{ color: C.text }}>{value}</span>
      </div>
      <span className="text-[10px] uppercase tracking-wide" style={{ color: C.sub }}>conviction</span>
    </div>
  );
}
function Cell({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="rounded-lg py-2" style={{ background: C.panel2 }}>
      <div className="text-[9px] uppercase" style={{ color: C.faint }}>{label}</div>
      <div className="font-num text-sm font-bold" style={{ color: tone }}>{value}</div>
      {sub ? <div className="font-num text-[9px]" style={{ color: C.faint }}>{sub}</div> : null}
    </div>
  );
}
