'use client';
import { useState, useEffect, useCallback } from 'react';

type UseApiOptions = {
  pollIntervalMs?: number;
};

export function useApi<T>(fetcher: () => Promise<T>, deps: any[] = [], options: UseApiOptions = {}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (e: any) {
      setError(e?.detail?.message || e?.detail || e?.message || 'Onbekende fout');
    } finally {
      if (!silent) setLoading(false);
    }
  }, deps);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!options.pollIntervalMs) return;
    const timer = window.setInterval(() => {
      load(true);
    }, options.pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [load, options.pollIntervalMs]);

  return { data, loading, error, reload: load };
}
