import { useMemo } from "react";

export default function FearGreedGauge({ value = 45 }) {
  const label = value <= 20 ? "Miedo Extremo" : value <= 40 ? "Miedo" : value <= 60 ? "Neutral" : value <= 80 ? "Codicia" : "Codicia Extrema";
  const color = value <= 20 ? "#ef4444" : value <= 40 ? "#f97316" : value <= 60 ? "#eab308" : value <= 80 ? "#22c55e" : "#10b981";
  
  const angle = useMemo(() => -90 + (value / 100) * 180, [value]);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" className="w-full max-w-[200px]">
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="25%" stopColor="#f97316" />
            <stop offset="50%" stopColor="#eab308" />
            <stop offset="75%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="hsl(224, 20%, 18%)" strokeWidth="12" strokeLinecap="round" />
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeGrad)" strokeWidth="12" strokeLinecap="round" opacity="0.8" />
        <line
          x1="100" y1="100"
          x2={100 + 60 * Math.cos((angle * Math.PI) / 180)}
          y2={100 + 60 * Math.sin((angle * Math.PI) / 180)}
          stroke={color} strokeWidth="3" strokeLinecap="round"
        />
        <circle cx="100" cy="100" r="5" fill={color} />
        <text x="100" y="85" textAnchor="middle" className="fill-foreground text-2xl font-mono font-bold">{value}</text>
      </svg>
      <span className="text-sm font-medium mt-1" style={{ color }}>{label}</span>
    </div>
  );
}