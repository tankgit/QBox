import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface PriceChartProps {
  data: Array<{ timestamp: string; price: number }>;
  trades?: Array<{ timestamp: string; price: number; action: "buy" | "sell" }>;
}

export function PriceChart({ data, trades = [] }: PriceChartProps) {
  const tradesByTimestamp = trades.reduce<Record<string, Array<{ timestamp: string; price: number; action: "buy" | "sell" }>>>((acc, trade) => {
    if (!acc[trade.timestamp]) {
      acc[trade.timestamp] = [];
    }
    acc[trade.timestamp].push(trade);
    return acc;
  }, {});

  const enhancedData = data.map((point) => ({
    ...point,
    trades: tradesByTimestamp[point.timestamp] ?? []
  }));

  const renderTradeDot = (props: unknown) => {
    const { cx, cy, payload } = props as {
      cx: number;
      cy: number;
      payload: { trades?: Array<{ action: "buy" | "sell"; price: number }> };
    };

    if (!payload?.trades || payload.trades.length === 0) {
      return null;
    }

    const radius = 6;
    const gap = 4;
    const total = payload.trades.length;

    return (
      <g>
        {payload.trades.map((trade, index) => {
          const color = trade.action === "buy" ? "#ef4444" : "#22c55e";
          const offset = (index - (total - 1) / 2) * (radius * 2 + gap);
          return (
            <g key={`${trade.action}-${index}`}>
              <circle cx={cx + offset} cy={cy} r={radius + 2} fill="rgba(15, 23, 42, 0.95)" stroke="rgba(148, 163, 184, 0.4)" strokeWidth={1} />
              <circle cx={cx + offset} cy={cy} r={radius} fill={color} stroke="rgba(15, 23, 42, 0.9)" strokeWidth={1.5} />
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={enhancedData}>
          <CartesianGrid strokeDasharray="4 8" stroke="rgba(148, 163, 184, 0.1)" />
          <XAxis dataKey="timestamp" tick={{ fill: "#94a3b8", fontSize: 12 }} hide />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} domain={["dataMin", "dataMax"]} />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(15,23,42,0.9)",
              borderRadius: 16,
              border: "1px solid rgba(96,165,250,0.4)",
              color: "#e2e8f0"
            }}
          />
          <Line type="monotone" dataKey="price" stroke="#60a5fa" strokeWidth={2.2} dot={renderTradeDot} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

