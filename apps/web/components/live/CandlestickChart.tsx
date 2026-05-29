'use client';
import { useEffect, useRef } from 'react';
import {
  createChart, IChartApi, CandlestickData, Time, SeriesMarker,
} from 'lightweight-charts';

interface OHLCVCandle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface ChartSignal { time: number; direction: 'long' | 'short'; symbol: string; }

interface Props {
  candles: OHLCVCandle[];
  signals?: ChartSignal[];
  height?: number;
}

export function CandlestickChart({ candles, signals = [], height = 380 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<any>(null);
  const emaRef = useRef<any>(null);
  const volRef = useRef<any>(null);

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

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candleRef.current = candleSeries;

    const emaSeries = chart.addLineSeries({
      color: 'rgba(251,191,36,0.7)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    emaRef.current = emaSeries;

    const volSeries = chart.addHistogramSeries({
      color: 'rgba(100,116,139,0.3)',
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volRef.current = volSeries;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      emaRef.current = null;
      volRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !candles.length) return;
    const sorted = [...candles].sort((a, b) => a.time - b.time);

    candleRef.current.setData(
      sorted.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close }))
    );

    if (volRef.current) {
      volRef.current.setData(sorted.map(c => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)',
      })));
    }

    if (emaRef.current && sorted.length >= 2) {
      const k = 2 / (20 + 1);
      let ema = sorted[0].close;
      emaRef.current.setData(sorted.map(c => {
        ema = c.close * k + ema * (1 - k);
        return { time: c.time as Time, value: Math.round(ema * 100) / 100 };
      }));
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    if (!candleRef.current) return;
    const markers: SeriesMarker<Time>[] = signals
      .sort((a, b) => a.time - b.time)
      .map(s => ({
        time: s.time as Time,
        position: s.direction === 'long' ? 'belowBar' : 'aboveBar',
        color: s.direction === 'long' ? '#22c55e' : '#ef4444',
        shape: s.direction === 'long' ? 'arrowUp' : 'arrowDown',
        text: s.direction === 'long' ? '▲ BUY' : '▼ SELL',
        size: 1,
      }));
    candleRef.current.setMarkers(markers);
  }, [signals]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: `${height}px` }}
      className="rounded-lg overflow-hidden"
    />
  );
}
