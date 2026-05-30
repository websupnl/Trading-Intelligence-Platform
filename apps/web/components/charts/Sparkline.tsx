'use client';

import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';

interface Props {
  data: number[];
  color?: string;
  height?: number;
  showTooltip?: boolean;
}

export function Sparkline({ data, color, height = 40, showTooltip = false }: Props) {
  if (!data || data.length < 2) return <div style={{ height }} />;

  const isUp = data[data.length - 1] >= data[0];
  const lineColor = color ?? (isUp ? '#3fb950' : '#f85149');
  const chartData = data.map((v, i) => ({ i, v }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData}>
        {showTooltip && (
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="bg-card border border-border rounded px-2 py-1 text-xs font-num">
                  ${payload[0].value?.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </div>
              ) : null
            }
          />
        )}
        <Line
          type="monotone"
          dataKey="v"
          stroke={lineColor}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
