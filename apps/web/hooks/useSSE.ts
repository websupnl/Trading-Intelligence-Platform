'use client';
import { useEffect, useRef, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function getPin(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('dashboard_pin') || '';
}

type SSEEventData = Record<string, unknown> & { type: string; ts: string };
type SSEHandler = (data: SSEEventData) => void;

interface UseSSEOptions {
  enabled?: boolean;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export function useSSE(
  path: string,
  handlers: Record<string, SSEHandler>,
  options: UseSSEOptions = {}
) {
  const { enabled = true, onConnected, onDisconnected } = options;
  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(1000);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return;

    const pin = getPin();
    const sep = path.includes('?') ? '&' : '?';
    const url = `${API_BASE}${path}${pin ? `${sep}pin=${encodeURIComponent(pin)}` : ''}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      if (!mountedRef.current) return;
      delayRef.current = 1000; // reset backoff
      onConnected?.();
    };

    es.onmessage = (ev) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(ev.data) as SSEEventData;
        const handler = handlers[data.type];
        if (handler) handler(data);
      } catch (e) {
        console.warn('[useSSE] parse error', e);
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      onDisconnected?.();
      if (!mountedRef.current) return;
      // Exponential backoff: 1s → 2s → 4s → ... → 30s
      const delay = delayRef.current;
      delayRef.current = Math.min(delay * 2, 30_000);
      reconnectRef.current = setTimeout(connect, delay);
    };
  }, [path, enabled, onConnected, onDisconnected]); // eslint-disable-line

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) connect();

    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect, enabled]);
}

export function getStreamUrl(path: string): string {
  const pin = getPin();
  const sep = path.includes('?') ? '&' : '?';
  return `${API_BASE}${path}${pin ? `${sep}pin=${encodeURIComponent(pin)}` : ''}`;
}
