'use client';
import { useEffect, useRef } from 'react';
import {
  createChart,
  IChartApi,
  CandlestickData,
  Time,
  SeriesMarker,
  PriceLineOptions,
  LineStyle,
} from 'lightweight-charts';

interface OHLCVCandle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface ChartSignal { time: number; direction: 'long' | 'short'; symbol: string; }

interface PriceLevels {
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
}

interface CandlestickChartProps {
  candles: OHLCVCandle[];
  signals?: ChartSignal[];
  levels?: PriceLevels;
  height?: number;
  dark?: boolean;
}

const DARK = {
  bg: '#0d1117',
  bg2: '#161b22',
  grid: '#21262d',
  text: '#8b949e',
  border: '#30363d',
};

const LIGHT = {
  bg: '#ffffff',
  bg2: '#f6f8fa',
  grid: '#e8edf0',
  text: '#57606a',
  border: '#d0d7de',
};

export function CandlestickChart({ candles, signals = [], levels, height, dark = true }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<any>(null);
  const ema20Ref = useRef<any>(null);
  const ema50Ref = useRef<any>(null);
  const volRef = useRef<any>(null);
  const linesRef = useRef<any[]>([]);

  const theme = dark ? DARK : LIGHT;

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: theme.bg },
        textColor: theme.text,
        fontSize: 11,
        fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
      },
      grid: {
        vertLines: { color: theme.grid, style: LineStyle.Dotted },
        horzLines: { color: theme.grid, style: LineStyle.Dotted },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#4a5568', labelBackgroundColor: '#2d3748' },
        horzLine: { color: '#4a5568', labelBackgroundColor: '#2d3748' },
      },
      rightPriceScale: {
        borderColor: theme.border,
        textColor: theme.text,
        scaleMargins: { top: 0.08, bottom: 0.25 },
      },
      timeScale: {
        borderColor: theme.border,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 8,
      },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a641',
      downColor: '#f85149',
      borderVisible: false,
      wickUpColor: '#26a641',
      wickDownColor: '#f85149',
    });
    candleRef.current = candleSeries;

    // EMA20 — amber
    const ema20Series = chart.addLineSeries({
      color: '#f0883e',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'EMA20',
    });
    ema20Ref.current = ema20Series;

    // EMA50 — cyan
    const ema50Series = chart.addLineSeries({
      color: '#58a6ff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'EMA50',
    });
    ema50Ref.current = ema50Series;

    // Volume
    const volSeries = chart.addHistogramSeries({
      color: 'rgba(100,116,139,0.35)',
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
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
      ema20Ref.current = null;
      ema50Ref.current = null;
      volRef.current = null;
      linesRef.current = [];
    };
  }, []); // eslint-disable-line

  // Update candle data
  useEffect(() => {
    if (!candleRef.current || !candles.length) return;
    const sorted = [...candles].sort((a, b) => a.time - b.time);

    candleRef.current.setData(sorted.map((c): CandlestickData => ({
      time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
    })));

    if (volRef.current) {
      volRef.current.setData(sorted.map(c => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(38,166,65,0.4)' : 'rgba(248,81,73,0.4)',
      })));
    }

    // EMA20
    if (ema20Ref.current && sorted.length >= 2) {
      const k20 = 2 / 21;
      let ema = sorted[0].close;
      ema20Ref.current.setData(sorted.map(c => {
        ema = c.close * k20 + ema * (1 - k20);
        return { time: c.time as Time, value: +ema.toFixed(4) };
      }));
    }

    // EMA50
    if (ema50Ref.current && sorted.length >= 10) {
      const k50 = 2 / 51;
      let ema = sorted[0].close;
      ema50Ref.current.setData(sorted.map(c => {
        ema = c.close * k50 + ema * (1 - k50);
        return { time: c.time as Time, value: +ema.toFixed(4) };
      }));
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Signals as markers
  useEffect(() => {
    if (!candleRef.current) return;
    const markers: SeriesMarker<Time>[] = [...signals]
      .sort((a, b) => a.time - b.time)
      .map(s => ({
        time: s.time as Time,
        position: s.direction === 'long' ? 'belowBar' : 'aboveBar',
        color: s.direction === 'long' ? '#26a641' : '#f85149',
        shape: s.direction === 'long' ? 'arrowUp' : 'arrowDown',
        text: s.direction === 'long' ? '▲ BUY' : '▼ SELL',
        size: 1.5,
      }));
    candleRef.current.setMarkers(markers);
  }, [signals]);

  // Entry / SL / TP price lines
  useEffect(() => {
    if (!candleRef.current) return;
    // Remove old lines
    linesRef.current.forEach(l => { try { candleRef.current.removePriceLine(l); } catch {} });
    linesRef.current = [];
    if (!levels) return;

    const add = (price: number, color: string, title: string, style: LineStyle = LineStyle.Dashed) => {
      const opts: PriceLineOptions = {
        price, color, lineWidth: 1, lineStyle: style,
        axisLabelVisible: true, title,
      };
      linesRef.current.push(candleRef.current.createPriceLine(opts));
    };

    if (levels.entry) add(levels.entry, '#58a6ff', `Entry $${levels.entry.toFixed(2)}`, LineStyle.Solid);
    if (levels.stopLoss) add(levels.stopLoss, '#f85149', `SL $${levels.stopLoss.toFixed(2)}`);
    if (levels.takeProfit) add(levels.takeProfit, '#26a641', `TP $${levels.takeProfit.toFixed(2)}`);
  }, [levels]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: height != null ? `${height}px` : '100%' }}
    />
  );
}
