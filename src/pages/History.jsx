import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { cn } from "@/lib/utils";

const tooltipStyle = { background: "hsl(224,35%,10%)", border: "1px solid hsl(224,20%,18%)", borderRadius: 8, color: "hsl(210,20%,92%)", fontSize: 11 };

export default function History() {
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: sessions = [] } = useQuery({ queryKey: ["activeBotSession"], queryFn: () => base44.entities.BotSession.filter({ active: true }), refetchInterval: 15000 });
  const activeMode = sessions[0]?.mode === "demo" ? "demo" : "live";
  const { data: trades = [], isLoading } = useQuery({ queryKey: ["trades", activeMode], queryFn: () => base44.entities.Trade.filter({ mode: activeMode }, "-created_date", 50) });

  const filtered = statusFilter === "all" ? trades : trades.filter(trade => trade.status === statusFilter);
  const closedTrades = trades.filter(trade => trade.status === "closed");
  const totalPnL = closedTrades.reduce((sum, trade) => sum + (trade.profit_loss || 0), 0);
  const wins = closedTrades.filter(trade => (trade.profit_loss || 0) > 0).length;
  const winRate = closedTrades.length ? (wins / closedTrades.length * 100) : 0;
  const equityCurve = [...closedTrades].reverse().reduce((rows, trade, index) => {
    const previous = rows[index - 1]?.equity || 0;
    rows.push({ t: new Date(trade.entry_date || trade.created_date).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }), equity: Number((previous + (trade.profit_loss || 0)).toFixed(6)) });
    return rows;
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Clock className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Historial</h2>
          <p className="text-sm text-muted-foreground">Registro completo de operaciones · {activeMode.toUpperCase()}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card rounded-xl border border-border p-4"><span className="text-xs text-muted-foreground">Total Trades</span><p className="text-xl font-mono font-bold text-foreground mt-1">{trades.length}</p></div>
        <div className="bg-card rounded-xl border border-border p-4"><span className="text-xs text-muted-foreground">Win Rate</span><p className="text-xl font-mono font-bold text-primary mt-1">{winRate.toFixed(1)}%</p></div>
        <div className="bg-card rounded-xl border border-border p-4"><span className="text-xs text-muted-foreground">PnL Total</span><p className={cn("text-xl font-mono font-bold mt-1", totalPnL >= 0 ? "text-profit" : "text-loss")}>{totalPnL >= 0 ? "+" : ""}{totalPnL.toFixed(6)}</p></div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Curva de PnL real</h3>
        <div className="h-48">
          {equityCurve.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{isLoading ? "Cargando operaciones..." : "Sin datos reales todavía"}</div>
          ) : (
            <ResponsiveContainer>
              <AreaChart data={equityCurve}>
                <defs><linearGradient id="eqHistGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(160,59%,40%)" stopOpacity={0.3} /><stop offset="100%" stopColor="hsl(160,59%,40%)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(224,20%,18%)" />
                <XAxis dataKey="t" tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(215,15%,55%)", fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="equity" stroke="hsl(160,59%,40%)" strokeWidth={2} fill="url(#eqHistGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Todas las Operaciones</h3>
          <div className="flex gap-1">
            {["all", "open", "closed"].map(status => (
              <Button key={status} size="sm" variant={statusFilter === status ? "default" : "ghost"} className="text-xs h-7 px-2.5" onClick={() => setStatusFilter(status)}>
                {status === "all" ? "Todas" : status === "open" ? "Abiertas" : "Cerradas"}
              </Button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground border-b border-border"><th className="text-left py-2">Bot</th><th className="text-left py-2">Par</th><th className="text-left py-2">Lado</th><th className="text-right py-2">Entrada</th><th className="text-right py-2">Salida</th><th className="text-right py-2">PnL</th><th className="text-right py-2">Estado</th><th className="text-right py-2">Orden entrada</th><th className="text-right py-2">Orden cierre</th></tr></thead>
            <tbody>{filtered.map(trade => (
              <tr key={trade.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-2.5 font-medium text-foreground">{trade.bot_name}</td>
                <td className="py-2.5 font-mono">{trade.pair}</td>
                <td className="py-2.5"><span className={trade.side === "buy" ? "text-profit" : "text-loss"}>{trade.side?.toUpperCase()}</span></td>
                <td className="py-2.5 text-right font-mono">${trade.entry_price?.toLocaleString()}</td>
                <td className="py-2.5 text-right font-mono">{trade.exit_price ? `$${trade.exit_price.toLocaleString()}` : "—"}</td>
                <td className={cn("py-2.5 text-right font-mono font-medium", (trade.profit_loss || 0) >= 0 ? "text-profit" : "text-loss")}>{trade.profit_loss != null ? `${trade.profit_loss >= 0 ? "+" : ""}${trade.profit_loss.toFixed(6)}` : "—"}</td>
                <td className="py-2.5 text-right"><span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${trade.status === "open" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{trade.status}</span></td>
                <td className="py-2.5 text-right font-mono text-[10px]">{trade.exchange_order_id || "—"}</td>
                <td className="py-2.5 text-right font-mono text-[10px]">{trade.close_order_id || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No hay operaciones en este filtro</p>}
        </div>
      </div>
    </div>
  );
}