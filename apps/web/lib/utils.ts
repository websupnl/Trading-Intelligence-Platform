import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmt(val: number | null | undefined, decimals = 2): string {
  if (val == null) return '—';
  return val.toFixed(decimals);
}

export function fmtUSD(val: number | null | undefined): string {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

export function fmtPct(val: number | null | undefined): string {
  if (val == null) return '—';
  return `${(val * 100).toFixed(2)}%`;
}

export function fmtDate(val: string | null | undefined): string {
  if (!val) return '—';
  return new Date(val).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function confidenceColor(c: number): string {
  if (c >= 0.7) return 'text-green-400';
  if (c >= 0.5) return 'text-yellow-400';
  return 'text-red-400';
}

/** Normalize Alpaca symbols: 'ETHUSD' or 'ETH/USD' → 'ETH' */
export function cleanSym(s: string | null | undefined): string {
  return (s || '').split('/')[0].replace(/USD[CT]?$/, '');
}

/** Format price with appropriate decimals */
export function fmtPrice(p: number | null | undefined): string {
  if (p == null) return '—';
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}
