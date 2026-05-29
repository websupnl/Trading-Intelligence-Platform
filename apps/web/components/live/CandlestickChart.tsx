'use client';
import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  SeriesMarker,
} from 'lightweight-charts';

interface OHLCVCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartSignal {
  time: number;
  direction: 'long' | 'short';
  symbol: string;
}

interface CandlestickChartProps {
  candles: OHLCVCandle[];
  signals: ChartSignal[];
  /** Override height in px. Defaults to filling parent container. */
  height?: number;
}

export function CandlestickChart({ candles, signals, height }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emaSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeSeriesRef = useRef<any>(null);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#64748b',
        fontSize: 11,
        fontFamily: 'ui-monospace, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(148,163,184,0.3)', width: 1, style: 3 },
        horzLine: { color: 'rgba(148,163,184,0.3)', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        textColor: '#64748b',
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        textColor: '#64748b',
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
      },
      handleScroll: true,
      handleScale: true,
    });

    chartRef.current = chart;

    // Candlestick series (v4 API)
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    // EMA-20 line
    const emaSeries = chart.addLineSeries({
      color: 'rgba(251,191,36,0.7)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    emaSeriesRef.current = emaSeries;

    // Volume histogram (lower pane via price scale)
    const volSeries = chart.addHistogramSeries({
      color: 'rgba(100,116,139,0.3)',
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volSeries;

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.resize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      emaSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Update candles & EMA when data changes
  useEffect(() => {
    if (!candleSeriesRef.current || !candles.length) return;

    const sorted = [...candles].sort((a, b) => a.time - b.time);

    const ohlcv: CandlestickData[] = sorted.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeriesRef.current.setData(ohlcv);

    // Volume
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(
        sorted.map((c) => ({
          time: c.time as Time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
        }))
      );
    }

    // Calculate EMA-20
    if (emaSeriesRef.current && sorted.length >= 2) {
      const k = 2 / (20 + 1);
      let ema = sorted[0].close;
      const emaData = sorted.map((c) => {
        ema = c.close * k + ema * (1 - k);
        return { time: c.time as Time, value: Math.round(ema * 100) / 100 };
      });
      emaSeriesRef.current.setData(emaData);
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Update signal markers
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    const markers: SeriesMarker<Time>[] = signals
      .sort((a, b) => a.time - b.time)
      .map((s) => ({
        time: s.time as Time,
        position: s.direction === 'long' ? 'belowBar' : 'aboveBar',
        color: s.direction === 'long' ? '#22c55e' : '#ef4444',
        shape: s.direction === 'long' ? 'arrowUp' : 'arrowDown',
        text: s.direction === 'long' ? 'BUY' : 'SELL',
        size: 1.5,
      }));

    candleSeriesRef.current.setMarkers(markers);
  }, [signals]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: height != null ? `${height}px` : '100%' }}
      className="rounded overflow-hidden"
    />
  );
}
