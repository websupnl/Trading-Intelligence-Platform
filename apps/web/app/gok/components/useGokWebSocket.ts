'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

export interface Opportunity {
  asset: string;
  strategy: string;
  score: number;
  confidence: number;
  entry_price: number;
  take_profit: number;
  stop_loss: number;
  atr: number;
  reason: string;
  news_score: number;
  social_score: number;
  ta_score: number;
  news_headlines: string[];
  received_at?: string;
}

export interface PositionUpdate {
  position_id: string;
  asset: string;
  current_price?: number;
  pnl?: number;
  pnl_pct?: number;
  tp_distance_pct?: number;
  sl_distance_pct?: number;
}

export interface PositionClosed {
  position_id: string;
  asset: string;
  reason: string;
  pnl?: number;
  pnl_pct?: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface GokWsState {
  connectionStatus: ConnectionStatus;
  opportunities: Opportunity[];
  positionUpdates: Record<string, PositionUpdate>;
  recentlyClosed: PositionClosed[];
  lastScore: { total_score: number; streak: number } | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const WS_URL = API_BASE.replace(/^http/, 'ws') + '/api/gok/ws';
const MAX_OPPORTUNITIES = 20;
const RECONNECT_DELAY_MS = 3000;

export function useGokWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const [state, setState] = useState<GokWsState>({
    connectionStatus: 'disconnected',
    opportunities: [],
    positionUpdates: {},
    recentlyClosed: [],
    lastScore: null,
  });

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setState(s => ({ ...s, connectionStatus: 'connecting' }));

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setState(s => ({ ...s, connectionStatus: 'connected' }));
      // Start ping interval
      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'ping' }));
        } else {
          clearInterval(ping);
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch {}
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setState(s => ({ ...s, connectionStatus: 'disconnected' }));
      // Reconnect
      reconnectRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      setState(s => ({ ...s, connectionStatus: 'error' }));
    };
  }, []);

  const handleMessage = (msg: { type: string; data: unknown }) => {
    const data = msg.data as Record<string, unknown>;
    switch (msg.type) {
      case 'opportunity':
        setState(s => ({
          ...s,
          opportunities: [
            { ...(data as Opportunity), received_at: new Date().toISOString() },
            ...s.opportunities,
          ].slice(0, MAX_OPPORTUNITIES),
        }));
        break;

      case 'position_update':
        setState(s => ({
          ...s,
          positionUpdates: {
            ...s.positionUpdates,
            [(data as PositionUpdate).position_id]: data as PositionUpdate,
          },
        }));
        break;

      case 'position_closed':
        setState(s => ({
          ...s,
          recentlyClosed: [data as PositionClosed, ...s.recentlyClosed].slice(0, 10),
          positionUpdates: Object.fromEntries(
            Object.entries(s.positionUpdates).filter(
              ([id]) => id !== (data as PositionClosed).position_id
            )
          ),
        }));
        break;

      case 'score_update':
        setState(s => ({ ...s, lastScore: data as { total_score: number; streak: number } }));
        break;

      default:
        break;
    }
  };

  const clearOpportunities = useCallback(() => {
    setState(s => ({ ...s, opportunities: [] }));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    ...state,
    clearOpportunities,
  };
}
