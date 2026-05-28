import { useMemo } from "react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";

export default function MiniSparkline({ positive = true, dataPoints = 20 }) {
  const data = useMemo(() => {
    let val = 50;
    return Array.from({ length: dataPoints }, (_, i) => {
      val += (Math.random() - (positive ? 0.4 : 0.6)) * 5;
      val = Math.max(10, Math.min(90, val));
      return { v: val };
    });
  }, [positive, dataPoints]);

  const color = positive ? "hsl(160, 59%, 40%)" : "hsl(0, 70%, 55%)";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id={`grad-${positive}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#grad-${positive})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}