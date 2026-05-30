'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

interface DataPoint {
  label: string;
  pnl: number;
  cumPnl?: number;
}

interface Props {
  data: DataPoint[];
  height?: number;
  mode?: 'pnl' | 'cumulative';
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value as number;
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-xs">
      <p className="text-[#7d8590] mb-1">{label}</p>
      <p className={val >= 0 ? 'text-[#3fb950] font-bold font-num' : 'text-[#f85149] font-bold font-num'}>
        {val >= 0 ? '+' : ''}${val.toFixed(2)}
      </p>
    </div>
  );
}

export function PnlChart({ data, height = 200, mode = 'pnl' }: Props) {
  if (!data.length) return (
    <div style={{ height }} className="flex items-center justify-center text-sm text-[#7d8590]">
      Nog geen afgesloten trades
    </div>
  );

  const key = mode === 'cumulative' ? 'cumPnl' : 'pnl';
  const isPositive = (data[data.length - 1]?.[key] ?? 0) >= 0;
  const color = isPositive ? '#3fb950' : '#f85149';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`pnlGrad-${mode}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.2} />
            <stop offset="95%" stopColor={color} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
        <XAxis dataKey="label" tick={{ fill: '#7d8590', fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fill: '#7d8590', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={0} stroke="#30363d" strokeDasharray="3 3" />
        <Area
          type="monotone"
          dataKey={key}
          stroke={color}
          strokeWidth={2}
          fill={`url(#pnlGrad-${mode})`}
          isAnimationActive={false}
          dot={data.length < 20 ? { fill: color, r: 3, strokeWidth: 0 } : false}
          activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
