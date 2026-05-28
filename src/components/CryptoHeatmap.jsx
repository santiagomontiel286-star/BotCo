import { cn } from "@/lib/utils";

const KRAKEN_MAP = {
  XXBTZUSD: "BTC", XETHZUSD: "ETH", SOLUSDT: "SOL", XRPUSDT: "XRP",
  ADAUSDT: "ADA", DOTUSD: "DOT", LINKUSD: "LINK", MATICUSD: "MATIC",
};

const fallback = [
  { symbol: "BTC", change: 0 }, { symbol: "ETH", change: 0 },
  { symbol: "SOL", change: 0 }, { symbol: "XRP", change: 0 },
  { symbol: "ADA", change: 0 }, { symbol: "DOT", change: 0 },
  { symbol: "LINK", change: 0 }, { symbol: "MATIC", change: 0 },
];

function getColor(change) {
  if (change > 3) return "bg-primary/40 text-primary";
  if (change > 0) return "bg-primary/20 text-primary/80";
  if (change > -2) return "bg-destructive/20 text-destructive/80";
  return "bg-destructive/40 text-destructive";
}

export default function CryptoHeatmap({ tickers }) {
  const items = tickers && Object.keys(tickers).length > 0
    ? Object.entries(tickers).map(([key, val]) => ({
        symbol: KRAKEN_MAP[key] || key.replace("USD", "").replace("USDT", ""),
        change: parseFloat(val.change || 0),
      }))
    : fallback;

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {items.map(c => (
        <div key={c.symbol} className={cn("rounded-lg p-2 text-center transition-all hover:scale-105", getColor(c.change))}>
          <span className="text-[10px] font-bold block">{c.symbol}</span>
          <span className="text-[10px] font-mono">{c.change > 0 ? "+" : ""}{c.change}%</span>
        </div>
      ))}
    </div>
  );
}