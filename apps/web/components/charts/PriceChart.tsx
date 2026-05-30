'use client';

import { useEffect, useRef, useMemo } from 'react';
import { createChart, IChartApi, CandlestickData, Time, SeriesMarker } from 'lightweight-charts';

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface Level { price: number; color: string; label: string; dashed?: boolean; }

interface Props {
  candles: Candle[];
  levels?: Level[];
  markers?: { time: number; direction: 'buy' | 'sell' }[];
  height?: number; // undefined = fill parent (use absolute positioning)
}

export function PriceChart({ candles, levels = [], markers = [], height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const actualHeight = height ?? 300;
  const candleRef = useRef<any>(null);
  const ema20Ref = useRef<any>(null);
  const ema50Ref = useRef<any>(null);
  const volRef = useRef<any>(null);
  const linesRef = useRef<any[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: actualHeight,
      layout: {
        background: { color: '#0d1117' },
        textColor: '#7d8590',
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      },
      grid: {
        vertLines: { color: '#21262d' },
        horzLines: { color: '#21262d' },
      },
      crosshair: {
        vertLine: { color: '#3d444d', labelBackgroundColor: '#21262d' },
        horzLine: { color: '#3d444d', labelBackgroundColor: '#21262d' },
      },
      rightPriceScale: {
        borderColor: '#30363d',
        textColor: '#7d8590',
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: '#30363d',
        timeVisible: true,
        secondsVisible: false,
      },
    });
    chartRef.current = chart;

    const cs = chart.addCandlestickSeries({
      upColor: '#3fb950',
      downColor: '#f85149',
      borderVisible: false,
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    });
    candleRef.current = cs;

    const ema20 = chart.addLineSeries({ color: '#f0883e', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA20' });
    ema20Ref.current = ema20;

    const ema50 = chart.addLineSeries({ color: '#58a6ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA50' });
    ema50Ref.current = ema50;

    const vol = chart.addHistogramSeries({
      color: 'rgba(100,116,139,0.3)',
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volRef.current = vol;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.resize(containerRef.current.clientWidth, actualHeight);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      linesRef.current = [];
    };
  }, [height]); // eslint-disable-line

  useEffect(() => {
    if (!candleRef.current || !candles.length) return;
    const sorted = [...candles].sort((a, b) => a.time - b.time);

    candleRef.current.setData(sorted.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));

    if (volRef.current) {
      volRef.current.setData(sorted.map(c => ({ time: c.time as Time, value: c.volume, color: c.close >= c.open ? 'rgba(63,185,80,0.4)' : 'rgba(248,81,73,0.4)' })));
    }

    const ema = (period: number) => {
      const k = 2 / (period + 1);
      let val = sorted[0].close;
      return sorted.map(c => { val = c.close * k + val * (1 - k); return { time: c.time as Time, value: +val.toFixed(4) }; });
    };
    if (ema20Ref.current) ema20Ref.current.setData(ema(20));
    if (ema50Ref.current && sorted.length >= 20) ema50Ref.current.setData(ema(50));

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    if (!candleRef.current) return;
    linesRef.current.forEach(l => { try { candleRef.current.removePriceLine(l); } catch {} });
    linesRef.current = levels.map(lv => candleRef.current.createPriceLine({
      price: lv.price,
      color: lv.color,
      lineWidth: 1,
      lineStyle: lv.dashed ? 2 : 0,
      axisLabelVisible: true,
      title: lv.label,
    }));
  }, [levels]);

  useEffect(() => {
    if (!candleRef.current || !candles.length) return;
    const last = [...candles].sort((a, b) => a.time - b.time).at(-1);
    if (!last) return;
    candleRef.current.setMarkers(
      markers.sort((a, b) => a.time - b.time).map(m => ({
        time: m.time as Time,
        position: m.direction === 'buy' ? 'belowBar' : 'aboveBar',
        color: m.direction === 'buy' ? '#3fb950' : '#f85149',
        shape: m.direction === 'buy' ? 'arrowUp' : 'arrowDown',
        text: m.direction === 'buy' ? 'BUY' : 'SELL',
        size: 1.5,
      }))
    );
  }, [markers, candles]);

  return <div ref={containerRef} style={{ height: actualHeight }} className="w-full rounded-lg overflow-hidden" />;
}
