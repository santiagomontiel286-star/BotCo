import { Play, Pause, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const typeLabels = {
  trend_following: "Trend Following",
  mean_reversion: "Mean Reversion",
  ai_sentiment: "AI Sentiment",
  risk_guardian: "Risk Guardian"
};

const statusColors = {
  active: "bg-primary/20 text-primary",
  paused: "bg-chart-3/20 text-chart-3",
  stopped: "bg-muted text-muted-foreground"
};

const TYPE_ALLOC = {
  trend_following: 35,
  mean_reversion: 25,
  ai_sentiment: 25,
  risk_guardian: 15,
};

export default function BotCard({ bot, onStart, onPause, onStop, compact, totalKrakenUSD = 0, krakenTrades = [] }) {
  const isActive = bot.status === "active";
  const alloc = TYPE_ALLOC[bot.type] || 0;
  // Use real Kraken-derived capital when available, else entity value
  const realCapital = totalKrakenUSD > 0 ? (totalKrakenUSD * alloc) / 100 : (bot.capital || 0);
  // Compute real trade count: approx proportional share of Kraken trades
  const realTrades = krakenTrades.length > 0 ? Math.round(krakenTrades.length * alloc / 100) : (bot.trades_count || 0);
  // Net PnL from real Kraken trades (proportional)
  const netPnl = krakenTrades.length > 0
    ? krakenTrades.reduce((s, t) => s + (t.net || 0), 0) * alloc / 100
    : null;
  const profitPositive = netPnl !== null ? netPnl >= 0 : (bot.profit || 0) >= 0;

  if (compact) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 hover:border-primary/20 transition-all">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-foreground">{bot.name}</span>
          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider", statusColors[bot.status])}>
            {bot.status}
          </span>
        </div>
        <div className="flex items-center justify-between">
          {netPnl !== null
            ? <span className={cn("text-sm font-mono font-bold", profitPositive ? "text-profit" : "text-loss")}>
                {netPnl >= 0 ? "+" : ""}{netPnl.toFixed(2)} USD
              </span>
            : <span className="text-xs text-muted-foreground">Sin datos reales</span>
          }
          <span className="text-xs text-muted-foreground font-mono">${realCapital.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "bg-card rounded-xl border border-border p-5 transition-all duration-300",
      isActive && "border-primary/30 glow-green"
    )}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-foreground">{bot.name}</h3>
          <p className="text-xs text-muted-foreground">{typeLabels[bot.type]}</p>
        </div>
        <span className={cn("text-[10px] px-2.5 py-1 rounded-full font-medium uppercase tracking-wider", statusColors[bot.status])}>
          {isActive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1.5 animate-pulse" />}
          {bot.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
        <div>
          <span className="text-muted-foreground">Capital (Kraken)</span>
          <p className="font-mono font-semibold text-foreground">${realCapital.toLocaleString('en-US', { maximumFractionDigits: 2 })}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Net PnL</span>
          {netPnl !== null
            ? <p className={cn("font-mono font-semibold", netPnl >= 0 ? "text-profit" : "text-loss")}>{netPnl >= 0 ? "+" : ""}{netPnl.toFixed(2)} $</p>
            : <p className="font-mono text-muted-foreground">—</p>
          }
        </div>
        <div>
          <span className="text-muted-foreground">Asignación</span>
          <p className="font-mono font-semibold text-foreground">{alloc}%</p>
        </div>
        <div>
          <span className="text-muted-foreground">Trades Kraken</span>
          <p className="font-mono font-semibold text-foreground">{realTrades > 0 ? realTrades : "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Riesgo</span>
          <p className="font-mono font-semibold text-chart-3">{bot.risk_level?.toFixed(1)}%</p>
        </div>
        <div>
          <span className="text-muted-foreground">Drawdown</span>
          <p className="font-mono font-semibold text-loss">{bot.max_drawdown?.toFixed(1)}%</p>
        </div>
      </div>

      <div className="flex gap-2">
        {bot.status !== "active" ? (
          <Button size="sm" className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5" onClick={() => onStart?.(bot.id)}>
            <Play className="w-3.5 h-3.5" /> Iniciar
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="flex-1 border-chart-3/30 text-chart-3 hover:bg-chart-3/10 gap-1.5" onClick={() => onPause?.(bot.id)}>
            <Pause className="w-3.5 h-3.5" /> Pausar
          </Button>
        )}
        <Button size="sm" variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => onStop?.(bot.id)}>
          <Square className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}