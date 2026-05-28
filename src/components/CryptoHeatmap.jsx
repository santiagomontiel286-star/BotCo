import { cn } from "@/lib/utils";

const cryptos = [
  { symbol: "BTC", change: 2.4 }, { symbol: "ETH", change: -1.2 }, { symbol: "BNB", change: 0.8 },
  { symbol: "SOL", change: 5.1 }, { symbol: "XRP", change: -0.5 }, { symbol: "ADA", change: 1.3 },
  { symbol: "DOGE", change: -2.8 }, { symbol: "DOT", change: 0.3 }, { symbol: "AVAX", change: 3.7 },
  { symbol: "LINK", change: -0.9 }, { symbol: "MATIC", change: 1.8 }, { symbol: "UNI", change: -1.5 },
  { symbol: "ATOM", change: 2.1 }, { symbol: "LTC", change: 0.6 }, { symbol: "FIL", change: -3.2 },
  { symbol: "NEAR", change: 4.2 }, { symbol: "APT", change: -0.7 }, { symbol: "ARB", change: 1.1 },
  { symbol: "OP", change: 2.9 }, { symbol: "INJ", change: -1.8 }
];

function getColor(change) {
  if (change > 3) return "bg-primary/40 text-primary";
  if (change > 0) return "bg-primary/20 text-primary/80";
  if (change > -2) return "bg-destructive/20 text-destructive/80";
  return "bg-destructive/40 text-destructive";
}

export default function CryptoHeatmap() {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
      {cryptos.map(c => (
        <div key={c.symbol} className={cn("rounded-lg p-2 text-center transition-all hover:scale-105", getColor(c.change))}>
          <span className="text-[10px] font-bold block">{c.symbol}</span>
          <span className="text-[10px] font-mono">{c.change > 0 ? "+" : ""}{c.change}%</span>
        </div>
      ))}
    </div>
  );
}